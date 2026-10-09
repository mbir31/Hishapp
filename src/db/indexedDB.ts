import { AmountPreset, AuditLogEntry, ClinicSettings, PatientEntry, PatientProfile, Settlement } from '../types';
import { isLegacyDemoEntry, isLegacyDemoProfile, isLegacyDemoSettlement } from './legacyDemoData';

const DB_NAME = 'DentalIncomeTrackerDB';
const DB_VERSION = 3;

export const DEFAULT_PROCEDURES: string[] = [
  'Visit',
  'RCT',
  'Filling',
  'Scaling',
  'Extraction',
  'Pulpectomy',
  'Crown',
];

export const DEFAULT_AMOUNT_PRESETS: AmountPreset[] = [
  { id: 'no-pay', label: 'No Payment', amount: 0 },
  { id: 'free-camp', label: 'Free Campaign', amount: 0 },
  { id: 'amt-500', label: '500', amount: 500 },
  { id: 'amt-1000', label: '1000', amount: 1000 },
  { id: 'amt-2000', label: '2000', amount: 2000 },
  { id: 'amt-3000', label: '3000', amount: 3000 },
  { id: 'amt-5000', label: '5000', amount: 5000 },
];

/** Pre-loaded clinic branding only — no account / doctor identity is preset. */
export const DEFAULT_CLINIC_NAME = 'Yashfin Dental Care';
export const DEFAULT_CLINIC_LOGO = '/dlogo.png';

/**
 * Doctor names that used to ship pre-filled with the app. They are NOT real
 * accounts, so any profile still carrying one is treated as "no account yet"
 * and cleared — the doctor identity is only ever taken from the user's own
 * Gmail sign-in (or typed by hand in Settings).
 */
export const PRESET_DOCTOR_NAMES = [
  'Dr. MBR (BDS, PGT-OMS)',
  'Dr. MBR',
  'Dr. Dental Surgeon',
  'Dental Surgeon',
  'Doctor',
];

export const DEFAULT_SETTINGS: ClinicSettings = {
  clinicName: DEFAULT_CLINIC_NAME,
  clinicLogo: DEFAULT_CLINIC_LOGO,
  doctorName: '',
  doctorEmail: '',
  doctorPhoto: '',
  ownerUid: null,
  currencySymbol: '৳',
  sharePercentage: 40,
  autoBackup: true,
  lastDriveSnapshotTimestamp: null,
  driveFolderId: null,
  ledgerSpreadsheetId: null,
  procedures: DEFAULT_PROCEDURES,
  amountPresets: DEFAULT_AMOUNT_PRESETS,
  legacyIdentityChecked: true,
};

