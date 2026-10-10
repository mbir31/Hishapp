import { firebaseConfig, isFirebaseConfigured } from '../config/firebase';
import { getSyncLedgerData, mergeRemoteSyncData } from '../db/indexedDB';
import {
  EMPTY_SYNC_LEDGER_DATA,
  isSyncLedgerDataEmpty,
  mergeSyncLedgerData,
  syncLedgerDataEqual,
  type SyncLedgerData,
} from './cloudSync';
import type { AuditLogEntry, PatientEntry, PatientProfile, Settlement } from '../types';

interface StoredSyncLedgerData {
  schemaVersion: number;
  updatedAt: number;
  patientEntries: Record<string, PatientEntry>;
  settlements: Record<string, Settlement>;
  auditLogs: Record<string, AuditLogEntry>;
  patientProfiles: Record<string, PatientProfile>;
}

export interface RealtimeSyncSession {
  /** Merge the latest local ledger into the cloud and apply the committed result locally. */
  syncNow: () => Promise<void>;
  close: () => void;
}

export interface RealtimeSyncCallbacks {
  onRemoteData: () => void;
  onSynced: () => void;
  onError: (error: Error) => void;
}

const CLOUD_DATA_VERSION = 1;

/**
 * Opens a user-scoped Firebase Realtime Database listener and merges records
 * by stable ID. RTDB transactions serialize concurrent device writes, while
 * each record's update time prevents an older device edit from winning.
 */
export async function connectRealtimeSync(
  userUid: string,
  callbacks: RealtimeSyncCallbacks
): Promise<RealtimeSyncSession> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured. Cloud sync is unavailable.');
  }
  if (!firebaseConfig.databaseURL) {
    throw new Error('Firebase Realtime Database URL is missing from src/config/firebase.ts.');
  }

  const [{ getApp, getApps, initializeApp }, { getDatabase, onValue, ref, runTransaction }] =
    await Promise.all([import('firebase/app'), import('firebase/database')]);
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const database = getDatabase(app, firebaseConfig.databaseURL);
  const syncReference = ref(database, `users/${userUid}/syncData`);

  let closed = false;
  let initialSnapshotSettled = false;
  let processQueue: Promise<void> = Promise.resolve();
  let stopListening = () => {};
  let resolveInitialSnapshot: (() => void) | undefined;
  let rejectInitialSnapshot: ((error: Error) => void) | undefined;
  const initialSnapshot = new Promise<void>((resolve, reject) => {
    resolveInitialSnapshot = resolve;
    rejectInitialSnapshot = reject;
  });

  const setSynced = () => {
    callbacks.onSynced();
  };

  const reportError = (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    callbacks.onError(error);
    if (!initialSnapshotSettled) {
      initialSnapshotSettled = true;
      rejectInitialSnapshot?.(error);
    }
  };

  const applyCommittedSnapshot = async (value: unknown) => {
    const cloudData = parseStoredData(value);
    const changed = await mergeRemoteSyncData(cloudData);
    if (changed) callbacks.onRemoteData();
  };

  const mergeLocalIntoCloud = async () => {
    if (closed) return;

    // This snapshot is merged inside an RTDB transaction. If another device
    // commits while this write is in flight, Firebase retries the updater with
    // that newer state instead of replacing it with a stale whole-database copy.
    const localData = await getSyncLedgerData();
    const transaction = await runTransaction(
      syncReference,
      (currentValue: unknown) => {
        const cloudData = parseStoredData(currentValue);
        const merged = mergeSyncLedgerData(localData, cloudData);
        if (syncLedgerDataEqual(merged, cloudData)) return currentValue;

        const previousUpdatedAt =
          currentValue && typeof currentValue === 'object'
            ? Number((currentValue as { updatedAt?: unknown }).updatedAt) || 0
            : 0;
        return serializeData(merged, Math.max(Date.now(), previousUpdatedAt + 1));
      },
      { applyLocally: false }
    );

    await applyCommittedSnapshot(transaction.snapshot.val());
    setSynced();
  };

  const processCloudSnapshot = async (value: unknown) => {
    const cloudData = parseStoredData(value);
    const changed = await mergeRemoteSyncData(cloudData);
    if (changed) callbacks.onRemoteData();

    // Local records missing from this snapshot (including offline writes) are
    // added with a transaction. Deletion tombstones are part of the same merge.
    const localData = await getSyncLedgerData();
    const merged = mergeSyncLedgerData(localData, cloudData);
    if (!syncLedgerDataEqual(merged, cloudData) && navigator.onLine) {
      await mergeLocalIntoCloud();
    }
    setSynced();
  };

  stopListening = onValue(
    syncReference,
    (snapshot) => {
      processQueue = processQueue
        .then(() => processCloudSnapshot(snapshot.val()))
        .then(() => {
          if (!initialSnapshotSettled) {
            initialSnapshotSettled = true;
            resolveInitialSnapshot?.();
          }
        })
        .catch((error: unknown) => reportError(error));
    },
    (error) => reportError(error)
  );

  try {
    // Wait for the initial server/cache snapshot so a manual sync can start
    // from the account's existing data instead of blindly pushing this device.
    await initialSnapshot;
  } catch (error) {
    stopListening();
    throw error;
  }

  return {
    syncNow: async () => {
      if (closed) return;
      await processQueue.catch(() => {});
      await mergeLocalIntoCloud();
    },
    close: () => {
      closed = true;
      stopListening();
    },
  };
}

function parseStoredData(value: unknown): SyncLedgerData {
  if (!value || typeof value !== 'object') return EMPTY_SYNC_LEDGER_DATA;
  const data = value as Partial<StoredSyncLedgerData>;
  return {
    patientEntries: Object.values(data.patientEntries ?? {}).filter(
      (row): row is PatientEntry => !!row && typeof row.id === 'string'
    ),
    settlements: Object.values(data.settlements ?? {}).filter(
      (row): row is Settlement => !!row && typeof row.settlementId === 'string'
    ),
    auditLogs: Object.values(data.auditLogs ?? {}).filter(
      (row): row is AuditLogEntry => !!row && typeof row.id === 'string' && typeof row.targetId === 'string'
    ),
    patientProfiles: Object.values(data.patientProfiles ?? {}).filter(
      (row): row is PatientProfile => !!row && typeof row.id === 'string'
    ),
  };
}

function serializeData(data: SyncLedgerData, updatedAt: number): StoredSyncLedgerData | null {
  if (isSyncLedgerDataEmpty(data)) return null;

  return {
    schemaVersion: CLOUD_DATA_VERSION,
    updatedAt,
    patientEntries: rowsById(data.patientEntries, (row) => row.id),
    settlements: rowsById(data.settlements, (row) => row.settlementId),
    auditLogs: rowsById(data.auditLogs, (row) => row.id),
    patientProfiles: rowsById(data.patientProfiles, (row) => row.id),
  };
}

function rowsById<T>(rows: T[], getId: (row: T) => string): Record<string, T> {
  const object: Record<string, T> = {};
  for (const row of rows) {
    const serialized = JSON.parse(JSON.stringify(row)) as T;
    object[encodeFirebaseKey(getId(row))] = serialized;
  }
  return object;
}

/** Use hex UTF-8 keys so user-entered IDs can never contain an RTDB-forbidden path character. */
function encodeFirebaseKey(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let encoded = '';
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, '0');
  return `k_${encoded || '0'}`;
}
