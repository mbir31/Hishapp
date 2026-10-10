/**
 * HISAPP — LIVE CLOUD SYNC (Firebase Realtime Database, per record)
 * ─────────────────────────────────────────────────────────────────
 * Each account's records live one-per-node under
 *
 *     users/{uid}/ledger/entries/{k_hex}      (visits)
 *     users/{uid}/ledger/settlements/{k_hex}  (settlement batches)
 *     users/{uid}/ledger/profiles/{k_hex}     (patient contact details)
 *     users/{uid}/ledger/audit/{k_hex}        (audit trail + deletion tombstones)
 *
 * Why per record: a device only ever writes the records it changed, so two
 * devices editing different visits can never overwrite each other, and each
 * change is a few hundred bytes instead of the whole ledger.
 *
 * PUSH — the local outbox (IndexedDB) lists every record that still needs to
 * reach the cloud. Each push is a compare-and-set transaction using the shared
 * winner rule (cloudSync.ts), so an older device can never replace a newer
 * record. An outbox item is removed only after its push is confirmed, and only
 * if the record was not edited again in the meantime.
 *
 * PULL — child listeners receive each changed record and merge it locally with
 * the same rule. Records received from the cloud are never re-queued, so
 * devices do not echo changes back and forth.
 */
import { firebaseConfig, isFirebaseConfigured } from '../config/firebase';
import {
  ackOutboxItem,
  applyRemoteRecords,
  countOutbox,
  getSyncMeta,
  importLedgerSnapshot,
  readDeletionTime,
  readLedgerRecord,
  readOutboxBatch,
  setSyncMeta,
  type OutboxItem,
} from '../db/indexedDB';
import {
  candidateWins,
  normalizeRemoteRecord,
  recordFingerprint,
  recordVersion,
  type SyncKind,
  type SyncLedgerData,
} from './cloudSync';

export interface RealtimeSyncSession {
  /** Push every pending local change now. Safe to call often; calls coalesce. */
  flush: () => Promise<void>;
  /** Stop listening, cancel retries and release the database connection. */
  close: () => void;
}

export interface RealtimeSyncCallbacks {
  /** Remote changes were merged into the local ledger. */
  onRemoteData: () => void;
  /** A flush finished. `pending` is the number of local changes not yet confirmed by the cloud. */
  onSynced: (pending: number) => void;
  onError: (error: Error) => void;
}

const COLLECTIONS: Record<SyncKind, string> = {
  entry: 'entries',
  settlement: 'settlements',
  profile: 'profiles',
  audit: 'audit',
};

const PUSH_CONCURRENCY = 6;
const RETRY_INTERVAL_MS = 30_000;
const REMOTE_BATCH_DELAY_MS = 40;
const LEGACY_IMPORT_META = 'legacySyncImported';
const LEGACY_IMPORT_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/** RTDB keys cannot contain . # $ [ ] / — so ids are hex-encoded. */
export function encodeLedgerKey(id: string): string {
  let hex = '';
  for (const byte of new TextEncoder().encode(id)) hex += byte.toString(16).padStart(2, '0');
  return `k_${hex}`;
}

/** Converts a record into the exact value stored in the cloud (no undefined, normalized shape). */
function toCloudValue(kind: SyncKind, row: unknown): Record<string, unknown> {
  const normalized = normalizeRemoteRecord(kind, row as object);
  return JSON.parse(JSON.stringify(normalized)) as Record<string, unknown>;
}

/** Legacy single-blob snapshot (users/{uid}/syncData) → ledger data. */
function parseLegacyBlob(value: unknown): Partial<SyncLedgerData> {
  const toList = <T>(node: unknown): T[] => {
    if (Array.isArray(node)) return node.filter(Boolean) as T[];
    if (node && typeof node === 'object') return Object.values(node as Record<string, T>);
    return [];
  };
  const blob = (value ?? {}) as Record<string, unknown>;
  return {
    patientEntries: toList(blob.patientEntries),
    settlements: toList(blob.settlements),
    patientProfiles: toList(blob.patientProfiles),
    auditLogs: toList(blob.auditLogs),
  };
}

/**
 * Opens the per-record sync session for one account. `owner` must be the
 * account whose local ledger is active; it is fixed for the session's lifetime.
 */
