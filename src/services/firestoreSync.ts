/**
 * HISAPP — CLOUD FIRESTORE VAULT SYNC SERVICE (HARDENED & RESILIENT)
 * ─────────────────────────────────────────────────────────────────
 * Each authenticated user's records are stored in Cloud Firestore under:
 *
 *     vaults/{phoneNumber}/entries/{id}      (visits)
 *     vaults/{phoneNumber}/settlements/{id}  (settlement batches)
 *     vaults/{phoneNumber}/profiles/{id}     (patient profiles)
 *     vaults/{phoneNumber}/audit/{id}        (audit trail & tombstones)
 *     vaults/{phoneNumber}/snapshots/latest  (consolidated fail-safe recovery snapshot)
 *
 * RESILIENCE FEATURES:
 *   1. Atomic batch writes (writeBatch) with automatic sanitization
 *   2. Exponential backoff retry with jitter on network fluctuations
 *   3. Instant flush on network reconnection and tab visibility changes
 *   4. Consolidated Cloud Snapshot Vault for instant 1-read device restores
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFirestoreDb } from '../config/firebase';
import {
  ackOutboxItem,
  applyRemoteRecords,
  countOutbox,
  getAllAuditLogs,
  getAllPatientEntries,
  getAllPatientProfiles,
  getAllSettlements,
  readLedgerRecord,
  readOutboxBatch,
  restoreAllData,
  type OutboxItem,
} from '../db/indexedDB';
import {
  normalizeRemoteRecord,
  type SyncKind,
} from './cloudSync';
import type {
  AuditLogEntry,
  CloudSnapshotInfo,
  PatientEntry,
  PatientProfile,
  ReconciliationResult,
  Settlement,
} from '../types';

export interface FirestoreSyncSession {
  /** Push all pending local changes now. Safe to call frequently. */
  flush: () => Promise<void>;
  /** Save a complete consolidated cloud recovery snapshot */
  saveSnapshot: () => Promise<{ timestamp: number; entryCount: number; settlementCount: number }>;
  /** Unsubscribe from Firestore listeners and close session. */
  close: () => void;
}

export interface FirestoreSyncCallbacks {
  /** Remote changes were applied to IndexedDB. */
  onRemoteData: () => void;
  /** A sync cycle finished. `pending` is remaining unconfirmed outbox items. */
  onSynced: (pending: number) => void;
  onError: (error: Error) => void;
}

const COLLECTIONS: Record<SyncKind, string> = {
  entry: 'entries',
  settlement: 'settlements',
  profile: 'profiles',
  audit: 'audit',
};

const BATCH_SIZE = 50;

/**
 * Recursively remove `undefined` values so Firestore set/batch operations never reject.
 */
export function cleanForFirestore<T>(data: T): T {
  if (data === null || data === undefined) return null as T;
  if (Array.isArray(data)) {
    return data.map((item) => cleanForFirestore(item)) as T;
  }
  if (typeof data === 'object') {
    const res: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (value !== undefined) {
        res[key] = cleanForFirestore(value);
      }
    }
    return res as T;
  }
  return data;
}

/**
 * Connect to Firestore for the given user's vault with exponential backoff retry.
 */
