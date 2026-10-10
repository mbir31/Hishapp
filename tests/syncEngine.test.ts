import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import {
  ackOutboxItem,
  activateLedgerOwner,
  applyRemoteRecords,
  countOutbox,
  currentLedgerOwner,
  deletePatientEntry,
  getAllPatientEntries,
  getAllPatientProfiles,
  getSettings,
  importLedgerSnapshot,
  readDeletionTime,
  readOutboxBatch,
  restoreAllData,
  restorePatientEntry,
  savePatientEntry,
} from '../src/db/indexedDB';
import type { PatientEntry } from '../src/types';

// Each scenario starts with a brand-new browser database.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const visit = (id: string, patientName = 'Rahim Uddin', overrides: Partial<PatientEntry> = {}): PatientEntry => ({
  id,
  serial: 1,
  date: '2026-10-10',
  patientName,
  procedure: 'Filling',
  receivedAmount: 500,
  doctorShare: 200,
  settlementStatus: 'Pending',
  settlementId: null,
  remarks: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

test('every saved visit is queued for the cloud in the same write, with its audit event', async () => {
  await activateLedgerOwner('uid-A');
  await savePatientEntry(visit('entry-1'));

  const pending = await readOutboxBatch('uid-A');
  const keys = pending.map((item) => `${item.kind}:${item.id}`).sort();
  assert.ok(keys.includes('entry:entry-1'), `expected the visit in the outbox, got ${keys.join(', ')}`);
  assert.ok(pending.some((item) => item.kind === 'audit'), 'the audit event must be queued too');
});

test('an outbox item is removed only by the push that matches its latest edit', async () => {
  await activateLedgerOwner('uid-A');
  await savePatientEntry(visit('entry-1'));
  const item = (await readOutboxBatch('uid-A')).find((row) => row.kind === 'entry')!;

  // A push that started before a newer edit must not clear that edit.
  await ackOutboxItem('uid-A', item.key, 'stale-token');
  assert.equal((await readOutboxBatch('uid-A')).some((row) => row.key === item.key), true);

  await ackOutboxItem('uid-A', item.key, item.token);
  assert.equal((await readOutboxBatch('uid-A')).some((row) => row.key === item.key), false);
});

test('records saved before any sign-in move into the first account that signs in', async () => {
  await savePatientEntry(visit('guest-visit'));

  const { claimed } = await activateLedgerOwner('uid-A');
  assert.ok(claimed >= 1);
  assert.equal(await currentLedgerOwner(), 'uid-A');
  assert.equal((await getSettings()).dataOwnerUid, 'uid-A');
  assert.deepEqual((await getAllPatientEntries()).map((row) => row.id), ['guest-visit']);
});

test('switching accounts never shows or deletes another account\'s records', async () => {
  await activateLedgerOwner('uid-A');
  await savePatientEntry(visit('visit-of-A'));

  await activateLedgerOwner('uid-B');
  assert.deepEqual(await getAllPatientEntries(), [], 'account B must not see account A records');

  await savePatientEntry(visit('visit-of-B', 'Karim'));
  await activateLedgerOwner('uid-A');
  assert.deepEqual((await getAllPatientEntries()).map((row) => row.id), ['visit-of-A']);

  await activateLedgerOwner('uid-B');
  assert.deepEqual((await getAllPatientEntries()).map((row) => row.id), ['visit-of-B']);
});

test('a backup with no records cannot erase local records', async () => {
  await activateLedgerOwner('uid-A');
  await savePatientEntry(visit('precious'));

  await assert.rejects(
    restoreAllData({ patientEntries: [], settlements: [], auditLogs: [], patientProfiles: [] }),
    /no records/
  );
  assert.deepEqual((await getAllPatientEntries()).map((row) => row.id), ['precious']);
});

test('restoring a backup replaces the ledger and queues every restored record for the cloud', async () => {
  await activateLedgerOwner('uid-A');
  await savePatientEntry(visit('old-visit'));
  await ackAll('uid-A');

  await restoreAllData({
    patientEntries: [visit('restored-visit', 'Tahmina')],
    settlements: [],
    auditLogs: [],
    patientProfiles: [],
  });

  assert.deepEqual((await getAllPatientEntries()).map((row) => row.id), ['restored-visit']);
  const pending = await readOutboxBatch('uid-A');
  assert.ok(pending.some((item) => item.kind === 'entry' && item.id === 'restored-visit'));
});

test('records received from the cloud are applied without being queued for upload again', async () => {
  await activateLedgerOwner('uid-A');
  const changed = await applyRemoteRecords('uid-A', [
    { kind: 'entry', value: visit('from-another-device', 'Rafiq') },
  ]);
  assert.equal(changed, 1);
  assert.equal(await countOutbox('uid-A'), 0, 'remote data must not echo back to the cloud');
  assert.deepEqual((await getAllPatientEntries()).map((row) => row.id), ['from-another-device']);
});

test('deleting then undoing a visit stamps the undo after the deletion, so sync keeps it', async () => {
  await activateLedgerOwner('uid-A');
  const original = await savePatientEntry(visit('undo-me'));
  await deletePatientEntry(original.id);
  assert.equal((await getAllPatientEntries()).length, 0);

  const deletedAt = await readDeletionTime('uid-A', 'entry', original.id);
  assert.ok(deletedAt > 0, 'the deletion must leave a tombstone');

  const restored = await restorePatientEntry(original);
  assert.ok(restored.updatedAt > deletedAt, 'the restore must be newer than the tombstone');
  assert.deepEqual((await getAllPatientEntries()).map((row) => row.id), ['undo-me']);
});

test('importing a snapshot is a union: new records are queued, existing ones are not rewritten', async () => {
  await activateLedgerOwner('uid-A');
  const existing = await savePatientEntry(visit('local-visit'));
  await ackAll('uid-A');

  const changed = await importLedgerSnapshot('uid-A', {
    patientEntries: [existing, visit('drive-only-visit', 'Sumon')],
  });
  assert.equal(changed, 1);
  assert.deepEqual(
    (await getAllPatientEntries()).map((row) => row.id).sort(),
    ['drive-only-visit', 'local-visit']
  );
  const pending = await readOutboxBatch('uid-A');
  assert.deepEqual(pending.map((item) => item.id), ['drive-only-visit']);
});

test('a patient profile keeps its edit time when visits are added (derived totals never bump it)', async () => {
  await activateLedgerOwner('uid-A');
  await savePatientEntry(visit('first', 'Nusrat'));
  const [profileAfterFirst] = await getAllPatientProfiles();
  assert.equal(profileAfterFirst.totalVisits, 1);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await savePatientEntry(visit('second', 'Nusrat', { date: '2026-10-11' }));
  const [profileAfterSecond] = await getAllPatientProfiles();
  assert.equal(profileAfterSecond.totalVisits, 2);
  assert.equal(profileAfterSecond.updatedAt, profileAfterFirst.updatedAt);
});

async function ackAll(owner: string): Promise<void> {
  for (const item of await readOutboxBatch(owner, 1000)) {
    await ackOutboxItem(owner, item.key, item.token);
  }
}
