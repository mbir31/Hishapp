import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  candidateWins,
  isSyncLedgerDataEmpty,
  mergeSyncLedgerData,
  normalizeRemoteRecord,
  recordFingerprint,
  recordVersion,
  syncLedgerDataEqual,
  type SyncLedgerData,
} from '../src/services/cloudSync';
import type { AuditLogEntry, PatientEntry, PatientProfile, Settlement } from '../src/types';

// ── Realtime Database returns records without empty arrays or null fields.
// Normalization restores the exact shape, so the same record always compares
// equal on every device.

test('records read back from the cloud are restored to the app shape', () => {
  const fromCloud = normalizeRemoteRecord('entry', {
    id: 'entry-1',
    serial: '7',
    date: '2026-10-10',
    patientName: 'Rahim',
    procedure: 'Filling',
    receivedAmount: '500',
    doctorShare: 200,
    settlementStatus: 'Pending',
    createdAt: 10,
    updatedAt: 11,
  });
  assert.equal(fromCloud.serial, 7);
  assert.equal(fromCloud.receivedAmount, 500);
  assert.equal(fromCloud.settlementId, null);
  assert.equal(fromCloud.remarks, '');
});

test('a settlement with an empty patient list is restored instead of dropped', () => {
  const restored = normalizeRemoteRecord('settlement', {
    settlementId: 'ST-20261010-01',
    settlementDate: '2026-10-10',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-10',
    createdAt: 5,
  });
  assert.deepEqual(restored.patientIds, []);
});

test('fingerprints ignore missing, null and undefined fields and key order', () => {
  const local = { id: 'a', name: 'X', phone: undefined, notes: null, procedures: [] as string[] };
  const cloud = { procedures: [], name: 'X', id: 'a' };
  assert.equal(recordFingerprint(local), recordFingerprint(cloud));
  assert.notEqual(recordFingerprint({ id: 'a', name: 'X' }), recordFingerprint({ id: 'a', name: 'Y' }));
});

test('the winner rule is deterministic: higher version wins, then larger fingerprint', () => {
  const older = patientEntry('visit', 10, 'Old');
  const newer = patientEntry('visit', 20, 'New');
  assert.equal(candidateWins('entry', newer, older), true);
  assert.equal(candidateWins('entry', older, newer), false);

  // Exact tie: exactly one side wins, and the same answer comes out on both devices.
  const a = patientEntry('visit', 30, 'Alpha');
  const b = patientEntry('visit', 30, 'Beta');
  assert.notEqual(candidateWins('entry', a, b), candidateWins('entry', b, a));
});

test('a record is never re-written when the cloud already holds an equal or winning copy', () => {
  const cloudCopy = patientEntry('visit', 50, 'Same');
  const localCopy = patientEntry('visit', 50, 'Same');
  assert.equal(candidateWins('entry', localCopy, cloudCopy), false);
  assert.equal(candidateWins('entry', cloudCopy, localCopy), false);
});

test('profile versions use the last user edit, not the derived recount', () => {
  assert.equal(recordVersion('profile', { createdAt: 5, updatedAt: 9 }), 9);
  assert.equal(recordVersion('settlement', { createdAt: 5, updatedAt: 9 }), 5);
  assert.equal(recordVersion('audit', { timestamp: 42 }), 42);
});

test('empty and equal snapshots are recognised regardless of record order', () => {
  assert.equal(isSyncLedgerDataEmpty({ patientEntries: [], settlements: [], auditLogs: [], patientProfiles: [] }), true);
  const first = syncData([patientEntry('b', 1), patientEntry('a', 1)]);
  const second = syncData([patientEntry('a', 1), patientEntry('b', 1)]);
  assert.equal(syncLedgerDataEqual(first, second), true);
  assert.equal(isSyncLedgerDataEmpty(first), false);
});

test('a tombstone with the same timestamp as the record deletes it, so a stale copy cannot revive it', () => {
  const entry = patientEntry('gone', 10);
  const tombstone = deletionAudit('gone', 10);
  const merged = mergeSyncLedgerData(syncData([], [tombstone]), syncData([entry]));
  assert.equal(merged.patientEntries.length, 0);
});

test('simultaneous new entries from two devices merge instead of overwriting each other', () => {
  const baseData = syncData([patientEntry('base-visit', 10)]);
  const deviceA = syncData([...baseData.patientEntries, patientEntry('device-a-visit', 20)]);
  const deviceB = syncData([...baseData.patientEntries, patientEntry('device-b-visit', 21)]);

  // Each device may start from the same cached version. A serializable RTDB
  // transaction retries the second merge against the first device's result.
  const afterDeviceA = mergeSyncLedgerData(baseData, deviceA);
  const afterDeviceB = mergeSyncLedgerData(deviceB, afterDeviceA);
  assert.deepEqual(
    afterDeviceB.patientEntries.map((row) => row.id).sort(),
    ['base-visit', 'device-a-visit', 'device-b-visit']
  );
});

