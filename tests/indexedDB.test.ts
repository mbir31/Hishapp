import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import {
  calculateSettlementSummary,
  clearAllPatientData,
  DEFAULT_AMOUNT_PRESETS,
  DEFAULT_PROCEDURES,
  exportAllDataJSON,
  getAllAuditLogs,
  getAllPatientEntries,
  getAllPatientProfiles,
  getAllSettlements,
  getNextSerial,
  getSettings,
  mergeRemoteSyncData,
  removeLegacyDemoData,
  restoreAllData,
  savePatientEntry,
  saveSettings,
} from '../src/db/indexedDB';
import type { AuditLogEntry, PatientEntry, PatientProfile, Settlement } from '../src/types';

interface Snapshot {
  patientEntries: PatientEntry[];
  settlements: Settlement[];
  patientProfiles: PatientProfile[];
  auditLogs: AuditLogEntry[];
}

// Captured from the original seeder, not generated from cleanup fingerprints.
const legacy: Snapshot = JSON.parse(
  readFileSync(new URL('./fixtures/legacyDemoBackup.json', import.meta.url), 'utf8')
);

const realEntry: PatientEntry = {
  id: 'entry-1791547200000-real',
  serial: 8,
  date: '2026-10-09',
  patientName: 'Actual Patient',
  procedure: 'RCT',
  receivedAmount: 1000,
  doctorShare: 400,
  settlementStatus: 'Settled',
  settlementId: 'ST-20261009-01',
  remarks: 'User-entered visit',
  createdAt: 1791547200000,
  updatedAt: 1791547200000,
};

const realSettlement: Settlement = {
  settlementId: 'ST-20261009-01',
  settlementDate: '2026-10-09',
  periodFrom: '2026-10-09',
  periodTo: '2026-10-09',
  patientCount: 1,
  periodShare: 400,
  previousDue: 0,
  totalPayable: 400,
  amountReceived: 200,
  dueBalance: 200,
  remarks: 'Actual clinic payment',
  patientIds: [realEntry.id],
  createdAt: realEntry.createdAt,
};

const realProfile: PatientProfile = {
  id: 'actual patient',
  name: realEntry.patientName,
  phone: '0123456789',
  notes: 'User-entered notes',
  totalVisits: 1,
  totalBilled: realEntry.receivedAmount,
  totalDoctorShare: realEntry.doctorShare,
  firstVisitDate: realEntry.date,
  lastVisitDate: realEntry.date,
  procedures: [realEntry.procedure],
  createdAt: realEntry.createdAt,
  updatedAt: realEntry.updatedAt,
};

const realAudit: AuditLogEntry = {
  id: 'audit-real',
  timestamp: realEntry.createdAt,
  action: 'ENTRY_CREATED',
  targetId: realEntry.id,
  targetType: 'patient_entry',
  details: 'User entered an actual visit',
  newData: realEntry,
};

beforeEach(() => {
  // Isolated browser database for each scenario, without changing app schema.
  globalThis.indexedDB = new IDBFactory();
});

async function populate(data: Partial<Snapshot>): Promise<void> {
  await getSettings(); // Create the same schema as a fresh app installation.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('DentalIncomeTrackerDB');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        ['patient_entries', 'settlements', 'patient_profiles', 'audit_logs'],
        'readwrite'
      );
      for (const entry of data.patientEntries || []) tx.objectStore('patient_entries').put(entry);
      for (const settlement of data.settlements || []) tx.objectStore('settlements').put(settlement);
      for (const profile of data.patientProfiles || []) tx.objectStore('patient_profiles').put(profile);
      for (const log of data.auditLogs || []) tx.objectStore('audit_logs').put(log);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function assertEmptyRecords(): Promise<void> {
  assert.deepEqual(await getAllPatientEntries(), []);
  assert.deepEqual(await getAllSettlements(), []);
  assert.deepEqual(await getAllPatientProfiles(), []);
  assert.deepEqual(await getAllAuditLogs(), []);
}