// Open or upgrade IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('patient_entries')) {
        const store = db.createObjectStore('patient_entries', { keyPath: 'id' });
        store.createIndex('serial', 'serial', { unique: false });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('settlementStatus', 'settlementStatus', { unique: false });
        store.createIndex('settlementId', 'settlementId', { unique: false });
      }

      if (!db.objectStoreNames.contains('settlements')) {
        const store = db.createObjectStore('settlements', { keyPath: 'settlementId' });
        store.createIndex('settlementDate', 'settlementDate', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains('audit_logs')) {
        const store = db.createObjectStore('audit_logs', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('action', 'action', { unique: false });
        store.createIndex('targetId', 'targetId', { unique: false });
      }

      if (!db.objectStoreNames.contains('patient_profiles')) {
        const store = db.createObjectStore('patient_profiles', { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('totalVisits', 'totalVisits', { unique: false });
        store.createIndex('lastVisitDate', 'lastVisitDate', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Helper generic transaction
async function getStore(storeName: string, mode: IDBTransactionMode): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
  const db = await openDB();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  return { store, tx };
}

// ---------------- Patient Entries ---------------- //

export async function getAllPatientEntries(): Promise<PatientEntry[]> {
  const { store } = await getStore('patient_entries', 'readonly');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = (request.result || []) as PatientEntry[];
      // sort by date desc, then serial desc
      entries.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return b.serial - a.serial;
      });
      resolve(entries);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getNextSerial(): Promise<number> {
  const entries = await getAllPatientEntries();
  if (entries.length === 0) return 1;
  const maxSerial = Math.max(...entries.map((e) => e.serial || 0));
  return maxSerial + 1;
}

export async function savePatientEntry(entry: PatientEntry): Promise<PatientEntry> {
  const { store, tx } = await getStore('patient_entries', 'readwrite');
  
  // Check if updating or creating for audit trail
  const existingReq = store.get(entry.id);
  existingReq.onsuccess = () => {
    const existing = existingReq.result as PatientEntry | undefined;
    if (existing) {
      logAudit({
        action: 'ENTRY_EDITED',
        targetId: entry.id,
        targetType: 'patient_entry',
        details: `Edited record for ${entry.patientName} (${entry.procedure}) - Bill: ৳${entry.receivedAmount}, Share: ৳${entry.doctorShare}`,
        previousData: existing,
        newData: entry,
      });
    } else {
      logAudit({
        action: 'ENTRY_CREATED',
        targetId: entry.id,
        targetType: 'patient_entry',
        details: `Created record #${entry.serial} for ${entry.patientName} (${entry.procedure}) - Bill: ৳${entry.receivedAmount}`,
        newData: entry,
      });
    }
  };

  return new Promise((resolve, reject) => {
    store.put(entry);
    tx.oncomplete = async () => {
      // Automatically create or update the patient's profile
      try {
        await updateProfileForPatient(entry.patientName);
      } catch (err) {
        console.warn('Auto profile update notice:', err);
      }
      resolve(entry);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deletePatientEntry(id: string): Promise<void> {
  const { store, tx } = await getStore('patient_entries', 'readwrite');
  let deletedPatientName: string | null = null;
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const existing = getReq.result as PatientEntry | undefined;
    if (existing) {
      deletedPatientName = existing.patientName;
      logAudit({
        action: 'ENTRY_DELETED',
        targetId: id,
        targetType: 'patient_entry',
        details: `Deleted record of ${existing.patientName} (${existing.procedure}) dated ${existing.date} - Bill: ৳${existing.receivedAmount}`,
        previousData: existing,
      });
    }
  };

  return new Promise((resolve, reject) => {
    store.delete(id);
    tx.oncomplete = async () => {
      if (deletedPatientName) {
        try {
          await updateProfileForPatient(deletedPatientName);
        } catch (err) {
          console.warn('Auto profile recalculation after delete notice:', err);
        }
      }
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- Patient Profiles ---------------- //

export function normalizePatientName(name: string): string {
  return (name || '').trim().toLowerCase();
}

/**
 * Recalculate or create a profile for a given patient name based on their entries
 */
export async function updateProfileForPatient(rawName: string): Promise<PatientProfile | null> {
  const trimmed = (rawName || '').trim();
  if (!trimmed) return null;
  const profileId = normalizePatientName(trimmed);

  const allEntries = await getAllPatientEntries();
  const patientEntries = allEntries.filter(
    (e) => normalizePatientName(e.patientName) === profileId
  );

  if (patientEntries.length === 0) {
    // If no entries left, we can remove the profile or keep an empty one;
    // let's check if an existing profile had custom notes/phone before removing
    const existing = await getPatientProfileById(profileId);
    if (existing) {
      const { store, tx } = await getStore('patient_profiles', 'readwrite');
      store.delete(profileId);
      await new Promise((r) => {
        tx.oncomplete = r;
        tx.onerror = r;
      });
    }
    return null;
  }

  // Sort chronologically ascending for first visit, descending for last visit
  const sortedDates = [...patientEntries].sort((a, b) => a.date.localeCompare(b.date));
  const firstVisitDate = sortedDates[0].date;
  const lastVisitDate = sortedDates[sortedDates.length - 1].date;

  const totalVisits = patientEntries.length;
  const totalBilled = patientEntries.reduce((sum, e) => sum + (e.receivedAmount || 0), 0);
  const totalDoctorShare = patientEntries.reduce((sum, e) => sum + (e.doctorShare || 0), 0);
  
  // Unique list of procedures received
  const procSet = new Set<string>();
  patientEntries.forEach((e) => {
    if (e.procedure && e.procedure.trim()) {
      procSet.add(e.procedure.trim());
    }
  });
  const procedures = Array.from(procSet);

  // Preserve any existing custom notes or phone number
  const existing = await getPatientProfileById(profileId);

  // Use the most recent well-cased name
  const displayName = patientEntries[0]?.patientName?.trim() || trimmed;

  const profile: PatientProfile = {
    id: profileId,
    name: displayName,
    phone: existing?.phone || '',
    notes: existing?.notes || '',
    totalVisits,
    totalBilled,
    totalDoctorShare,
    firstVisitDate,
    lastVisitDate,
    procedures,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  const { store, tx } = await getStore('patient_profiles', 'readwrite');
  store.put(profile);
  await new Promise((r) => {
    tx.oncomplete = r;
    tx.onerror = r;
  });

  return profile;
}

export async function getPatientProfileById(id: string): Promise<PatientProfile | null> {
  try {
    const { store } = await getStore('patient_profiles', 'readonly');
    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as PatientProfile) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function getAllPatientProfiles(): Promise<PatientProfile[]> {
  try {
    const { store } = await getStore('patient_profiles', 'readonly');
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || []) as PatientProfile[];
        // Sort by last visit descending, then total visits desc
        list.sort((a, b) => b.lastVisitDate.localeCompare(a.lastVisitDate) || b.totalVisits - a.totalVisits);
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function savePatientProfile(profile: PatientProfile): Promise<PatientProfile> {
  const { store, tx } = await getStore('patient_profiles', 'readwrite');
  return new Promise((resolve, reject) => {
    profile.updatedAt = Date.now();
    store.put(profile);
    tx.oncomplete = () => resolve(profile);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Re-indexes all existing patient entries to build or update patient profiles
 * (useful on initialization or when syncing data)
 */
export async function syncAllPatientProfiles(): Promise<PatientProfile[]> {
  const allEntries = await getAllPatientEntries();
  const namesMap = new Map<string, string>();
  allEntries.forEach((e) => {
    const norm = normalizePatientName(e.patientName);
    if (norm) {
      if (!namesMap.has(norm)) {
        namesMap.set(norm, e.patientName.trim());
      }
    }
  });

  for (const rawName of namesMap.values()) {
    await updateProfileForPatient(rawName);
  }

  return getAllPatientProfiles();
}

// ---------------- Settlements ---------------- //

export async function getAllSettlements(): Promise<Settlement[]> {
  const { store } = await getStore('settlements', 'readonly');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const settlements = (request.result || []) as Settlement[];
      settlements.sort((a, b) => b.settlementDate.localeCompare(a.settlementDate) || b.createdAt - a.createdAt);
      resolve(settlements);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getLatestSettlement(): Promise<Settlement | null> {
  const settlements = await getAllSettlements();
  return settlements.length > 0 ? settlements[0] : null;
}

export async function saveSettlement(settlement: Settlement): Promise<Settlement> {
  const { store, tx } = await getStore('settlements', 'readwrite');
  return new Promise((resolve, reject) => {
    store.put(settlement);
    tx.oncomplete = () => resolve(settlement);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSettlement(settlementId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(['settlements', 'patient_entries'], 'readwrite');
  const settlementStore = tx.objectStore('settlements');
  const patientStore = tx.objectStore('patient_entries');

  // Find entries that had this settlementId and revert them to Pending
  const allEntriesReq = patientStore.getAll();
  allEntriesReq.onsuccess = () => {
    const entries = allEntriesReq.result as PatientEntry[];
    for (const entry of entries) {
      if (entry.settlementId === settlementId) {
        entry.settlementStatus = 'Pending';
        entry.settlementId = null;
        patientStore.put(entry);
      }
    }
  };

  settlementStore.delete(settlementId);

  logAudit({
    action: 'SETTLEMENT_DELETED',
    targetId: settlementId,
    targetType: 'settlement',
    details: `Deleted settlement batch ${settlementId} - Associated patients reverted to Pending`,
  });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- Settlement Carry-Forward Calculation ---------------- //

export interface SettlementCalculation {
  eligibleEntries: PatientEntry[];
  patientCount: number;
  periodShare: number; // 40% sum of eligible entries
  previousDue: number; // carry forward balance from prior settlement
  totalPayable: number; // periodShare + previousDue
  remainingDuePreview: number; // totalPayable - amountReceived
}

export async function calculateSettlementSummary(
  periodFrom: string,
  periodTo: string,
  amountReceived: number
): Promise<SettlementCalculation> {
  const allEntries = await getAllPatientEntries();
  const latestSettlement = await getLatestSettlement();

  // Filter pending entries within the selected date range
  const eligibleEntries = allEntries.filter(
    (e) => e.settlementStatus === 'Pending' && e.date >= periodFrom && e.date <= periodTo
  );

  const periodShare = eligibleEntries.reduce((sum, e) => sum + e.doctorShare, 0);
  const previousDue = latestSettlement ? latestSettlement.dueBalance : 0;
  const totalPayable = periodShare + previousDue;
  const remainingDuePreview = totalPayable - amountReceived;

  return {
    eligibleEntries,
    patientCount: eligibleEntries.length,
    periodShare,
    previousDue,
    totalPayable,
    remainingDuePreview,
  };
}

export async function executeSettlement(params: {
  periodFrom: string;
  periodTo: string;
  amountReceived: number;
  remarks: string;
}): Promise<Settlement> {
  const db = await openDB();
  const tx = db.transaction(['patient_entries', 'settlements'], 'readwrite');
  const patientStore = tx.objectStore('patient_entries');
  const settlementStore = tx.objectStore('settlements');

  const todayStr = new Date().toISOString().split('T')[0];
  const dateCompact = todayStr.replace(/-/g, '');

  // Count existing settlements for today to build batch ID ST-YYYYMMDD-01
  const allSettlementsReq = settlementStore.getAll();

  return new Promise((resolve, reject) => {
    allSettlementsReq.onsuccess = () => {
      const existingSettlements = (allSettlementsReq.result || []) as Settlement[];
      existingSettlements.sort((a, b) => b.settlementDate.localeCompare(a.settlementDate) || b.createdAt - a.createdAt);
      
      const latest = existingSettlements.length > 0 ? existingSettlements[0] : null;
      const previousDue = latest ? latest.dueBalance : 0;

      const todaySettlements = existingSettlements.filter((s) => s.settlementDate === todayStr);
      const seq = String(todaySettlements.length + 1).padStart(2, '0');
      const settlementId = `ST-${dateCompact}-${seq}`;

      // Retrieve all patient entries to mark eligible ones
      const entriesReq = patientStore.getAll();
      entriesReq.onsuccess = () => {
        const allEntries = (entriesReq.result || []) as PatientEntry[];
        const eligible = allEntries.filter(
          (e) => e.settlementStatus === 'Pending' && e.date >= params.periodFrom && e.date <= params.periodTo
        );

        const periodShare = eligible.reduce((acc, curr) => acc + curr.doctorShare, 0);
        const totalPayable = periodShare + previousDue;
        const dueBalance = totalPayable - params.amountReceived;
        const patientIds = eligible.map((e) => e.id);

        // Update each eligible patient entry
        for (const entry of eligible) {
          entry.settlementStatus = 'Settled';
          entry.settlementId = settlementId;
          entry.updatedAt = Date.now();
          patientStore.put(entry);
        }

        const newSettlement: Settlement = {
          settlementId,
          settlementDate: todayStr,
          periodFrom: params.periodFrom,
          periodTo: params.periodTo,
          patientCount: eligible.length,
          periodShare,
          previousDue,
          totalPayable,
          amountReceived: params.amountReceived,
          dueBalance,
          remarks: params.remarks,
          patientIds,
          createdAt: Date.now(),
        };

        settlementStore.put(newSettlement);

        logAudit({
          action: 'SETTLEMENT_CREATED',
          targetId: settlementId,
          targetType: 'settlement',
          details: `Reconciled batch ${settlementId} (${params.periodFrom} to ${params.periodTo}): ${eligible.length} visits. Claimable: ৳${totalPayable}, Paid: ৳${params.amountReceived}, Due: ৳${dueBalance}`,
          newData: newSettlement,
        });

        tx.oncomplete = () => resolve(newSettlement);
        tx.onerror = () => reject(tx.error);
      };
      entriesReq.onerror = () => reject(entriesReq.error);
    };
    allSettlementsReq.onerror = () => reject(allSettlementsReq.error);
  });
}

// ---------------- Settings ---------------- //

export async function getSettings(): Promise<ClinicSettings> {
  const { store } = await getStore('settings', 'readonly');
  const { settings, migratedRecord } = await new Promise<{
    settings: ClinicSettings;
    migratedRecord: ClinicSettings | null;
  }>((resolve) => {
    const req = store.get('app_settings');
    req.onsuccess = () => {
      if (req.result && req.result.value) {
        const stored = req.result.value;
        const clinicName =
          !stored.clinicName || stored.clinicName === 'Apex Dental & Maxillofacial Care'
            ? DEFAULT_CLINIC_NAME
            : stored.clinicName;
        const clinicLogo = stored.clinicLogo || DEFAULT_CLINIC_LOGO;

        // ── No pre-loaded account ──────────────────────────────────────
        // A doctor identity may only come from the user's own Gmail sign-in
        // (ownerUid set) or from being typed manually in Settings. Records from
        // older builds may hold one of the old hard-coded placeholder names.
        // That name was seeded silently, so it cannot be told apart from a
        // typed one, and those records are checked once. Records written by
        // this build are trusted, so a name the doctor types is always kept.
        const needsMigration = stored.legacyIdentityChecked !== true;
        const rawDoctorName = typeof stored.doctorName === 'string' ? stored.doctorName.trim() : '';
        const isPresetDoctorName =
          needsMigration && rawDoctorName !== '' && PRESET_DOCTOR_NAMES.includes(rawDoctorName);
        const doctorName = isPresetDoctorName ? '' : rawDoctorName;
        const doctorEmail = isPresetDoctorName ? '' : stored.doctorEmail || '';
        const doctorPhoto = isPresetDoctorName ? '' : stored.doctorPhoto || '';
        const ownerUid = isPresetDoctorName ? null : stored.ownerUid || null;

        const procedures =
          stored.procedures && Array.isArray(stored.procedures) && stored.procedures.length > 0
            ? stored.procedures
            : DEFAULT_PROCEDURES;
        const amountPresets =
          stored.amountPresets && Array.isArray(stored.amountPresets) && stored.amountPresets.length > 0
            ? stored.amountPresets
            : DEFAULT_AMOUNT_PRESETS;
        resolve({
          settings: {
            ...DEFAULT_SETTINGS,
            ...stored,
            clinicName,
            clinicLogo,
            doctorName,
            doctorEmail,
            doctorPhoto,
            ownerUid,
            procedures,
            amountPresets,
            legacyIdentityChecked: true,
          },
          // Only the identity fields and the flag change in storage. Everything
          // else stays as saved, so today's defaults are not frozen into the record.
          migratedRecord: needsMigration
            ? {
                ...stored,
                doctorName,
                doctorEmail,
                doctorPhoto,
                ownerUid,
                legacyIdentityChecked: true,
              }
            : null,
        });
      } else {
        resolve({ settings: DEFAULT_SETTINGS, migratedRecord: null });
      }
    };
    req.onerror = () => resolve({ settings: DEFAULT_SETTINGS, migratedRecord: null });
  });

  if (migratedRecord) {
    // Store the checked record so the placeholder rule never runs against it again.
    await writeSettingsRecord(migratedRecord).catch((error) =>
      console.warn('Could not save the settings check:', error)
    );
  }
  return settings;
}

async function writeSettingsRecord(settings: ClinicSettings): Promise<void> {
  const { store, tx } = await getStore('settings', 'readwrite');
  return new Promise((resolve, reject) => {
    store.put({ key: 'app_settings', value: settings });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveSettings(settings: Partial<ClinicSettings>): Promise<ClinicSettings> {
  const current = await getSettings();
  // Anything saved by this build has already passed the placeholder check.
  const updated = { ...current, ...settings, legacyIdentityChecked: true };
  const { store, tx } = await getStore('settings', 'readwrite');
  return new Promise((resolve, reject) => {
    store.put({ key: 'app_settings', value: updated });
    tx.oncomplete = () => resolve(updated);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- Legacy Demo Cleanup ---------------- //

/**
 * Remove only untouched samples installed by older app versions. Fresh
 * databases stay empty, and settings (including all presets) are untouched.
 * Run before the initial load and after restoring an older backup.
 */
export async function removeLegacyDemoData(): Promise<boolean> {
  const db = await openDB();
  const profilesToRebuild = new Set<string>();
  let removed = false;

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        ['patient_entries', 'settlements', 'patient_profiles', 'audit_logs'],
        'readwrite'
      );
      const entryStore = tx.objectStore('patient_entries');
      const settlementStore = tx.objectStore('settlements');
      const profileStore = tx.objectStore('patient_profiles');
      const entriesReq = entryStore.getAll();
      const settlementsReq = settlementStore.getAll();
      const profilesReq = profileStore.getAll();
      const auditReq = tx.objectStore('audit_logs').getAll();
      let pendingReads = 4;

      const cleanSamples = () => {
        if (--pendingReads !== 0) return;

        const entries = entriesReq.result as PatientEntry[];
        const settlements = settlementsReq.result as Settlement[];
        const profiles = profilesReq.result as PatientProfile[];
        // Sample seeding never wrote audit logs. An audited record has been
        // created/edited/deleted by the user and must be preserved.
        const touchedIds = new Set(
          (auditReq.result as AuditLogEntry[]).map((log) => log.targetId)
        );
        const demoEntries = entries.filter(
          (entry) => isLegacyDemoEntry(entry) && !touchedIds.has(entry.id)
        );
        const demoIds = new Set(demoEntries.map((entry) => entry.id));
        const remainingEntries = entries.filter((entry) => !demoIds.has(entry.id));
        const remainingNames = new Set(
          remainingEntries.map((entry) => normalizePatientName(entry.patientName))
        );
        const removedNames = new Set(
          demoEntries.map((entry) => normalizePatientName(entry.patientName))
        );

        for (const entry of demoEntries) {
          entryStore.delete(entry.id);
          removed = true;
          if (remainingNames.has(normalizePatientName(entry.patientName))) {
            profilesToRebuild.add(entry.patientName);
          }
        }

        for (const settlement of settlements) {
          if (
            isLegacyDemoSettlement(settlement) &&
            !touchedIds.has(settlement.settlementId) &&
            !remainingEntries.some((entry) => entry.settlementId === settlement.settlementId)
          ) {
            settlementStore.delete(settlement.settlementId);
            removed = true;
          }
        }

        for (const profile of profiles) {
          const name = normalizePatientName(profile.name);
          if (!removedNames.has(name) || remainingNames.has(name)) continue;
          const demoEntry = demoEntries.find(
            (entry) => normalizePatientName(entry.patientName) === name
          );
          if (!demoEntry || !isLegacyDemoProfile(profile, demoEntry)) continue;

          if (profile.phone?.trim() || profile.notes?.trim()) {
            // Keep user-added contact details/notes, but not sample totals.
            profileStore.put({
              ...profile,
              totalVisits: 0,
              totalBilled: 0,
              totalDoctorShare: 0,
              firstVisitDate: '',
              lastVisitDate: '',
              procedures: [],
              updatedAt: Date.now(),
            });
          } else {
            profileStore.delete(profile.id);
          }
        }
      };

      entriesReq.onsuccess = cleanSamples;
      settlementsReq.onsuccess = cleanSamples;
      profilesReq.onsuccess = cleanSamples;
      auditReq.onsuccess = cleanSamples;
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }

  // If a genuine patient shares a sample name, retain their profile and
  // recalculate its totals from genuine visits only, preserving notes/phone.
  for (const name of profilesToRebuild) {
    await updateProfileForPatient(name);
  }

  return removed;
}

// ---------------- Export Data Handlers ---------------- //

export async function exportAllDataJSON(): Promise<string> {
  const entries = await getAllPatientEntries();
  const settlements = await getAllSettlements();
  const settings = await getSettings();

  const backup = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    settings,
    patientEntries: entries,
    settlements,
  };

  return JSON.stringify(backup, null, 2);
}

export async function exportAllDataCSV(): Promise<{ patientEntriesCSV: string; settlementsCSV: string }> {
  const entries = await getAllPatientEntries();
  const settlements = await getAllSettlements();

  // Sheet 1: Patient_Entries CSV
  const pHeaders = [
    'Serial',
    'Date',
    'Patient Name / ID',
    'Procedure',
    'Received Amount',
    'Doctor Share (40%)',
    'Settlement Status',
    'Settlement ID',
    'Remarks',
  ];

  const pRows = entries.map((e) => [
    e.serial,
    `"${e.date}"`,
    `"${(e.patientName || '').replace(/"/g, '""')}"`,
    `"${(e.procedure || '').replace(/"/g, '""')}"`,
    e.receivedAmount,
    e.doctorShare,
    `"${e.settlementStatus}"`,
    `"${e.settlementId || ''}"`,
    `"${(e.remarks || '').replace(/"/g, '""')}"`,
  ]);

  const patientEntriesCSV = [pHeaders.join(','), ...pRows.map((r) => r.join(','))].join('\n');

  // Sheet 2: Settlements CSV
  const sHeaders = [
    'Settlement ID',
    'Settlement Date',
    'Period From',
    'Period To',
    'Total Payable',
    'Amount Received',
    'Due / Balance',
    'Remarks',
  ];

  const sRows = settlements.map((s) => [
    `"${s.settlementId}"`,
    `"${s.settlementDate}"`,
    `"${s.periodFrom}"`,
    `"${s.periodTo}"`,
    s.totalPayable,
    s.amountReceived,
    s.dueBalance,
    `"${(s.remarks || '').replace(/"/g, '""')}"`,
  ]);

  const settlementsCSV = [sHeaders.join(','), ...sRows.map((r) => r.join(','))].join('\n');

  return { patientEntriesCSV, settlementsCSV };
}

// ---------------- Audit Logs Store ---------------- //

export async function logAudit(
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'>
): Promise<AuditLogEntry> {
  const auditItem: AuditLogEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
    ...entry,
  };
  try {
    const { store, tx } = await getStore('audit_logs', 'readwrite');
    store.put(auditItem);
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (err) {
    console.warn('Failed to record audit log:', err);
  }
  return auditItem;
}

export async function getAllAuditLogs(): Promise<AuditLogEntry[]> {
  try {
    const { store } = await getStore('audit_logs', 'readonly');
    return new Promise((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const logs = (request.result || []) as AuditLogEntry[];
        logs.sort((a, b) => b.timestamp - a.timestamp);
        resolve(logs);
      };
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function clearAuditLogs(): Promise<void> {
  const { store, tx } = await getStore('audit_logs', 'readwrite');
  return new Promise((resolve, reject) => {
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- Google Drive Restore ---------------- //

/**
 * Replace the entire local database with the contents of a Google Drive
 * backup snapshot. Cloud bookkeeping fields always stay local so a stale
 * backup can never clobber this device's backup schedule/folder.
 */
export async function restoreAllData(payload: {
  patientEntries: any[];
  settlements: any[];
  auditLogs?: any[];
  patientProfiles?: any[];
  settings?: Partial<ClinicSettings>;
}): Promise<void> {
  const current = await getSettings();
  const backupSettings = payload.settings || {};
  const mergedSettings: ClinicSettings = {
    ...current,
    ...backupSettings,
    // The placeholder check belongs to the backup's own history. An older backup
    // must still be checked after restore, so the flag is not inherited from here.
    legacyIdentityChecked: backupSettings.legacyIdentityChecked === true,
    lastDriveSnapshotTimestamp: current.lastDriveSnapshotTimestamp ?? null,
    driveFolderId: current.driveFolderId ?? null,
    ledgerSpreadsheetId: current.ledgerSpreadsheetId ?? null,
    procedures:
      backupSettings.procedures && backupSettings.procedures.length > 0
        ? backupSettings.procedures
        : current.procedures,
    amountPresets:
      backupSettings.amountPresets && backupSettings.amountPresets.length > 0
        ? backupSettings.amountPresets
        : current.amountPresets,
  };

  const db = await openDB();

  const clearAndFill = (storeName: string, rows: any[]) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      for (const row of rows) store.put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  await clearAndFill('patient_entries', payload.patientEntries || []);
  await clearAndFill('settlements', payload.settlements || []);
  await clearAndFill('patient_profiles', payload.patientProfiles || []);
  await clearAndFill('audit_logs', payload.auditLogs || []);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key: 'app_settings', value: mergedSettings });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await removeLegacyDemoData();
}