test('the latest edit wins only for the same record ID', () => {
  const older = patientEntry('same-visit', 30, 'Older edit');
  const newer = patientEntry('same-visit', 40, 'Newer edit');
  const merged = mergeSyncLedgerData(syncData([older]), syncData([newer]));
  assert.equal(merged.patientEntries.length, 1);
  assert.equal(merged.patientEntries[0].patientName, 'Newer edit');
});

test('entry deletion tombstones sync to other devices and a later undo can restore the entry', () => {
  const oldEntry = patientEntry('deleted-visit', 10);
  const tombstone = deletionAudit('deleted-visit', 20);
  const deleted = mergeSyncLedgerData(syncData([oldEntry], [tombstone]), syncData([oldEntry]));
  assert.equal(deleted.patientEntries.length, 0);

  const undo = patientEntry('deleted-visit', 21, 'Restored patient');
  const restored = mergeSyncLedgerData(syncData([undo], [tombstone]), syncData([]));
  assert.equal(restored.patientEntries.length, 1);
  assert.equal(restored.patientEntries[0].patientName, 'Restored patient');
});

test('settlement deletion tombstones suppress stale batches but allow a later restore', () => {
  const oldSettlement = settlementRecord('settlement-one', 10);
  const tombstone: AuditLogEntry = {
    id: 'delete-settlement-one',
    timestamp: 20,
    action: 'SETTLEMENT_DELETED',
    targetId: oldSettlement.settlementId,
    targetType: 'settlement',
    details: 'Deleted settlement',
  };
  const deleted = mergeSyncLedgerData(
    { ...syncData([], [tombstone]), settlements: [] },
    { ...syncData([]), settlements: [oldSettlement] }
  );
  assert.deepEqual(deleted.settlements, []);

  const restored = mergeSyncLedgerData(
    { ...syncData([], [tombstone]), settlements: [settlementRecord('settlement-one', 21)] },
    { ...syncData([]), settlements: [] }
  );
  assert.equal(restored.settlements.length, 1);
  assert.equal(restored.settlements[0].createdAt, 21);
});

test('patient profiles and their contact details merge across devices by the latest revision', () => {
  const older = patientProfile('patient-one', 10, 'Old phone');
  const newer = patientProfile('patient-one', 20, 'Updated phone');
  const anotherPatient = patientProfile('patient-two', 15, 'Second phone');
  const merged = mergeSyncLedgerData(
    { ...syncData([]), patientProfiles: [older, anotherPatient] },
    { ...syncData([]), patientProfiles: [newer] }
  );

  assert.equal(merged.patientProfiles.length, 2);
  assert.equal(merged.patientProfiles.find((profile) => profile.id === 'patient-one')?.phone, 'Updated phone');
  assert.equal(merged.patientProfiles.find((profile) => profile.id === 'patient-two')?.phone, 'Second phone');
});

function syncData(patientEntries: PatientEntry[], auditLogs: AuditLogEntry[] = []): SyncLedgerData {
  return { patientEntries, settlements: [], auditLogs, patientProfiles: [] };
}

function patientEntry(id: string, updatedAt: number, patientName = id): PatientEntry {
  return {
    id,
    serial: 1,
    date: '2026-10-10',
    patientName,
    procedure: 'Visit',
    receivedAmount: 100,
    doctorShare: 40,
    settlementStatus: 'Pending',
    settlementId: null,
    remarks: '',
    createdAt: updatedAt,
    updatedAt,
  };
}

function settlementRecord(settlementId: string, createdAt: number): Settlement {
  return {
    settlementId,
    settlementDate: '2026-10-10',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-10',
    patientCount: 1,
    periodShare: 40,
    previousDue: 0,
    totalPayable: 40,
    amountReceived: 40,
    dueBalance: 0,
    remarks: '',
    patientIds: ['entry-one'],
    createdAt,
  };
}

function patientProfile(id: string, updatedAt: number, phone: string): PatientProfile {
  return {
    id,
    name: id,
    phone,
    notes: '',
    totalVisits: 1,
    totalBilled: 100,
    totalDoctorShare: 40,
    firstVisitDate: '2026-10-10',
    lastVisitDate: '2026-10-10',
    procedures: ['Visit'],
    createdAt: 1,
    updatedAt,
  };
}

function deletionAudit(targetId: string, timestamp: number): AuditLogEntry {
  return {
    id: `delete-${targetId}`,
    timestamp,
    action: 'ENTRY_DELETED',
    targetId,
    targetType: 'patient_entry',
    details: `Deleted ${targetId}`,
  };
}