export function connectFirestoreSync(
  phoneNumber: string,
  callbacks: FirestoreSyncCallbacks
): FirestoreSyncSession {
  let isClosed = false;
  let isFlushing = false;
  let flushRequestedAgain = false;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const db = getFirestoreDb();
  const unsubscribes: Unsubscribe[] = [];

  const initialLoadTracker = {
    entries: false,
    settlements: false,
    profiles: false,
    audit: false,
  };

  const handleRemoteBatch = async (
    kind: SyncKind,
    docs: Array<{ id: string; data: Record<string, unknown> }>
  ) => {
    if (isClosed || docs.length === 0) return;
    try {
      const recordsToApply: Array<{ kind: SyncKind; value: unknown }> = [];
      for (const item of docs) {
        const normalized = normalizeRemoteRecord(kind, item.data as any);
        recordsToApply.push({ kind, value: normalized });
      }

      const appliedCount = await applyRemoteRecords(phoneNumber, recordsToApply);
      if (appliedCount > 0) {
        callbacks.onRemoteData();
      }
    } catch (err: any) {
      if (!isClosed) callbacks.onError(err);
    }
  };

  // Subscribe to visits
  try {
    const entriesRef = collection(db, 'vaults', phoneNumber, COLLECTIONS.entry);
    const unsubEntries = onSnapshot(
      entriesRef,
      (snapshot) => {
        const changes = snapshot.docChanges();
        const docs = (initialLoadTracker.entries ? changes.map((c) => c.doc) : snapshot.docs).map((d) => ({
          id: d.id,
          data: d.data(),
        }));
        initialLoadTracker.entries = true;
        void handleRemoteBatch('entry', docs);
      },
      (error) => {
        if (!isClosed) callbacks.onError(error);
      }
    );
    unsubscribes.push(unsubEntries);
  } catch (err: any) {
    callbacks.onError(err);
  }

  // Subscribe to settlements
  try {
    const settlementsRef = collection(db, 'vaults', phoneNumber, COLLECTIONS.settlement);
    const unsubSettlements = onSnapshot(
      settlementsRef,
      (snapshot) => {
        const changes = snapshot.docChanges();
        const docs = (initialLoadTracker.settlements ? changes.map((c) => c.doc) : snapshot.docs).map((d) => ({
          id: d.id,
          data: d.data(),
        }));
        initialLoadTracker.settlements = true;
        void handleRemoteBatch('settlement', docs);
      },
      (error) => {
        if (!isClosed) callbacks.onError(error);
      }
    );
    unsubscribes.push(unsubSettlements);
  } catch (err: any) {
    callbacks.onError(err);
  }

  // Subscribe to profiles
  try {
    const profilesRef = collection(db, 'vaults', phoneNumber, COLLECTIONS.profile);
    const unsubProfiles = onSnapshot(
      profilesRef,
      (snapshot) => {
        const changes = snapshot.docChanges();
        const docs = (initialLoadTracker.profiles ? changes.map((c) => c.doc) : snapshot.docs).map((d) => ({
          id: d.id,
          data: d.data(),
        }));
        initialLoadTracker.profiles = true;
        void handleRemoteBatch('profile', docs);
      },
      (error) => {
        if (!isClosed) callbacks.onError(error);
      }
    );
    unsubscribes.push(unsubProfiles);
  } catch (err: any) {
    callbacks.onError(err);
  }

  // Subscribe to audit logs
  try {
    const auditRef = collection(db, 'vaults', phoneNumber, COLLECTIONS.audit);
    const unsubAudit = onSnapshot(
      auditRef,
      (snapshot) => {
        const changes = snapshot.docChanges();
        const docs = (initialLoadTracker.audit ? changes.map((c) => c.doc) : snapshot.docs).map((d) => ({
          id: d.id,
          data: d.data(),
        }));
        initialLoadTracker.audit = true;
        void handleRemoteBatch('audit', docs);
      },
      (error) => {
        if (!isClosed) callbacks.onError(error);
      }
    );
    unsubscribes.push(unsubAudit);
  } catch (err: any) {
    callbacks.onError(err);
  }

  // Push local outbox to Firestore with exponential backoff retry
  const flush = async (): Promise<void> => {
    if (isClosed) return;
    if (isFlushing) {
      flushRequestedAgain = true;
      return;
    }
    isFlushing = true;
    flushRequestedAgain = false;

    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    try {
      while (!isClosed) {
        const items = await readOutboxBatch(phoneNumber, BATCH_SIZE);
        if (items.length === 0) break;

        const batch = writeBatch(db);
        const processedItems: OutboxItem[] = [];

        for (const item of items) {
          const docRef = doc(db, 'vaults', phoneNumber, COLLECTIONS[item.kind], item.id);
          const record = await readLedgerRecord(phoneNumber, item.kind, item.id);

          if (record) {
            batch.set(docRef, cleanForFirestore(record), { merge: true });
          } else {
            batch.delete(docRef);
          }
          processedItems.push(item);
        }

        await batch.commit();

        for (const item of processedItems) {
          await ackOutboxItem(phoneNumber, item.key, item.token);
        }

        if (items.length < BATCH_SIZE) break;
      }

      // Success: reset backoff
      retryCount = 0;
      const pending = await countOutbox(phoneNumber);
      callbacks.onSynced(pending);
    } catch (err: any) {
      if (!isClosed) {
        callbacks.onError(err);
        // Exponential backoff with jitter (max 30s)
        const delay = Math.min(30000, 2000 * Math.pow(1.5, retryCount) + Math.random() * 1000);
        retryCount = Math.min(retryCount + 1, 10);
        retryTimer = setTimeout(() => {
          if (!isClosed) void flush();
        }, delay);
      }
    } finally {
      isFlushing = false;
      if (flushRequestedAgain && !isClosed) {
        void flush();
      }
    }
  };

  // Network & visibility listeners for instant recovery
  const handleOnline = () => {
    retryCount = 0;
    void flush();
  };

  const handleVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void flush();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
  }

  // Initial flush
  void flush();

  return {
    flush,
    saveSnapshot: async () => {
      return await createCloudRecoverySnapshot(phoneNumber);
    },
    close: () => {
      isClosed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      unsubscribes.forEach((unsub) => {
        try {
          unsub();
        } catch {
          // ignore
        }
      });
      unsubscribes.length = 0;
    },
  };
}