test('remote live-sync snapshots merge ledger records and patient profiles into IndexedDB', async () => {
  await getSettings();
  const changed = await mergeRemoteSyncData({
    patientEntries: [realEntry],
    settlements: [realSettlement],
    patientProfiles: [realProfile],
    auditLogs: [realAudit],
  });

  assert.equal(changed, true);
  assert.deepEqual(await getAllPatientEntries(), [realEntry]);
  assert.deepEqual(await getAllSettlements(), [realSettlement]);
  assert.deepEqual(await getAllAuditLogs(), [realAudit]);
  const [profile] = await getAllPatientProfiles();
  assert.equal(profile.id, realProfile.id);
  assert.equal(profile.phone, realProfile.phone);
  assert.equal(profile.notes, realProfile.notes);
  assert.equal(profile.totalVisits, 1);
  assert.equal(await mergeRemoteSyncData({
    patientEntries: [realEntry],
    settlements: [realSettlement],
    patientProfiles: [realProfile],
    auditLogs: [realAudit],
  }), false);
});

test('fresh databases have no sample records and retain all selection presets', async () => {
  assert.equal(await removeLegacyDemoData(), false);
  await assertEmptyRecords();
  assert.equal(await getNextSerial(), 1);
  const settings = await getSettings();
  assert.deepEqual(settings.procedures, DEFAULT_PROCEDURES);
  assert.deepEqual(settings.procedures, [
    'Visit',
    'RCT',
    'Filling',
    'Scaling',
    'Extraction',
    'Pulpectomy',
    'Crown',
    'Follow-up',
  ]);
  assert.deepEqual(settings.amountPresets, DEFAULT_AMOUNT_PRESETS);
  assert.deepEqual(settings.amountPresets?.map((preset) => preset.amount), [
    0, 0, 0, 500, 1000, 2000, 3000, 5000,
  ]);
  assert.equal(settings.amountPresets?.[0].label, 'No Payment');
  assert.equal(settings.amountPresets?.[1].label, 'Free Campaign');
  assert.equal(settings.amountPresets?.[2].label, 'Follow-up');
  assert.equal(settings.amountPresets?.[2].id, 'follow-up');
});

test('a customized list saved before the follow-up feature gets the preset once', async () => {
  await writeLegacySettingsRecord({
    procedures: ['Custom Treatment'],
    amountPresets: [{ id: 'custom-1250', label: 'Custom Payment', amount: 1250 }],
  });

  const settings = await getSettings();
  assert.deepEqual(settings.procedures, ['Custom Treatment', 'Follow-up']);
  assert.deepEqual(settings.amountPresets, [
    { id: 'follow-up', label: 'Follow-up', amount: 0 },
    { id: 'custom-1250', label: 'Custom Payment', amount: 1250 },
  ]);

  // The back-fill is written to the record once, next to the check flag.
  const raw = await readRawSettingsRecord();
  assert.deepEqual(raw.procedures, ['Custom Treatment', 'Follow-up']);
  assert.equal(raw.followUpPresetsChecked, true);

  // Removing the preset afterwards is respected — the check never runs again.
  const afterRemoval = await saveSettings({
    procedures: ['Custom Treatment'],
    amountPresets: [{ id: 'custom-1250', label: 'Custom Payment', amount: 1250 }],
  });
  assert.deepEqual(afterRemoval.procedures, ['Custom Treatment']);
  const reloaded = await getSettings();
  assert.deepEqual(reloaded.procedures, ['Custom Treatment']);
  assert.deepEqual(reloaded.amountPresets, [
    { id: 'custom-1250', label: 'Custom Payment', amount: 1250 },
  ]);
});

test('a stored list that already has Follow-up keeps the doctor own order', async () => {
  await writeLegacySettingsRecord({
    procedures: ['Follow-up', 'RCT'],
    amountPresets: [{ id: 'follow-up', label: 'Follow-up', amount: 0 }],
  });

  const settings = await getSettings();
  assert.deepEqual(settings.procedures, ['Follow-up', 'RCT']);
  assert.deepEqual(settings.amountPresets, [{ id: 'follow-up', label: 'Follow-up', amount: 0 }]);
});