export async function connectRealtimeSync(
  owner: string,
  callbacks: RealtimeSyncCallbacks
): Promise<RealtimeSyncSession> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured. Cloud sync is unavailable.');
  }
  if (!firebaseConfig.databaseURL) {
    throw new Error('Firebase Realtime Database URL is missing from src/config/firebase.ts.');
  }

  const [{ getApp, getApps, initializeApp }, rtdb] = await Promise.all([
    import('firebase/app'),
    import('firebase/database'),
  ]);
  const { getDatabase, get, onChildAdded, onChildChanged, ref, runTransaction } = rtdb;
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const database = getDatabase(app, firebaseConfig.databaseURL);

  const recordRef = (kind: SyncKind, id: string) =>
    ref(database, `users/${owner}/ledger/${COLLECTIONS[kind]}/${encodeLedgerKey(id)}`);

  let closed = false;
  const unsubscribers: Array<() => void> = [];
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let remoteTimer: ReturnType<typeof setTimeout> | null = null;
  const remoteQueue: Array<{ kind: SyncKind; value: unknown }> = [];
  let remoteChain: Promise<void> = Promise.resolve();
  let flushing: Promise<void> | null = null;
  let flushAgain = false;

  const reportError = (error: unknown) => {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  };

  // ── Pull ────────────────────────────────────────────────────────────

  const applyQueuedRemote = (): Promise<void> => {
    remoteChain = remoteChain
      .then(async () => {
        if (closed || remoteQueue.length === 0) return;
        const batch = remoteQueue.splice(0, remoteQueue.length);
        const changed = await applyRemoteRecords(owner, batch);
        if (changed > 0 && !closed) callbacks.onRemoteData();
      })
      .catch(reportError);
    return remoteChain;
  };

  const queueRemote = (kind: SyncKind) => (snapshot: { key: string | null; val: () => unknown }) => {
    if (closed || snapshot.val() == null) return;
    remoteQueue.push({ kind, value: snapshot.val() });
    // Initial loads deliver thousands of children; apply them in batches.
    if (remoteTimer) clearTimeout(remoteTimer);
    remoteTimer = setTimeout(() => {
      remoteTimer = null;
      void applyQueuedRemote();
    }, REMOTE_BATCH_DELAY_MS);
  };

  // ── Push ────────────────────────────────────────────────────────────

  /** Pushes one outbox item. Resolves once the cloud confirms it; the outbox item is then removed. */
  const pushItem = async (item: OutboxItem): Promise<void> => {
    const local = await readLedgerRecord(owner, item.kind, item.id);

    if (local) {
      const localValue = toCloudValue(item.kind, local);
      const result = await runTransaction(
        recordRef(item.kind, item.id),
        (current: unknown) => {
          if (current == null || typeof current !== 'object') return localValue;
          const remote = normalizeRemoteRecord(item.kind, current as object);
          // Compare-and-set: the local value replaces the cloud copy only when it
          // wins under the shared rule. An equal record is never rewritten.
          return candidateWins(item.kind, localValue, remote) ? localValue : current;
        },
        { applyLocally: false }
      );
      const committed = result.snapshot.val();
      if (
        committed &&
        typeof committed === 'object' &&
        recordFingerprint(normalizeRemoteRecord(item.kind, committed as object)) !==
          recordFingerprint(normalizeRemoteRecord(item.kind, localValue))
      ) {
        // The cloud kept a winning copy from another device; take it locally.
        await applyRemoteRecords(owner, [{ kind: item.kind, value: committed }]);
        if (!closed) callbacks.onRemoteData();
      }
    } else {
      // The record is gone locally. Delete it in the cloud only when that deletion
      // is newer than the cloud copy, so an edit made elsewhere is never lost.
      const deletedAt = await readDeletionTime(owner, item.kind, item.id);
      if (deletedAt > 0 && (item.kind === 'entry' || item.kind === 'settlement')) {
        await runTransaction(
          recordRef(item.kind, item.id),
          (current: unknown) => {
            if (current == null) return null;
            const remote = normalizeRemoteRecord(item.kind, current as object);
            return recordVersion(item.kind, remote) <= deletedAt ? null : current;
          },
          { applyLocally: false }
        );
      }
    }

    await ackOutboxItem(owner, item.key, item.token);
  };

  const drainOutbox = async (): Promise<void> => {
    while (!closed && navigator.onLine) {
      const batch = await readOutboxBatch(owner, 60);
      if (batch.length === 0) break;

      let succeeded = 0;
      for (let i = 0; i < batch.length; i += PUSH_CONCURRENCY) {
        const slice = batch.slice(i, i + PUSH_CONCURRENCY);
        const results = await Promise.allSettled(slice.map((item) => pushItem(item)));
        results.forEach((result) => {
          if (result.status === 'fulfilled') succeeded += 1;
          else reportError(result.reason);
        });
      }
      // Items that failed stay in the outbox and are retried later.
      if (succeeded === 0) break;
    }
  };

  const flush = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (flushing) {
      flushAgain = true;
      return flushing;
    }
    flushing = (async () => {
      do {
        flushAgain = false;
        try {
          await drainOutbox();
        } catch (error) {
          reportError(error);
        }
      } while (flushAgain && !closed);
      const pending = await countOutbox(owner).catch(() => 0);
      if (!closed) callbacks.onSynced(pending);
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  };

  // ── Start ───────────────────────────────────────────────────────────

  // One-time import of the legacy single-blob snapshot, if this account has one.
  // It is bounded by a timeout so an offline start never blocks live sync; if it
  // does not finish, it is retried on the next start.
  if (!(await getSyncMeta(owner, LEGACY_IMPORT_META))) {
    try {
      const legacy = await withTimeout(get(ref(database, `users/${owner}/syncData`)), LEGACY_IMPORT_TIMEOUT_MS);
      if (legacy) {
        if (legacy.exists()) await importLedgerSnapshot(owner, parseLegacyBlob(legacy.val()));
        await setSyncMeta(owner, LEGACY_IMPORT_META, true);
      }
    } catch (error) {
      console.warn('Legacy cloud snapshot import postponed:', error);
    }
  }

  for (const kind of Object.keys(COLLECTIONS) as SyncKind[]) {
    const collectionRef = ref(database, `users/${owner}/ledger/${COLLECTIONS[kind]}`);
    unsubscribers.push(
      onChildAdded(collectionRef, queueRemote(kind), reportError),
      onChildChanged(collectionRef, queueRemote(kind), reportError)
    );
  }

  retryTimer = setInterval(() => void flush(), RETRY_INTERVAL_MS);
  const handleOnline = () => void flush();
  window.addEventListener('online', handleOnline);

  // Push anything queued while the app was closed, then receive remote changes.
  void flush();

  return {
    flush,
    close: () => {
      if (closed) return;
      closed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      if (retryTimer) clearInterval(retryTimer);
      if (remoteTimer) clearTimeout(remoteTimer);
      window.removeEventListener('online', handleOnline);
    },
  };
}