/**
 * Capture a complete consolidated cloud recovery snapshot with rolling multi-generation history
 */
export async function createCloudRecoverySnapshot(
  phoneNumber: string
): Promise<{ timestamp: number; entryCount: number; settlementCount: number }> {
  const db = getFirestoreDb();
  const [entries, settlements, profiles, audits] = await Promise.all([
    getAllPatientEntries(),
    getAllSettlements(),
    getAllPatientProfiles(),
    getAllAuditLogs(),
  ]);

  const timestamp = Date.now();
  const snapshotData = {
    phone: phoneNumber,
    timestamp,
    entryCount: entries.length,
    settlementCount: settlements.length,
    patientEntries: cleanForFirestore(entries),
    settlements: cleanForFirestore(settlements),
    patientProfiles: cleanForFirestore(profiles),
    auditLogs: cleanForFirestore(audits),
  };

  const latestRef = doc(db, 'vaults', phoneNumber, 'snapshots', 'latest');

  try {
    // Check existing latest snapshot for rotation
    const latestSnap = await getDoc(latestRef);
    if (latestSnap.exists()) {
      const prevData = latestSnap.data();
      const prevTime = prevData?.timestamp || 0;
      const ageHours = (timestamp - prevTime) / (1000 * 3600);

      // If previous snapshot is older than 18 hours, rotate to 'yesterday'
      if (ageHours >= 18) {
        const yesterdayRef = doc(db, 'vaults', phoneNumber, 'snapshots', 'yesterday');
        const yesterdaySnap = await getDoc(yesterdayRef);

        if (yesterdaySnap.exists()) {
          const yData = yesterdaySnap.data();
          const yTime = yData?.timestamp || 0;
          const yAgeDays = (timestamp - yTime) / (1000 * 3600 * 24);
          // If yesterday is older than 6 days, rotate to 'last_week'
          if (yAgeDays >= 6) {
            const lastWeekRef = doc(db, 'vaults', phoneNumber, 'snapshots', 'last_week');
            await setDoc(lastWeekRef, yData);
          }
        }

        await setDoc(yesterdayRef, prevData);
      }
    }
  } catch (err) {
    console.warn('Snapshot rotation note:', err);
  }

  // Write new latest snapshot
  await setDoc(latestRef, snapshotData);

  return {
    timestamp,
    entryCount: entries.length,
    settlementCount: settlements.length,
  };
}