test('cleans all old demo visits, payments and profiles without reseeding on reload', async () => {
  await populate(legacy);
  const settingsBefore = await getSettings();
  assert.equal(await removeLegacyDemoData(), true);
  await assertEmptyRecords();
  assert.deepEqual(await getSettings(), settingsBefore);
  assert.equal(await getNextSerial(), 1);

  const summary = await calculateSettlementSummary('2026-01-01', '2026-12-31', 0);
  assert.equal(summary.patientCount, 0);
  assert.equal(summary.periodShare, 0);
  assert.equal(summary.previousDue, 0);
  assert.equal(summary.totalPayable, 0);
  assert.equal(summary.remainingDuePreview, 0);
  const exported = JSON.parse(await exportAllDataJSON());
  assert.deepEqual(exported.patientEntries, []);
  assert.deepEqual(exported.settlements, []);

  assert.equal(await removeLegacyDemoData(), false);
  await assertEmptyRecords();
});

test('preserves genuine records, payments, profiles, audit logs and customized presets', async () => {
  const settingsBefore = await saveSettings({
    doctorName: 'User Doctor',
    procedures: ['Custom Treatment'],
    amountPresets: [{ id: 'custom-1250', label: 'Custom Payment', amount: 1250 }],
    driveFolderId: 'user-drive-folder',
    ledgerSpreadsheetId: 'user-ledger',
    lastDriveSnapshotTimestamp: 123456,
  });
  await populate({
    patientEntries: [...legacy.patientEntries, realEntry],
    settlements: [...legacy.settlements, realSettlement],
    patientProfiles: [...legacy.patientProfiles, realProfile],
    auditLogs: [realAudit],
  });

  assert.equal(await removeLegacyDemoData(), true);
  assert.deepEqual(await getAllPatientEntries(), [realEntry]);
  assert.deepEqual(await getAllSettlements(), [realSettlement]);
  assert.deepEqual(await getAllPatientProfiles(), [realProfile]);
  assert.deepEqual(await getAllAuditLogs(), [realAudit]);
  assert.deepEqual(await getSettings(), settingsBefore);
  assert.equal(await getNextSerial(), 9);
  assert.equal((await calculateSettlementSummary('2026-01-01', '2026-12-31', 0)).previousDue, 200);
});

test('does not classify genuine visits or payments by sample IDs or names alone', async () => {
  const sameName = { ...legacy.patientEntries[0], id: realEntry.id, serial: 8 };
  const sameId = { ...realEntry, id: 'entry-4', serial: 4 };
  const samePaymentId = { ...realSettlement, settlementId: legacy.settlements[0].settlementId };
  await populate({
    patientEntries: [...legacy.patientEntries, sameName, sameId],
    settlements: [samePaymentId],
  });

  assert.equal(await removeLegacyDemoData(), true);
  assert.deepEqual((await getAllPatientEntries()).map((entry) => entry.id).sort(), [sameId.id, sameName.id].sort());
  assert.deepEqual(await getAllSettlements(), [samePaymentId]);
});

test('preserves user-audited visits and payments even if their sample fingerprints still match', async () => {
  const editedEntry = legacy.patientEntries.find((entry) => entry.id === 'entry-3')!;
  const editedPayment = legacy.settlements[0];
  const entryAudit: AuditLogEntry = { ...realAudit, id: 'audit-edit', action: 'ENTRY_EDITED', targetId: editedEntry.id };
  const paymentAudit: AuditLogEntry = {
    ...realAudit,
    id: 'audit-payment',
    action: 'SETTLEMENT_CREATED',
    targetId: editedPayment.settlementId,
    targetType: 'settlement',
  };
  await populate({ ...legacy, auditLogs: [entryAudit, paymentAudit] });

  assert.equal(await removeLegacyDemoData(), true);
  assert.deepEqual(await getAllPatientEntries(), [editedEntry]);
  assert.deepEqual(await getAllSettlements(), [editedPayment]);
  assert.equal((await getAllAuditLogs()).length, 2);
});

test('preserves date-only edits even when an old backup has no audit trail', async () => {
  const dateEditedEntry = { ...legacy.patientEntries.find((entry) => entry.id === 'entry-3')!, date: '2026-10-09' };
  const dateEditedPayment = { ...legacy.settlements[0], settlementDate: '2026-10-09' };
  await populate({
    patientEntries: [...legacy.patientEntries, dateEditedEntry],
    settlements: [dateEditedPayment],
  });

  assert.equal(await removeLegacyDemoData(), true);
  assert.deepEqual(await getAllPatientEntries(), [dateEditedEntry]);
  assert.deepEqual(await getAllSettlements(), [dateEditedPayment]);
});

