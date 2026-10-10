import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decideSignInSync,
  isAccountSwitch,
  mergeSyncLedgerData,
  type SignInSyncInput,
  type SyncLedgerData,
} from '../src/services/cloudSync';
import type { AuditLogEntry, PatientEntry, PatientProfile, Settlement } from '../src/types';

const base: SignInSyncInput = {
  userUid: 'uid-B',
  previousUserUid: null,
  dataOwnerUid: null,
  localHasData: true,
  cloudHasData: true,
  cloudSnapshotAt: 2000,
  lastSyncedAt: 1000,
};

const decide = (overrides: Partial<SignInSyncInput>) => decideSignInSync({ ...base, ...overrides });

// ── The reported bug: logout of account A, login of account B on the same
// device. The local cache still holds A's records; B's Drive backup must win.

test('account switch (persisted dataOwnerUid) restores the new account cloud backup over the local cache', () => {
  const decision = decide({ dataOwnerUid: 'uid-A', localHasData: true, cloudHasData: true });
  assert.equal(decision.action, 'restore-cloud');
  assert.equal(decision.accountSwitched, true);
});

test('account switch with no cloud backup clears the previous account cache instead of showing it', () => {
  const decision = decide({ dataOwnerUid: 'uid-A', localHasData: true, cloudHasData: false });
  assert.equal(decision.action, 'clear-local');
  assert.equal(decision.accountSwitched, true);
});

test('account switch is detected from the previous session user even without a persisted tag (legacy installs)', () => {
  const withCloud = decide({ previousUserUid: 'uid-A', dataOwnerUid: null, cloudHasData: true });
  assert.equal(withCloud.action, 'restore-cloud');
  assert.equal(withCloud.accountSwitched, true);

  const withoutCloud = decide({ previousUserUid: 'uid-A', dataOwnerUid: null, cloudHasData: false });
  assert.equal(withoutCloud.action, 'clear-local');
  assert.equal(withoutCloud.accountSwitched, true);
});

test('an account switch never keeps the local cache, even when the cloud copy is older', () => {
  const decision = decide({
    dataOwnerUid: 'uid-A',
    localHasData: true,
    cloudHasData: true,
    cloudSnapshotAt: 500, // older than the device's last sync point
    lastSyncedAt: 9000,
  });
  assert.equal(decision.action, 'restore-cloud');
  assert.equal(decision.accountSwitched, true);
});

// ── Same account: offline edits made while signed out must survive sign-in.

test('same-account data is merged even when the Drive snapshot is not newer (offline edits are protected)', () => {
  const decision = decide({
    userUid: 'uid-A',
    dataOwnerUid: 'uid-A',
    previousUserUid: 'uid-A',
    localHasData: true,
    cloudHasData: true,
    cloudSnapshotAt: 1000,
    lastSyncedAt: 1000, // this device made the newest backup
  });
  assert.equal(decision.action, 'merge-cloud');
  assert.equal(decision.accountSwitched, false);
});

test('same account merges a newer Drive snapshot instead of replacing local data (multi-device sync)', () => {
  const decision = decide({
    userUid: 'uid-A',
    dataOwnerUid: 'uid-A',
    previousUserUid: null,
    localHasData: true,
    cloudHasData: true,
    cloudSnapshotAt: 5000,
    lastSyncedAt: 1000,
  });
  assert.equal(decision.action, 'merge-cloud');
  assert.equal(decision.accountSwitched, false);
});

// ── Fresh devices / wiped browsers keep the original auto-restore behavior.

test('empty local cache adopts the cloud backup (new device auto-restore)', () => {
  const decision = decide({ localHasData: false, cloudHasData: true });
  assert.equal(decision.action, 'restore-cloud');
  assert.equal(decision.accountSwitched, false);
});

test('empty local cache without cloud backup stays empty (nothing to restore)', () => {
  const decision = decide({ localHasData: false, cloudHasData: false });
  assert.equal(decision.action, 'keep-local');
  assert.equal(decision.accountSwitched, false);
});

// ── Never-synced local data (app used while signed out, then first sign-in).

test('cloud takes priority over never-synced local data when the account already has backups', () => {
  const decision = decide({
    dataOwnerUid: null,
    previousUserUid: null,
    localHasData: true,
    cloudHasData: true,
    cloudSnapshotAt: 2000,
    lastSyncedAt: 0,
  });
  assert.equal(decision.action, 'restore-cloud');
  assert.equal(decision.accountSwitched, false);
});

test('never-synced local data is kept and claimed when the account has no backups', () => {
  const decision = decide({
    dataOwnerUid: null,
    previousUserUid: null,
    localHasData: true,
    cloudHasData: false,
    lastSyncedAt: 0,
  });
  assert.equal(decision.action, 'keep-local');
  assert.equal(decision.accountSwitched, false);
});

// ── isAccountSwitch signal checks.

test('isAccountSwitch only fires for a genuinely different account', () => {
  assert.equal(isAccountSwitch({ userUid: 'uid-A', previousUserUid: null, dataOwnerUid: null }), false);
  assert.equal(isAccountSwitch({ userUid: 'uid-A', previousUserUid: 'uid-A', dataOwnerUid: 'uid-A' }), false);
  assert.equal(isAccountSwitch({ userUid: 'uid-B', previousUserUid: 'uid-A', dataOwnerUid: 'uid-A' }), true);
  assert.equal(isAccountSwitch({ userUid: 'uid-B', previousUserUid: null, dataOwnerUid: 'uid-A' }), true);
  assert.equal(isAccountSwitch({ userUid: 'uid-B', previousUserUid: 'uid-A', dataOwnerUid: null }), true);
  // A restored session of the same account (page reload) is not a switch.
  assert.equal(isAccountSwitch({ userUid: 'uid-A', previousUserUid: null, dataOwnerUid: 'uid-A' }), false);
});

// ── Realtime multi-device record reconciliation. ──

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