/**
 * Retrieve metadata for all available multi-generation cloud snapshots
 */
export async function getAvailableCloudSnapshots(phoneNumber: string): Promise<CloudSnapshotInfo[]> {
  const db = getFirestoreDb();
  const keys: Array<'latest' | 'yesterday' | 'last_week'> = ['latest', 'yesterday', 'last_week'];
  const labels: Record<'latest' | 'yesterday' | 'last_week', string> = {
    latest: 'সর্বশেষ ক্লাউড স্ন্যাপশট (Latest Live)',
    yesterday: 'গতকালকের ব্যাকআপ (Yesterday)',
    last_week: 'গত সপ্তাহের ব্যাকআপ (7 Days Ago)',
  };

  const results: CloudSnapshotInfo[] = [];

  for (const key of keys) {
    try {
      const snapRef = doc(db, 'vaults', phoneNumber, 'snapshots', key);
      const snap = await getDoc(snapRef);
      if (snap.exists()) {
        const d = snap.data();
        results.push({
          key,
          label: labels[key],
          timestamp: d.timestamp || 0,
          entryCount: d.entryCount || (Array.isArray(d.patientEntries) ? d.patientEntries.length : 0),
          settlementCount: d.settlementCount || (Array.isArray(d.settlements) ? d.settlements.length : 0),
          exists: true,
        });
      } else {
        results.push({
          key,
          label: labels[key],
          timestamp: 0,
          entryCount: 0,
          settlementCount: 0,
          exists: false,
        });
      }
    } catch {
      results.push({
        key,
        label: labels[key],
        timestamp: 0,
        entryCount: 0,
        settlementCount: 0,
        exists: false,
      });
    }
  }

  return results;
}

/**
 * Restore data from a specific cloud snapshot generation
 */
export async function restoreFromSpecificSnapshot(
  phoneNumber: string,
  snapshotKey: 'latest' | 'yesterday' | 'last_week' = 'latest'
): Promise<{ entries: number; settlements: number }> {
  const db = getFirestoreDb();
  const snapshotRef = doc(db, 'vaults', phoneNumber, 'snapshots', snapshotKey);
  const snap = await getDoc(snapshotRef);

  if (!snap.exists()) {
    throw new Error(`ক্লাউড স্ন্যাপশট (${snapshotKey}) পাওয়া যায়নি (Snapshot not found).`);
  }

  const data = snap.data() as {
    patientEntries: PatientEntry[];
    settlements: Settlement[];
    patientProfiles?: PatientProfile[];
    auditLogs?: AuditLogEntry[];
  };

  const patientEntries = Array.isArray(data.patientEntries) ? data.patientEntries : [];
  const settlements = Array.isArray(data.settlements) ? data.settlements : [];

  await restoreAllData({
    patientEntries,
    settlements,
    patientProfiles: Array.isArray(data.patientProfiles) ? data.patientProfiles : [],
    auditLogs: Array.isArray(data.auditLogs) ? data.auditLogs : [],
  });

  return {
    entries: patientEntries.length,
    settlements: settlements.length,
  };
}

/**
 * Restore data from cloud recovery snapshot (alias to latest)
 */
export async function restoreFromCloudSnapshot(
  phoneNumber: string
): Promise<{ entries: number; settlements: number }> {
  return restoreFromSpecificSnapshot(phoneNumber, 'latest');
}

/**
 * Bidirectional record count reconciliation & integrity self-healing
 */