test('retains a demo-looking payment when a genuine visit still references it', async () => {
  const linkedEntry = { ...realEntry, settlementId: legacy.settlements[0].settlementId };
  await populate({ ...legacy, patientEntries: [...legacy.patientEntries, linkedEntry] });

  assert.equal(await removeLegacyDemoData(), true);
  assert.deepEqual(await getAllPatientEntries(), [linkedEntry]);
  assert.deepEqual(await getAllSettlements(), legacy.settlements);
});

test('recalculates shared-name profiles from genuine visits while retaining contact notes', async () => {
  const sharedNameEntry = { ...realEntry, patientName: 'Amina Begum' };
  const sharedProfile = { ...legacy.patientProfiles.find((profile) => profile.name === 'Amina Begum')!, phone: '0123456789', notes: 'Real patient notes' };
  await populate({
    ...legacy,
    patientEntries: [...legacy.patientEntries, sharedNameEntry],
    patientProfiles: [...legacy.patientProfiles, sharedProfile],
  });

  assert.equal(await removeLegacyDemoData(), true);
  assert.deepEqual(await getAllPatientEntries(), [sharedNameEntry]);
  const [profile] = await getAllPatientProfiles();
  assert.equal(profile.name, sharedNameEntry.patientName);
  assert.equal(profile.totalVisits, 1);
  assert.equal(profile.totalBilled, sharedNameEntry.receivedAmount);
  assert.equal(profile.totalDoctorShare, sharedNameEntry.doctorShare);
  assert.equal(profile.firstVisitDate, sharedNameEntry.date);
  assert.equal(profile.lastVisitDate, sharedNameEntry.date);
  assert.deepEqual(profile.procedures, [sharedNameEntry.procedure]);
  assert.equal(profile.phone, sharedProfile.phone);
  assert.equal(profile.notes, sharedProfile.notes);
});

test('keeps user-added profile notes without leaving sample billing totals', async () => {
  const customProfile = { ...legacy.patientProfiles[0], notes: 'Keep these user notes' };
  await populate({ ...legacy, patientProfiles: [...legacy.patientProfiles, customProfile] });

  assert.equal(await removeLegacyDemoData(), true);
  assert.deepEqual(await getAllPatientEntries(), []);
  assert.deepEqual(await getAllSettlements(), []);
  const [profile] = await getAllPatientProfiles();
  assert.equal(profile.notes, customProfile.notes);
  assert.equal(profile.totalVisits, 0);
  assert.equal(profile.totalBilled, 0);
  assert.equal(profile.totalDoctorShare, 0);
  assert.deepEqual(profile.procedures, []);
});

test('does not remove standalone profiles merely because they share a sample name', async () => {
  const genuineProfile = { ...legacy.patientProfiles[0], totalVisits: 3, totalBilled: 12000, totalDoctorShare: 4800 };
  await populate({ ...legacy, patientProfiles: [...legacy.patientProfiles, genuineProfile] });

  assert.equal(await removeLegacyDemoData(), true);
  assert.deepEqual(await getAllPatientProfiles(), [genuineProfile]);
});

test('restoring an old backup cannot reintroduce untouched demo records', async () => {
  const current = await saveSettings({
    procedures: ['Custom Treatment'],
    amountPresets: [{ id: 'custom-1250', label: 'Custom Payment', amount: 1250 }],
  });
  await restoreAllData(legacy);
  await assertEmptyRecords();
  // The legacy backup pre-dates the follow-up preset, so restoring it re-runs
  // the one-time back-fill on the doctor's own lists (everything else is kept).
  assert.deepEqual(await getSettings(), {
    ...current,
    procedures: ['Custom Treatment', 'Follow-up'],
    amountPresets: [
      { id: 'follow-up', label: 'Follow-up', amount: 0 },
      { id: 'custom-1250', label: 'Custom Payment', amount: 1250 },
    ],
  });

  await restoreAllData({
    patientEntries: [...legacy.patientEntries, realEntry],
    settlements: [...legacy.settlements, realSettlement],
    patientProfiles: [...legacy.patientProfiles, realProfile],
    auditLogs: [realAudit],
    settings: current,
  });
  assert.deepEqual(await getAllPatientEntries(), [realEntry]);
  assert.deepEqual(await getAllSettlements(), [realSettlement]);
  assert.deepEqual(await getAllPatientProfiles(), [realProfile]);
  assert.deepEqual(await getSettings(), current);
});

