import { AmountPreset, AuditLogEntry, ClinicSettings, PatientEntry, PatientProfile, Settlement } from '../types';

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

export const DEFAULT_SETTINGS: ClinicSettings = {
  clinicName: 'Yashfin Dental Care',
  clinicLogo: '/dlogo.png',
  doctorName: 'Dr. MBR (BDS, PGT-OMS)',
  currencySymbol: '৳',
  sharePercentage: 40,
  procedures: DEFAULT_PROCEDURES,
  amountPresets: DEFAULT_AMOUNT_PRESETS,
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
  return new Promise((resolve) => {
    const req = store.get('app_settings');
    req.onsuccess = () => {
      if (req.result && req.result.value) {
        const stored = req.result.value;
        const clinicName =
          !stored.clinicName || stored.clinicName === 'Apex Dental & Maxillofacial Care'
            ? 'Yashfin Dental Care'
            : stored.clinicName;
        const clinicLogo = stored.clinicLogo || '/dlogo.png';
        const procedures =
          stored.procedures && Array.isArray(stored.procedures) && stored.procedures.length > 0
            ? stored.procedures
            : DEFAULT_PROCEDURES;
        const amountPresets =
          stored.amountPresets && Array.isArray(stored.amountPresets) && stored.amountPresets.length > 0
            ? stored.amountPresets
            : DEFAULT_AMOUNT_PRESETS;
        resolve({
          ...DEFAULT_SETTINGS,
          ...stored,
          clinicName,
          clinicLogo,
          procedures,
          amountPresets,
        });
      } else {
        resolve(DEFAULT_SETTINGS);
      }
    };
    req.onerror = () => resolve(DEFAULT_SETTINGS);
  });
}

export async function saveSettings(settings: Partial<ClinicSettings>): Promise<ClinicSettings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  const { store, tx } = await getStore('settings', 'readwrite');
  return new Promise((resolve, reject) => {
    store.put({ key: 'app_settings', value: updated });
    tx.oncomplete = () => resolve(updated);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- Initial Seeding ---------------- //

export async function seedDemoDataIfEmpty(): Promise<boolean> {
  const entries = await getAllPatientEntries();
  if (entries.length > 0) return false;

  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const d0 = fmt(today);
  const d1 = fmt(new Date(today.getTime() - 86400000 * 1));
  const d2 = fmt(new Date(today.getTime() - 86400000 * 2));
  const d3 = fmt(new Date(today.getTime() - 86400000 * 4));
  const d5 = fmt(new Date(today.getTime() - 86400000 * 7));

  // Seed sample procedures representative of a dental clinic
  const sampleEntries: PatientEntry[] = [
    {
      id: 'entry-1',
      serial: 1,
      date: d5,
      patientName: 'Mrs. Selina Akhter',
      procedure: 'Root Canal Treatment (RCT)',
      receivedAmount: 6000,
      doctorShare: 2400,
      settlementStatus: 'Settled',
      settlementId: 'ST-20261001-01',
      remarks: 'Upper right 1st molar, 1st session',
      createdAt: Date.now() - 86400000 * 7,
      updatedAt: Date.now() - 86400000 * 7,
    },
    {
      id: 'entry-2',
      serial: 2,
      date: d5,
      patientName: 'Tanvir Hossain',
      procedure: 'Deep Scaling & Polishing',
      receivedAmount: 2500,
      doctorShare: 1000,
      settlementStatus: 'Settled',
      settlementId: 'ST-20261001-01',
      remarks: 'Subgingival calculus removal',
      createdAt: Date.now() - 86400000 * 7 + 1000,
      updatedAt: Date.now() - 86400000 * 7 + 1000,
    },
    {
      id: 'entry-3',
      serial: 3,
      date: d3,
      patientName: 'Farhana Chowdhury',
      procedure: 'Zirconia Crown Fixation',
      receivedAmount: 8500,
      doctorShare: 3400,
      settlementStatus: 'Pending',
      settlementId: null,
      remarks: 'Shade A2, fit checked',
      createdAt: Date.now() - 86400000 * 4,
      updatedAt: Date.now() - 86400000 * 4,
    },
    {
      id: 'entry-4',
      serial: 4,
      date: d2,
      patientName: 'Kazi M. Rahman',
      procedure: 'Surgical Extraction (Impacted)',
      receivedAmount: 5000,
      doctorShare: 2000,
      settlementStatus: 'Pending',
      settlementId: null,
      remarks: 'Lower left 3rd molar #38',
      createdAt: Date.now() - 86400000 * 2,
      updatedAt: Date.now() - 86400000 * 2,
    },
    {
      id: 'entry-5',
      serial: 5,
      date: d1,
      patientName: 'Nusrat Jahan',
      procedure: 'Composite Light Cure Filling',
      receivedAmount: 3000,
      doctorShare: 1200,
      settlementStatus: 'Pending',
      settlementId: null,
      remarks: 'Class II restoration',
      createdAt: Date.now() - 86400000 * 1,
      updatedAt: Date.now() - 86400000 * 1,
    },
    {
      id: 'entry-6',
      serial: 6,
      date: d0,
      patientName: 'Zubair Ahmed',
      procedure: 'Root Canal Treatment (RCT)',
      receivedAmount: 7000,
      doctorShare: 2800,
      settlementStatus: 'Pending',
      settlementId: null,
      remarks: 'Premolar obturation done',
      createdAt: Date.now() - 3600000 * 4,
      updatedAt: Date.now() - 3600000 * 4,
    },
    {
      id: 'entry-7',
      serial: 7,
      date: d0,
      patientName: 'Amina Begum',
      procedure: 'Scaling & Fluoride Therapy',
      receivedAmount: 2000,
      doctorShare: 800,
      settlementStatus: 'Pending',
      settlementId: null,
      remarks: 'Sensitivity management',
      createdAt: Date.now() - 3600000 * 1,
      updatedAt: Date.now() - 3600000 * 1,
    },
  ];

  // Also seed one prior settlement that left a carry-over balance of ৳500
  const sampleSettlement: Settlement = {
    settlementId: 'ST-20261001-01',
    settlementDate: d5,
    periodFrom: fmt(new Date(today.getTime() - 86400000 * 14)),
    periodTo: d5,
    patientCount: 2,
    periodShare: 3400,
    previousDue: 0,
    totalPayable: 3400,
    amountReceived: 2900,
    dueBalance: 500, // ৳500 carried forward
    remarks: 'Cheque issued for ৳2,900. Remaining ৳500 due carried over to next week.',
    patientIds: ['entry-1', 'entry-2'],
    createdAt: Date.now() - 86400000 * 7,
  };

  const { store: pStore, tx: pTx } = await getStore('patient_entries', 'readwrite');
  for (const item of sampleEntries) {
    pStore.put(item);
  }
  await new Promise((r) => {
    pTx.oncomplete = r;
  });

  const { store: sStore, tx: sTx } = await getStore('settlements', 'readwrite');
  sStore.put(sampleSettlement);
  await new Promise((r) => {
    sTx.oncomplete = r;
  });

  // Generate profiles for seeded demo data
  try {
    await syncAllPatientProfiles();
  } catch (e) {
    console.warn('Seeding profiles warning:', e);
  }

  return true;
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