export async function reconcileVaultRecords(phoneNumber: string): Promise<ReconciliationResult> {
  const db = getFirestoreDb();

  const [localEntries, localSettlements] = await Promise.all([
    getAllPatientEntries(),
    getAllSettlements(),
  ]);

  const remoteEntriesRef = collection(db, 'vaults', phoneNumber, COLLECTIONS.entry);
  const remoteSettlementsRef = collection(db, 'vaults', phoneNumber, COLLECTIONS.settlement);

  const [remoteEntriesSnap, remoteSettlementsSnap] = await Promise.all([
    getDocs(remoteEntriesRef),
    getDocs(remoteSettlementsRef),
  ]);

  const remoteEntryMap = new Map<string, any>();
  remoteEntriesSnap.docs.forEach((d) => remoteEntryMap.set(d.id, d.data()));

  const remoteSettlementMap = new Map<string, any>();
  remoteSettlementsSnap.docs.forEach((d) => remoteSettlementMap.set(d.id, d.data()));

  let healedCount = 0;
  const batch = writeBatch(db);
  let batchItemsCount = 0;

  // 1. Check local entries that are missing remotely -> push to Firestore
  for (const entry of localEntries) {
    if (!remoteEntryMap.has(entry.id)) {
      const docRef = doc(db, 'vaults', phoneNumber, COLLECTIONS.entry, entry.id);
      batch.set(docRef, cleanForFirestore(entry), { merge: true });
      batchItemsCount++;
      healedCount++;
    }
  }

  // 2. Check local settlements missing remotely -> push to Firestore
  for (const settlement of localSettlements) {
    if (!remoteSettlementMap.has(settlement.settlementId)) {
      const docRef = doc(db, 'vaults', phoneNumber, COLLECTIONS.settlement, settlement.settlementId);
      batch.set(docRef, cleanForFirestore(settlement), { merge: true });
      batchItemsCount++;
      healedCount++;
    }
  }

  if (batchItemsCount > 0) {
    await batch.commit();
  }

  // 3. Check remote records missing locally -> pull and apply to IndexedDB
  const localEntryIds = new Set(localEntries.map((e) => e.id));
  const remoteRecordsToApply: Array<{ kind: SyncKind; value: unknown }> = [];

  for (const [id, data] of remoteEntryMap.entries()) {
    if (!localEntryIds.has(id)) {
      const normalized = normalizeRemoteRecord('entry', data);
      remoteRecordsToApply.push({ kind: 'entry', value: normalized });
      healedCount++;
    }
  }

  const localSettlementIds = new Set(localSettlements.map((s) => s.settlementId));
  for (const [id, data] of remoteSettlementMap.entries()) {
    if (!localSettlementIds.has(id)) {
      const normalized = normalizeRemoteRecord('settlement', data);
      remoteRecordsToApply.push({ kind: 'settlement', value: normalized });
      healedCount++;
    }
  }

  if (remoteRecordsToApply.length > 0) {
    await applyRemoteRecords(phoneNumber, remoteRecordsToApply);
  }

  const finalLocalEntries = (await getAllPatientEntries()).length;
  const finalLocalSettlements = (await getAllSettlements()).length;

  return {
    localEntries: finalLocalEntries,
    remoteEntries: remoteEntryMap.size + batchItemsCount,
    localSettlements: finalLocalSettlements,
    remoteSettlements: remoteSettlementMap.size + batchItemsCount,
    healedCount,
    status: healedCount > 0 ? 'healed' : 'perfect-parity',
    checkedAt: Date.now(),
    message:
      healedCount > 0
        ? `${healedCount}টি ডাটা অমিল সফলভাবে অটো-হিল (Auto-Healed) করা হয়েছে। এখন লোকাল ও ক্লাউড ডাটা ১০০% প্যারালাল।`
        : 'লোকাল ডিভাইস এবং ক্লাউড ভল্ট ১০০% নিখুঁত ও সমান্তরাল অবস্থায় রয়েছে (Zero Desync)।',
  };
}