test('restoring a backup never re-tags the dataset owner of this device', async () => {
  await saveSettings({ dataOwnerUid: 'device-owner-uid' });
  await restoreAllData({
    patientEntries: [realEntry],
    settlements: [],
    settings: { dataOwnerUid: 'someone-else-uid' },
  });
  // The device's ownership tag survives the restore; the backup engine sets
  // it explicitly after Drive restores (see backupEngine/cloudSync).
  assert.equal((await getSettings()).dataOwnerUid, 'device-owner-uid');
  assert.deepEqual(await getAllPatientEntries(), [realEntry]);
});

test('clearing the patient dataset empties all record stores but keeps settings untouched', async () => {
  const settingsBefore = await saveSettings({
    clinicName: 'Smile Studio',
    doctorName: 'Dr. Ayesha Rahman',
    dataOwnerUid: 'firebase-uid-123',
    lastDriveSnapshotTimestamp: 123456,
  });
  await populate({
    patientEntries: [realEntry],
    settlements: [realSettlement],
    patientProfiles: [realProfile],
    auditLogs: [realAudit],
  });

  await clearAllPatientData();

  // Every record store is empty — the previous account's data is gone from
  // this device — while the settings record (incl. the dataset owner tag
  // used for account-switch detection) is preserved.
  await assertEmptyRecords();
  assert.deepEqual(await getSettings(), settingsBefore);
  assert.equal(await getNextSerial(), 1);

  // Clearing an already empty database is a harmless no-op.
  await clearAllPatientData();
  await assertEmptyRecords();
});

test('the first real visit starts at serial 1 and survives subsequent startup cleanup', async () => {
  await removeLegacyDemoData();
  const firstEntry: PatientEntry = {
    ...realEntry,
    serial: await getNextSerial(),
    settlementStatus: 'Pending',
    settlementId: null,
  };
  assert.equal(firstEntry.serial, 1);
  await savePatientEntry(firstEntry);

  assert.equal(await removeLegacyDemoData(), false);
  assert.deepEqual(await getAllPatientEntries(), [firstEntry]);
  assert.equal((await getAllPatientProfiles()).length, 1);
  assert.equal((await getAllAuditLogs()).length, 1);
  assert.deepEqual(await getAllSettlements(), []);
  assert.equal(await getNextSerial(), 2);
});

// ── No pre-loaded account ──────────────────────────────────────────────
// Only the clinic name + logo ship with the app. The doctor / account
// identity may never appear until the user signs in with their own Gmail
// (backupEngine) or types it by hand in Settings.

test('fresh installations preload the clinic branding but no doctor identity', async () => {
  const settings = await getSettings();
  assert.equal(settings.clinicName, 'Yashfin Dental Care');
  assert.equal(settings.clinicLogo, '/dlogo.png');
  assert.equal(settings.doctorName, '');
  assert.equal(settings.doctorEmail, '');
  assert.equal(settings.doctorPhoto, '');
  assert.equal(settings.ownerUid, null);
});

