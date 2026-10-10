/**
 * HISAPP — CLOUD FIRESTORE VAULT SYNC SERVICE
 * ─────────────────────────────────────────────────────────────────
 * Each authenticated user's records are stored in Cloud Firestore under:
 *
 *     vaults/{phoneNumber}/entries/{id}      (visits)
 *     vaults/{phoneNumber}/settlements/{id}  (settlement batches)
 *     vaults/{phoneNumber}/profiles/{id}     (patient profiles)
 *     vaults/{phoneNumber}/audit/{id}        (audit trail & tombstones)
 *
 * PUSH: Reads persistent outbox items from IndexedDB and commits them to
 * Firestore using atomic writeBatch. Confirmed writes are acknowledged.
 *
 * PULL: Subscribes via onSnapshot to each subcollection, normalizes
 * incoming records, and applies them to IndexedDB using deterministic
 * conflict resolution rules (cloudSync.ts).
 */
import {
  collection,
  doc,
  onSnapshot,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFirestoreDb } from '../config/firebase';
import {
  ackOutboxItem,
  applyRemoteRecords,
  countOutbox,
  readLedgerRecord,
  readOutboxBatch,
  type OutboxItem,
} from '../db/indexedDB';
import {
  normalizeRemoteRecord,
  type SyncKind,
  type SyncLedgerData,
} from './cloudSync';
import type { AuditLogEntry, PatientEntry, PatientProfile, Settlement } from '../types';

export interface FirestoreSyncSession {
  /** Push all pending local changes now. Safe to call frequently. */
  flush: () => Promise<void>;
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
 * Connect to Firestore for the given user's vault.
 */
export function connectFirestoreSync(
  phoneNumber: string,
  callbacks: FirestoreSyncCallbacks
): FirestoreSyncSession {
  let isClosed = false;
  let isFlushing = false;
  let flushRequestedAgain = false;

  const db = getFirestoreDb();
  const unsubscribes: Unsubscribe[] = [];

  // Track if this is the initial snapshot load per collection
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
        // On initial snapshot or bulk changes
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

  // Push local outbox to Firestore
  const flush = async (): Promise<void> => {
    if (isClosed) return;
    if (isFlushing) {
      flushRequestedAgain = true;
      return;
    }
    isFlushing = true;
    flushRequestedAgain = false;

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
            // Document created or updated
            batch.set(docRef, record, { merge: true });
          } else {
            // Document was deleted locally
            batch.delete(docRef);
          }
          processedItems.push(item);
        }

        await batch.commit();

        // Acknowledge each written item so it is removed from the outbox
        for (const item of processedItems) {
          await ackOutboxItem(phoneNumber, item.key, item.token);
        }

        if (items.length < BATCH_SIZE) break;
      }

      const pending = await countOutbox(phoneNumber);
      callbacks.onSynced(pending);
    } catch (err: any) {
      if (!isClosed) callbacks.onError(err);
    } finally {
      isFlushing = false;
      if (flushRequestedAgain && !isClosed) {
        void flush();
      }
    }
  };

  // Run initial flush to sync any queued writes
  void flush();

  return {
    flush,
    close: () => {
      isClosed = true;
      unsubscribes.forEach((unsub) => {
        try {
          unsub();
        } catch {
          // ignore unsubscribe error
        }
      });
      unsubscribes.length = 0;
    },
  };
}