// Writes a settings record the way builds before the one-time placeholder check did.
async function writeLegacySettingsRecord(value: Record<string, unknown>): Promise<void> {
  await getSettings(); // Creates the database and its stores, like a fresh installation.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('DentalIncomeTrackerDB');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key: 'app_settings', value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

test('the old hard-coded doctor name is scrubbed once so no account is preloaded', async () => {
  await writeLegacySettingsRecord({
    clinicName: 'Yashfin Dental Care',
    doctorName: 'Dr. MBR (BDS, PGT-OMS)',
    doctorEmail: 'preset@example.com',
    doctorPhoto: 'https://example.com/preset.png',
    ownerUid: 'legacy-uid',
  });
  const settings = await getSettings();
  assert.equal(settings.doctorName, '');
  assert.equal(settings.doctorEmail, '');
  assert.equal(settings.doctorPhoto, '');
  assert.equal(settings.ownerUid, null);
  // The clinic branding is untouched by the cleanup.
  assert.equal(settings.clinicName, 'Yashfin Dental Care');
  assert.equal(settings.clinicLogo, '/dlogo.png');
});

test('a placeholder-looking name typed on a fresh installation is kept', async () => {
  await saveSettings({ doctorName: 'Dr. MBR (BDS, PGT-OMS)' });
  assert.equal((await getSettings()).doctorName, 'Dr. MBR (BDS, PGT-OMS)');
  await saveSettings({ sharePercentage: 45 });
  assert.equal((await getSettings()).doctorName, 'Dr. MBR (BDS, PGT-OMS)');
});

test('a placeholder-looking name typed after the one-time cleanup is kept', async () => {
  await writeLegacySettingsRecord({ doctorName: 'Dr. MBR (BDS, PGT-OMS)' });
  assert.equal((await getSettings()).doctorName, '');
  await saveSettings({ doctorName: 'Dr. MBR (BDS, PGT-OMS)' });
  assert.equal((await getSettings()).doctorName, 'Dr. MBR (BDS, PGT-OMS)');
});

async function readRawSettingsRecord(): Promise<Record<string, any>> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('DentalIncomeTrackerDB');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise<Record<string, any>>((resolve, reject) => {
      const req = db.transaction('settings', 'readonly').objectStore('settings').get('app_settings');
      req.onsuccess = () => resolve(req.result?.value);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

test('the one-time placeholder check changes only the identity fields in storage', async () => {
  await writeLegacySettingsRecord({ doctorName: 'Dr. MBR (BDS, PGT-OMS)', sharePercentage: 45 });
  await getSettings();
  const raw = await readRawSettingsRecord();
  assert.equal(raw.doctorName, '');
  assert.equal(raw.sharePercentage, 45);
  assert.equal(raw.procedures, undefined); // Defaults are not frozen into the saved record.
  assert.equal(raw.legacyIdentityChecked, true);
});

test('restoring an older backup still clears its placeholder name', async () => {
  await restoreAllData({
    patientEntries: [],
    settlements: [],
    settings: { doctorName: 'Dr. MBR (BDS, PGT-OMS)', ownerUid: 'legacy-uid' },
  });
  const settings = await getSettings();
  assert.equal(settings.doctorName, '');
  assert.equal(settings.ownerUid, null);
});

test('restoring a backup made by this build keeps a name typed as a placeholder', async () => {
  await restoreAllData({
    patientEntries: [],
    settlements: [],
    settings: { doctorName: 'Dr. MBR (BDS, PGT-OMS)', legacyIdentityChecked: true },
  });
  assert.equal((await getSettings()).doctorName, 'Dr. MBR (BDS, PGT-OMS)');
});

test('a doctor identity set by the signed-in Google account is preserved', async () => {
  await saveSettings({
    doctorName: 'Dr. Ayesha Rahman',
    doctorEmail: 'ayesha@gmail.com',
    doctorPhoto: 'https://example.com/ayesha.png',
    ownerUid: 'firebase-uid-123',
  });
  const settings = await getSettings();
  assert.equal(settings.doctorName, 'Dr. Ayesha Rahman');
  assert.equal(settings.doctorEmail, 'ayesha@gmail.com');
  assert.equal(settings.doctorPhoto, 'https://example.com/ayesha.png');
  assert.equal(settings.ownerUid, 'firebase-uid-123');
});

test('a doctor name typed by hand is preserved even without a Google account', async () => {
  await saveSettings({ doctorName: 'Dr. Self Typed' });
  const settings = await getSettings();
  assert.equal(settings.doctorName, 'Dr. Self Typed');
  assert.equal(settings.ownerUid, null);
});

test('clearing the identity on sign-out leaves the clinic branding in place', async () => {
  await saveSettings({
    clinicName: 'Smile Studio',
    doctorName: 'Dr. Ayesha Rahman',
    doctorEmail: 'ayesha@gmail.com',
    ownerUid: 'firebase-uid-123',
  });
  await saveSettings({ doctorName: '', doctorEmail: '', doctorPhoto: '', ownerUid: null });
  const settings = await getSettings();
  assert.equal(settings.clinicName, 'Smile Studio');
  assert.equal(settings.clinicLogo, '/dlogo.png');
  assert.equal(settings.doctorName, '');
  assert.equal(settings.doctorEmail, '');
});
