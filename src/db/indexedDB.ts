/**
 * HISAPP — LOCAL DATABASE (IndexedDB)
 * ─────────────────────────────────────────────────────────────────
 * Two kinds of IndexedDB databases live on each device:
 *
 *   • DentalIncomeTrackerDB — device settings plus the "guest" ledger that
 *     exists before any Google account has ever been linked to the device.
 *   • HisappLedger_<uid>    — one ledger per signed-in Google account. Records
 *     of one account can never be shown to, merged into, or uploaded for
 *     another account, and a sign-out keeps them safe on the device.
 *
 * Every ledger write runs in ONE transaction together with a row in the
 * persistent sync outbox (`sync_outbox`). The write and its "still needs to
 * reach the cloud" marker therefore commit or fail together: a record can
 * never be saved locally without being queued for sync, even if the tab
 * closes or the device goes offline a millisecond later.
 */
import { AmountPreset, AuditLogEntry, ClinicSettings, PatientEntry, PatientProfile, Settlement } from '../types';
import {
  FOLLOW_UP_AMOUNT_PRESET,
  FOLLOW_UP_PROCEDURE,
  withFollowUpAmountPreset,
  withFollowUpProcedure,
} from '../utils/followUp';
import { isLegacyDemoEntry, isLegacyDemoProfile, isLegacyDemoSettlement } from './legacyDemoData';
import {
  isSyncLedgerDataEmpty,
  mergeSyncLedgerData,
  normalizeRemoteRecord,
  recordFingerprint,
  type SyncKind,
  type SyncLedgerData,
} from '../services/cloudSync';
import { todayDateKey } from '../utils/dateUtils';

/** Device settings database. Its name predates per-account ledgers and is kept for continuity. */
export const DEVICE_DB_NAME = 'DentalIncomeTrackerDB';
const ACCOUNT_DB_PREFIX = 'HisappLedger_';
const DB_VERSION = 4;
/** 2 = per-account ledgers + persistent outbox (see migration in loadLedgerOwner). */
export const LEDGER_LAYOUT_VERSION = 2;
const LAYOUT_RECORD_KEY = 'ledger_layout';

const OUTBOX_STORE = 'sync_outbox';
const SYNC_META_STORE = 'sync_meta';
const LEDGER_STORES = ['patient_entries', 'settlements', 'patient_profiles', 'audit_logs'] as const;
type LedgerStore = (typeof LEDGER_STORES)[number];

const KIND_STORE: Record<SyncKind, LedgerStore> = {
  entry: 'patient_entries',
  settlement: 'settlements',
  profile: 'patient_profiles',
  audit: 'audit_logs',
};

export const DEFAULT_PROCEDURES: string[] = withFollowUpProcedure([
  'Visit',
  'RCT',
  'Filling',
  'Scaling',
  'Extraction',
  'Pulpectomy',
  'Crown',
]);

export const DEFAULT_AMOUNT_PRESETS: AmountPreset[] = withFollowUpAmountPreset([
  { id: 'no-pay', label: 'No Payment', amount: 0 },
  { id: 'free-camp', label: 'Free Campaign', amount: 0 },
  { id: 'amt-500', label: '500', amount: 500 },
  { id: 'amt-1000', label: '1000', amount: 1000 },
  { id: 'amt-2000', label: '2000', amount: 2000 },
  { id: 'amt-3000', label: '3000', amount: 3000 },
  { id: 'amt-5000', label: '5000', amount: 5000 },
]);

export { FOLLOW_UP_PROCEDURE, FOLLOW_UP_AMOUNT_PRESET };

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
  dataOwnerUid: null,
  currencySymbol: '৳',
  sharePercentage: 40,
  autoBackup: true,
  lastDriveSnapshotTimestamp: null,
  lastDriveSyncAt: null,
  driveFolderId: null,
  driveLatestFileId: null,
  ledgerSpreadsheetId: null,
  procedures: DEFAULT_PROCEDURES,
  amountPresets: DEFAULT_AMOUNT_PRESETS,
  legacyIdentityChecked: true,
  followUpPresetsChecked: true,
};

// ─────────────────────────────────────────────────────────────────
// Connections
// ─────────────────────────────────────────────────────────────────

let trackedFactory: IDBFactory | null = null;
const connections = new Map<string, Promise<IDBDatabase>>();
let ownerPromise: Promise<string | null> | null = null;

/** Drop cached connections and owner state whenever the global IndexedDB factory changes. */
function syncFactory(): void {
  if (trackedFactory === indexedDB) return;
  connections.forEach((pending) => {
    pending.then((db) => db.close()).catch(() => {});
  });
  connections.clear();
  ownerPromise = null;
  trackedFactory = indexedDB;
}

function createLedgerStores(db: IDBDatabase): void {
  const names = db.objectStoreNames;
  if (!names.contains('patient_entries')) {
    const store = db.createObjectStore('patient_entries', { keyPath: 'id' });
    store.createIndex('serial', 'serial', { unique: false });
    store.createIndex('date', 'date', { unique: false });
    store.createIndex('settlementStatus', 'settlementStatus', { unique: false });
    store.createIndex('settlementId', 'settlementId', { unique: false });
  }
  if (!names.contains('settlements')) {
    const store = db.createObjectStore('settlements', { keyPath: 'settlementId' });
    store.createIndex('settlementDate', 'settlementDate', { unique: false });
  }
  if (!names.contains('settings')) {
    db.createObjectStore('settings', { keyPath: 'key' });
  }
  if (!names.contains('audit_logs')) {
    const store = db.createObjectStore('audit_logs', { keyPath: 'id' });
    store.createIndex('timestamp', 'timestamp', { unique: false });
    store.createIndex('action', 'action', { unique: false });
    store.createIndex('targetId', 'targetId', { unique: false });
  }
  if (!names.contains('patient_profiles')) {
    const store = db.createObjectStore('patient_profiles', { keyPath: 'id' });
    store.createIndex('name', 'name', { unique: false });
    store.createIndex('totalVisits', 'totalVisits', { unique: false });
    store.createIndex('lastVisitDate', 'lastVisitDate', { unique: false });
  }
  if (!names.contains(OUTBOX_STORE)) {
    const store = db.createObjectStore(OUTBOX_STORE, { keyPath: 'key' });
    store.createIndex('queuedAt', 'queuedAt', { unique: false });
  }
  if (!names.contains(SYNC_META_STORE)) {
    db.createObjectStore(SYNC_META_STORE, { keyPath: 'key' });
  }
}

/** Opens (or reuses) one connection per database. Never leaks a new connection per call. */
function openNamedDB(name: string): Promise<IDBDatabase> {
  syncFactory();
  const cached = connections.get(name);
  if (cached) return cached;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => createLedgerStores(request.result);
    request.onblocked = () => {
      console.warn(`Database "${name}" upgrade is waiting for another open Hisapp tab to close.`);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab is upgrading or deleting the database: release our handle.
      db.onversionchange = () => {
        db.close();
        if (connections.get(name) === opening) connections.delete(name);
      };
      resolve(db);
    };
    request.onerror = () => {
      if (connections.get(name) === opening) connections.delete(name);
      reject(request.error);
    };
  });
  connections.set(name, opening);
  return opening;
}

function ledgerDbName(owner: string | null): string {
  return owner ? `${ACCOUNT_DB_PREFIX}${owner}` : DEVICE_DB_NAME;
}

function dbForOwner(owner: string | null): Promise<IDBDatabase> {
  return openNamedDB(ledgerDbName(owner));
}

/** Generic store accessor. Settings always live in the device database. */
async function getStore(storeName: string, mode: IDBTransactionMode): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
  const db = storeName === 'settings' ? await openNamedDB(DEVICE_DB_NAME) : await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  return { store, tx };
}

// ─────────────────────────────────────────────────────────────────
// Small promise helpers for IndexedDB requests and transactions
// ─────────────────────────────────────────────────────────────────

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves when the transaction commits; rejects if it errors or aborts. */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Database write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Database transaction was aborted'));
  });
}

// ─────────────────────────────────────────────────────────────────
// Account ledger ownership
// ─────────────────────────────────────────────────────────────────

async function readSettingsRaw(): Promise<Record<string, any> | null> {
  const db = await openNamedDB(DEVICE_DB_NAME);
  const tx = db.transaction('settings', 'readonly');
  const record = await requestPromise(tx.objectStore('settings').get('app_settings'));
  return (record?.value as Record<string, any> | undefined) ?? null;
}

/** Read-modify-write of the settings record in a single transaction. */
async function patchSettingsRaw(patch: Record<string, unknown>): Promise<void> {
  const db = await openNamedDB(DEVICE_DB_NAME);
  const tx = db.transaction('settings', 'readwrite');
  const store = tx.objectStore('settings');
  store.get('app_settings').onsuccess = (event) => {
    const current = ((event.target as IDBRequest).result?.value as Record<string, unknown>) ?? {};
    store.put({ key: 'app_settings', value: { ...current, ...patch } });
  };
  await txDone(tx);
}

/**
 * Which account's ledger is active on this device. Null means no account has
 * ever been linked, so the device's guest ledger is in use. The first load
 * also performs the one-time move of pre-account data into the owner's ledger.
 */
export function currentLedgerOwner(): Promise<string | null> {
  syncFactory();
  if (!ownerPromise) {
    ownerPromise = loadLedgerOwner().catch((error) => {
      ownerPromise = null;
      throw error;
    });
  }
  return ownerPromise;
}

async function readLayoutVersion(): Promise<number> {
  const db = await openNamedDB(DEVICE_DB_NAME);
  const tx = db.transaction('settings', 'readonly');
  const record = await requestPromise(tx.objectStore('settings').get(LAYOUT_RECORD_KEY));
  return Number(record?.value) || 1;
}

async function writeLayoutVersion(version: number): Promise<void> {
  const db = await openNamedDB(DEVICE_DB_NAME);
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key: LAYOUT_RECORD_KEY, value: version });
  await txDone(tx);
}

async function loadLedgerOwner(): Promise<string | null> {
  const raw = await readSettingsRaw();
  const owner = typeof raw?.dataOwnerUid === 'string' && raw.dataOwnerUid ? raw.dataOwnerUid : null;

  if ((await readLayoutVersion()) < LEDGER_LAYOUT_VERSION) {
    // Layout 1 kept every record in one database, tagged with its last owner.
    if (owner) {
      await moveLedgerRecords(DEVICE_DB_NAME, ledgerDbName(owner), { clearSource: true });
    }
    await writeLayoutVersion(LEDGER_LAYOUT_VERSION);
  }
  return owner;
}

/**
 * Make `uid` the account whose ledger this device works on. Called at sign-in.
 * A device that has never been linked to an account gives its guest records to
 * the first account that signs in. A device switching accounts keeps the
 * previous account's ledger untouched, ready for its next sign-in.
 */
export async function activateLedgerOwner(uid: string): Promise<{ claimed: number }> {
  if (!uid) throw new Error('A signed-in account is required to open its ledger.');
  const current = await currentLedgerOwner();
  if (current === uid) return { claimed: 0 };

  let claimed = 0;
  if (current === null) {
    claimed = await moveLedgerRecords(DEVICE_DB_NAME, ledgerDbName(uid), { clearSource: true });
  }
  // Google Drive file ids and sync timestamps are per account: the previous
  // account's Drive bookkeeping must not be reused for this one.
  await patchSettingsRaw({
    dataOwnerUid: uid,
    driveFolderId: null,
    driveLatestFileId: null,
    lastDriveSyncAt: null,
    lastDriveSnapshotTimestamp: null,
  });
  ownerPromise = Promise.resolve(uid);
  return { claimed };
}

/** Owner-scoped metadata (e.g. the one-time legacy cloud import flag). */
export async function getSyncMeta<T = unknown>(owner: string, key: string): Promise<T | undefined> {
  const db = await dbForOwner(owner);
  const tx = db.transaction(SYNC_META_STORE, 'readonly');
  const row = await requestPromise(tx.objectStore(SYNC_META_STORE).get(key));
  return row?.value as T | undefined;
}

export async function setSyncMeta(owner: string, key: string, value: unknown): Promise<void> {
  const db = await dbForOwner(owner);
  const tx = db.transaction(SYNC_META_STORE, 'readwrite');
  tx.objectStore(SYNC_META_STORE).put({ key, value });
  await txDone(tx);
}

// ─────────────────────────────────────────────────────────────────
// Sync outbox
// ─────────────────────────────────────────────────────────────────

export interface OutboxItem {
  key: string;
  kind: SyncKind;
  id: string;
  /** Changes on every queueing, so a push can tell whether its record was edited meanwhile. */
  token: string;
  queuedAt: number;
}

const outboxKey = (kind: SyncKind, id: string) => `${kind}:${id}`;
const newToken = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Mark a record as "must reach the cloud". Runs inside the caller's write transaction. */
function enqueueInTx(tx: IDBTransaction, kind: SyncKind, id: string): void {
  const item: OutboxItem = { key: outboxKey(kind, id), kind, id, token: newToken(), queuedAt: Date.now() };
  tx.objectStore(OUTBOX_STORE).put(item);
}

/** Pending outbox items for an account, oldest first. */
export async function readOutboxBatch(owner: string, limit = 200): Promise<OutboxItem[]> {
  const db = await dbForOwner(owner);
  const tx = db.transaction(OUTBOX_STORE, 'readonly');
  const items = (await requestPromise(tx.objectStore(OUTBOX_STORE).getAll())) as OutboxItem[];
  return items.sort((a, b) => a.queuedAt - b.queuedAt).slice(0, limit);
}

export async function countOutbox(owner: string): Promise<number> {
  const db = await dbForOwner(owner);
  const tx = db.transaction(OUTBOX_STORE, 'readonly');
  return requestPromise(tx.objectStore(OUTBOX_STORE).count());
}

/**
 * Remove an outbox item after it was pushed. The item is removed only if it
 * still carries the token that was pushed; a newer local edit keeps it queued.
 */
export async function ackOutboxItem(owner: string, key: string, token: string): Promise<void> {
  const db = await dbForOwner(owner);
  const tx = db.transaction(OUTBOX_STORE, 'readwrite');
  const store = tx.objectStore(OUTBOX_STORE);
  store.get(key).onsuccess = (event) => {
    const item = (event.target as IDBRequest).result as OutboxItem | undefined;
    if (item && item.token === token) store.delete(key);
  };
  await txDone(tx);
}

// ─────────────────────────────────────────────────────────────────
// Ledger read helpers
// ─────────────────────────────────────────────────────────────────

async function readLedgerData(db: IDBDatabase): Promise<SyncLedgerData> {
  const tx = db.transaction(LEDGER_STORES as unknown as string[], 'readonly');
  const [patientEntries, settlements, patientProfiles, auditLogs] = await Promise.all([
    requestPromise(tx.objectStore('patient_entries').getAll()) as Promise<PatientEntry[]>,
    requestPromise(tx.objectStore('settlements').getAll()) as Promise<Settlement[]>,
    requestPromise(tx.objectStore('patient_profiles').getAll()) as Promise<PatientProfile[]>,
    requestPromise(tx.objectStore('audit_logs').getAll()) as Promise<AuditLogEntry[]>,
  ]);
  return { patientEntries, settlements, patientProfiles, auditLogs };
}

/** Snapshot of the active account's ledger. */
export async function getSyncLedgerData(): Promise<SyncLedgerData> {
  return readLedgerData(await dbForOwner(await currentLedgerOwner()));
}

/** Whether an account's ledger holds any record. */
export async function isLedgerEmpty(owner: string): Promise<boolean> {
  return isSyncLedgerDataEmpty(await readLedgerData(await dbForOwner(owner)));
}

/** One record as stored locally, or null. Used by the push path. */
export async function readLedgerRecord(owner: string, kind: SyncKind, id: string): Promise<unknown | null> {
  const db = await dbForOwner(owner);
  const storeName = KIND_STORE[kind];
  const tx = db.transaction(storeName, 'readonly');
  const row = await requestPromise(tx.objectStore(storeName).get(id));
  return row ?? null;
}

/**
 * Latest deletion time recorded for an entry or settlement (from its audit
 * tombstone). Zero when the record was never deleted.
 */
export async function readDeletionTime(owner: string, kind: SyncKind, id: string): Promise<number> {
  if (kind !== 'entry' && kind !== 'settlement') return 0;
  const action = kind === 'entry' ? 'ENTRY_DELETED' : 'SETTLEMENT_DELETED';
  const db = await dbForOwner(owner);
  const tx = db.transaction('audit_logs', 'readonly');
  const logs = (await requestPromise(
    tx.objectStore('audit_logs').index('targetId').getAll(IDBKeyRange.only(id))
  )) as AuditLogEntry[];
  return logs
    .filter((log) => log.action === action)
    .reduce((latest, log) => Math.max(latest, Number(log.timestamp) || 0), 0);
}

// ─────────────────────────────────────────────────────────────────
// Shared write engine: diff + atomic apply + derived profile refresh
// ─────────────────────────────────────────────────────────────────

interface LedgerWriteResult {
  changed: number;
  /** Normalized names whose derived patient profile must be recalculated. */
  entryNames: Set<string>;
  profileIds: Set<string>;
}

/**
 * Write the difference between `current` and `next` inside `tx`. Only rows
 * that actually changed are written; each written row is queued for cloud
 * sync when `enqueue` is set.
 */
function writeLedgerDiff(
  tx: IDBTransaction,
  current: SyncLedgerData,
  next: SyncLedgerData,
  enqueue: boolean
): LedgerWriteResult {
  const result: LedgerWriteResult = { changed: 0, entryNames: new Set(), profileIds: new Set() };

  const diffStore = <T extends object>(
    kind: SyncKind,
    before: T[],
    after: T[],
    keyOf: (row: T) => string,
    onChanged: (row: T) => void
  ) => {
    const storeName = KIND_STORE[kind];
    const store = tx.objectStore(storeName);
    const beforeByKey = new Map(before.map((row) => [keyOf(row), row]));
    const afterByKey = new Map(after.map((row) => [keyOf(row), row]));

    for (const [key, row] of afterByKey) {
      const previous = beforeByKey.get(key);
      if (previous && recordFingerprint(previous) === recordFingerprint(row)) continue;
      store.put(row);
      if (enqueue) enqueueInTx(tx, kind, key);
      result.changed += 1;
      onChanged(row);
    }
    for (const [key, row] of beforeByKey) {
      if (afterByKey.has(key)) continue;
      store.delete(key);
      result.changed += 1;
      onChanged(row);
    }
  };

  diffStore<PatientEntry>(
    'entry',
    current.patientEntries,
    next.patientEntries,
    (row) => row.id,
    (row) => result.entryNames.add(normalizePatientName(row.patientName))
  );
  diffStore<Settlement>('settlement', current.settlements, next.settlements, (row) => row.settlementId, () => {});
  diffStore<PatientProfile>(
    'profile',
    current.patientProfiles,
    next.patientProfiles,
    (row) => row.id,
    (row) => result.profileIds.add(row.id)
  );
  diffStore<AuditLogEntry>('audit', current.auditLogs, next.auditLogs, (row) => row.id, () => {});

  return result;
}

/**
 * Merge `incoming` records into the database at `dbName`. Local records are
 * kept unless an incoming record is newer under the shared winner rule, or a
 * deletion tombstone says otherwise. Returns the number of rows written.
 */
async function applyLedgerRows(
  db: IDBDatabase,
  incoming: Partial<SyncLedgerData>,
  options: { enqueue: boolean }
): Promise<number> {
  const normalized: SyncLedgerData = {
    patientEntries: (incoming.patientEntries ?? []).map((row) => normalizeRemoteRecord('entry', row)),
    settlements: (incoming.settlements ?? []).map((row) => normalizeRemoteRecord('settlement', row)),
    patientProfiles: (incoming.patientProfiles ?? []).map((row) => normalizeRemoteRecord('profile', row)),
    auditLogs: (incoming.auditLogs ?? []).map((row) => normalizeRemoteRecord('audit', row)),
  };

  const tx = db.transaction([...LEDGER_STORES, OUTBOX_STORE], 'readwrite');
  let written: LedgerWriteResult = { changed: 0, entryNames: new Set(), profileIds: new Set() };

  const entriesReq = tx.objectStore('patient_entries').getAll();
  const settlementsReq = tx.objectStore('settlements').getAll();
  const profilesReq = tx.objectStore('patient_profiles').getAll();
  const auditReq = tx.objectStore('audit_logs').getAll();
  const done = txDone(tx);

  let pending = 4;
  const onRead = () => {
    pending -= 1;
    if (pending > 0) return;
    const current: SyncLedgerData = {
      patientEntries: (entriesReq.result as PatientEntry[]) ?? [],
      settlements: (settlementsReq.result as Settlement[]) ?? [],
      patientProfiles: (profilesReq.result as PatientProfile[]) ?? [],
      auditLogs: (auditReq.result as AuditLogEntry[]) ?? [],
    };
    const merged = mergeSyncLedgerData(current, normalized);
    written = writeLedgerDiff(tx, current, merged, options.enqueue);
  };
  for (const req of [entriesReq, settlementsReq, profilesReq, auditReq]) req.onsuccess = onRead;

  await done;

  if (written.changed > 0) {
    // Derived patient totals are recalculated locally from entries; they are
    // not a source of truth, so the refresh itself is never queued for sync.
    await recomputeProfilesTx(db, written.entryNames, { enqueue: false, allowDelete: true });
    const profileOnly = [...written.profileIds].filter((id) => !written.entryNames.has(id));
    await recomputeProfilesTx(db, profileOnly, { enqueue: false, allowDelete: false });
  }
  return written.changed;
}

/**
 * Records from a cloud or Drive source, normalized and grouped by kind. Used
 * by the sync engine and the Drive restore path.
 */
export function ledgerDataFromRecords(
  records: { kind: SyncKind; value: unknown }[]
): Partial<SyncLedgerData> {
  const data: Partial<SyncLedgerData> = { patientEntries: [], settlements: [], patientProfiles: [], auditLogs: [] };
  for (const { kind, value } of records) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    switch (kind) {
      case 'entry':
        if (typeof row.id === 'string') data.patientEntries!.push(row as unknown as PatientEntry);
        break;
      case 'settlement':
        if (typeof row.settlementId === 'string') data.settlements!.push(row as unknown as Settlement);
        break;
      case 'profile':
        if (typeof row.id === 'string') data.patientProfiles!.push(row as unknown as PatientProfile);
        break;
      case 'audit':
        if (typeof row.id === 'string') data.auditLogs!.push(row as unknown as AuditLogEntry);
        break;
    }
  }
  return data;
}

/**
 * Apply records received from the cloud to the account's ledger. Never queued
 * for upload (they originated in the cloud), so devices do not echo changes
 * back and forth. Returns how many local rows changed.
 */
export async function applyRemoteRecords(
  owner: string,
  records: { kind: SyncKind; value: unknown }[]
): Promise<number> {
  const db = await dbForOwner(owner);
  return applyLedgerRows(db, ledgerDataFromRecords(records), { enqueue: false });
}

/**
 * Import a complete snapshot (legacy cloud blob or Drive backup) into an
 * account's ledger as a union. Rows that are new to this device are queued so
 * the account's other devices receive them. Nothing local is discarded.
 */
export async function importLedgerSnapshot(
  owner: string,
  data: Partial<SyncLedgerData>
): Promise<number> {
  const db = await dbForOwner(owner);
  return applyLedgerRows(db, data, { enqueue: true });
}

/** Move every ledger row from one database to another as a union (used by ownership changes). */
async function moveLedgerRecords(
  fromName: string,
  toName: string,
  options: { clearSource: boolean }
): Promise<number> {
  const source = await readLedgerData(await openNamedDB(fromName));
  if (isSyncLedgerDataEmpty(source) && !options.clearSource) return 0;
  const target = await openNamedDB(toName);
  const changed = await applyLedgerRows(target, source, { enqueue: true });
  if (options.clearSource) await clearLedgerStores(await openNamedDB(fromName));
  return changed;
}

async function clearLedgerStores(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([...LEDGER_STORES, OUTBOX_STORE], 'readwrite');
  for (const storeName of LEDGER_STORES) tx.objectStore(storeName).clear();
  tx.objectStore(OUTBOX_STORE).clear();
  await txDone(tx);
}

// ─────────────────────────────────────────────────────────────────
// Audit trail
// ─────────────────────────────────────────────────────────────────

function makeAudit(
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { timestamp?: number }
): AuditLogEntry {
  const { timestamp, ...auditFields } = entry;
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: timestamp ?? Date.now(),
    ...auditFields,
  };
}

export async function logAudit(
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { timestamp?: number }
): Promise<AuditLogEntry> {
  const auditItem = makeAudit(entry);
  try {
    const db = await dbForOwner(await currentLedgerOwner());
    const tx = db.transaction(['audit_logs', OUTBOX_STORE], 'readwrite');
    tx.objectStore('audit_logs').put(auditItem);
    enqueueInTx(tx, 'audit', auditItem.id);
    await txDone(tx);
  } catch (err) {
    console.warn('Failed to record audit log:', err);
  }
  return auditItem;
}

// ---------------- Patient Entries ---------------- //

export async function getAllPatientEntries(): Promise<PatientEntry[]> {
  const db = await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction('patient_entries', 'readonly');
  const entries = ((await requestPromise(tx.objectStore('patient_entries').getAll())) || []) as PatientEntry[];
  // sort by date desc, then serial desc
  entries.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.serial - a.serial;
  });
  return entries;
}

export async function getNextSerial(): Promise<number> {
  const entries = await getAllPatientEntries();
  if (entries.length === 0) return 1;
  const maxSerial = Math.max(...entries.map((e) => e.serial || 0));
  return maxSerial + 1;
}

/**
 * Save (create or edit) an entry. The record, its audit event and their sync
 * markers are written in one transaction, so the change is durable and queued
 * for the cloud as a single unit.
 */
export async function savePatientEntry(entry: PatientEntry): Promise<PatientEntry> {
  const db = await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction(['patient_entries', 'audit_logs', OUTBOX_STORE], 'readwrite');
  const entries = tx.objectStore('patient_entries');
  const audits = tx.objectStore('audit_logs');

  entries.get(entry.id).onsuccess = (event) => {
    const existing = (event.target as IDBRequest).result as PatientEntry | undefined;
    entries.put(entry);
    const audit = existing
      ? makeAudit({
          action: 'ENTRY_EDITED',
          targetId: entry.id,
          targetType: 'patient_entry',
          details: `Edited record for ${entry.patientName} (${entry.procedure}) - Bill: ৳${entry.receivedAmount}, Share: ৳${entry.doctorShare}`,
          previousData: existing,
          newData: entry,
        })
      : makeAudit({
          action: 'ENTRY_CREATED',
          targetId: entry.id,
          targetType: 'patient_entry',
          details: `Created record #${entry.serial} for ${entry.patientName} (${entry.procedure}) - Bill: ৳${entry.receivedAmount}`,
          newData: entry,
        });
    audits.put(audit);
    enqueueInTx(tx, 'entry', entry.id);
    enqueueInTx(tx, 'audit', audit.id);
  };

  await txDone(tx);
  try {
    await updateProfileForPatient(entry.patientName);
  } catch (err) {
    console.warn('Auto profile update notice:', err);
  }
  return entry;
}

/**
 * Restore a deleted entry (Undo). Its restored version is stamped after the
 * deletion tombstone, so the undo can never be discarded by sync.
 */
export async function restorePatientEntry(entry: PatientEntry): Promise<PatientEntry> {
  const db = await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction('audit_logs', 'readonly');
  const tombstones = (await requestPromise(
    tx.objectStore('audit_logs').index('targetId').getAll(IDBKeyRange.only(entry.id))
  )) as AuditLogEntry[];
  const deletedAt = tombstones
    .filter((log) => log.action === 'ENTRY_DELETED')
    .reduce((latest, log) => Math.max(latest, log.timestamp || 0), 0);
  const restored: PatientEntry = {
    ...entry,
    updatedAt: Math.max(Date.now(), deletedAt + 1, entry.updatedAt || 0),
  };
  return savePatientEntry(restored);
}

export async function deletePatientEntry(id: string): Promise<void> {
  const db = await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction(['patient_entries', 'audit_logs', OUTBOX_STORE], 'readwrite');
  const entries = tx.objectStore('patient_entries');
  const audits = tx.objectStore('audit_logs');
  let deletedPatientName: string | null = null;

  entries.get(id).onsuccess = (event) => {
    const existing = (event.target as IDBRequest).result as PatientEntry | undefined;
    if (!existing) return;
    deletedPatientName = existing.patientName;
    entries.delete(id);
    const audit = makeAudit({
      action: 'ENTRY_DELETED',
      targetId: id,
      targetType: 'patient_entry',
      timestamp: Math.max(Date.now(), (existing.updatedAt || existing.createdAt || 0) + 1),
      details: `Deleted record of ${existing.patientName} (${existing.procedure}) dated ${existing.date} - Bill: ৳${existing.receivedAmount}`,
      previousData: existing,
    });
    audits.put(audit);
    enqueueInTx(tx, 'entry', id);
    enqueueInTx(tx, 'audit', audit.id);
  };

  await txDone(tx);
  try {
    if (deletedPatientName) await updateProfileForPatient(deletedPatientName);
  } catch (err) {
    console.warn('Auto profile recalculation after delete notice:', err);
  }
}

// ---------------- Patient Profiles ---------------- //

export function normalizePatientName(name: string): string {
  return (name || '').trim().toLowerCase();
}

function buildProfile(
  visits: PatientEntry[],
  trimmedName: string,
  existing: PatientProfile | undefined,
  now: number
): PatientProfile {
  const byDateAsc = [...visits].sort((a, b) => a.date.localeCompare(b.date));
  const byRecent = [...visits].sort((a, b) => b.date.localeCompare(a.date) || b.serial - a.serial);
  const procSet = new Set<string>();
  byRecent.forEach((e) => {
    if (e.procedure && e.procedure.trim()) procSet.add(e.procedure.trim());
  });
  return {
    id: normalizePatientName(trimmedName),
    // Use the most recent well-cased name
    name: byRecent[0]?.patientName?.trim() || trimmedName,
    phone: existing?.phone || '',
    notes: existing?.notes || '',
    totalVisits: visits.length,
    totalBilled: visits.reduce((sum, e) => sum + (e.receivedAmount || 0), 0),
    totalDoctorShare: visits.reduce((sum, e) => sum + (e.doctorShare || 0), 0),
    firstVisitDate: byDateAsc[0].date,
    lastVisitDate: byDateAsc[byDateAsc.length - 1].date,
    procedures: Array.from(procSet),
    createdAt: existing?.createdAt || now,
    // The version only moves on a user edit (phone/notes). Recalculating totals
    // keeps it, so an older derived refresh can never overwrite a newer edit.
    updatedAt: existing?.updatedAt || now,
  };
}

function sameDerivedProfile(a: PatientProfile, b: PatientProfile): boolean {
  return (
    a.name === b.name &&
    a.totalVisits === b.totalVisits &&
    a.totalBilled === b.totalBilled &&
    a.totalDoctorShare === b.totalDoctorShare &&
    a.firstVisitDate === b.firstVisitDate &&
    a.lastVisitDate === b.lastVisitDate &&
    a.procedures.join('\u0001') === b.procedures.join('\u0001')
  );
}

/**
 * Recalculate one patient's profile from their visits, inside one transaction.
 * A profile with no visits left is removed (when `allowDelete`). Phone and
 * notes are always preserved.
 */
function recomputeProfileTx(
  db: IDBDatabase,
  rawName: string,
  options: { enqueue: boolean; allowDelete: boolean }
): Promise<PatientProfile | null> {
  const trimmed = (rawName || '').trim();
  if (!trimmed) return Promise.resolve(null);
  const profileId = normalizePatientName(trimmed);

  const tx = db.transaction(['patient_entries', 'patient_profiles', OUTBOX_STORE], 'readwrite');
  let result: PatientProfile | null = null;
  const entriesReq = tx.objectStore('patient_entries').getAll();
  entriesReq.onsuccess = () => {
    const visits = ((entriesReq.result as PatientEntry[]) ?? []).filter(
      (e) => normalizePatientName(e.patientName) === profileId
    );
    const profiles = tx.objectStore('patient_profiles');
    profiles.get(profileId).onsuccess = (event) => {
      const existing = (event.target as IDBRequest).result as PatientProfile | undefined;
      if (visits.length === 0) {
        if (existing && options.allowDelete) {
          profiles.delete(profileId);
          result = null;
        } else {
          result = existing ?? null;
        }
        return;
      }
      const next = buildProfile(visits, trimmed, existing, Date.now());
      if (existing && sameDerivedProfile(existing, next) && existing.phone === next.phone && existing.notes === next.notes) {
        result = existing;
        return;
      }
      profiles.put(next);
      if (options.enqueue) enqueueInTx(tx, 'profile', profileId);
      result = next;
    };
  };
  return txDone(tx).then(() => result);
}

/**
 * Recalculate profiles for many patients in ONE transaction (bulk imports and
 * remote merges touch many names; reading the visit list once keeps this linear).
 */
function recomputeProfilesTx(
  db: IDBDatabase,
  names: Iterable<string>,
  options: { enqueue: boolean; allowDelete: boolean }
): Promise<void> {
  const wanted = new Set<string>();
  for (const name of names) {
    const id = normalizePatientName(name);
    if (id) wanted.add(id);
  }
  if (wanted.size === 0) return Promise.resolve();

  const tx = db.transaction(['patient_entries', 'patient_profiles', OUTBOX_STORE], 'readwrite');
  const entriesReq = tx.objectStore('patient_entries').getAll();
  const profilesReq = tx.objectStore('patient_profiles').getAll();
  let loaded = 0;
  const onLoaded = () => {
    loaded += 1;
    if (loaded < 2) return;
    const visitsByName = new Map<string, PatientEntry[]>();
    for (const entry of (entriesReq.result as PatientEntry[]) ?? []) {
      const id = normalizePatientName(entry.patientName);
      if (!wanted.has(id)) continue;
      const list = visitsByName.get(id);
      if (list) list.push(entry);
      else visitsByName.set(id, [entry]);
    }
    const profiles = new Map(((profilesReq.result as PatientProfile[]) ?? []).map((p) => [p.id, p]));
    const store = tx.objectStore('patient_profiles');
    for (const id of wanted) {
      const visits = visitsByName.get(id) ?? [];
      const existing = profiles.get(id);
      if (visits.length === 0) {
        if (existing && options.allowDelete) store.delete(id);
        continue;
      }
      const next = buildProfile(visits, visits[0].patientName.trim(), existing, Date.now());
      if (existing && sameDerivedProfile(existing, next) && existing.phone === next.phone && existing.notes === next.notes) {
        continue;
      }
      store.put(next);
      if (options.enqueue) enqueueInTx(tx, 'profile', id);
    }
  };
  entriesReq.onsuccess = onLoaded;
  profilesReq.onsuccess = onLoaded;
  return txDone(tx);
}

/**
 * Recalculate or create a profile for a given patient name based on their entries
 */
export async function updateProfileForPatient(rawName: string): Promise<PatientProfile | null> {
  const db = await dbForOwner(await currentLedgerOwner());
  return recomputeProfileTx(db, rawName, { enqueue: true, allowDelete: true });
}

export async function getPatientProfileById(id: string): Promise<PatientProfile | null> {
  try {
    const db = await dbForOwner(await currentLedgerOwner());
    const tx = db.transaction('patient_profiles', 'readonly');
    return ((await requestPromise(tx.objectStore('patient_profiles').get(id))) as PatientProfile) || null;
  } catch {
    return null;
  }
}

export async function getAllPatientProfiles(): Promise<PatientProfile[]> {
  try {
    const db = await dbForOwner(await currentLedgerOwner());
    const tx = db.transaction('patient_profiles', 'readonly');
    const list = ((await requestPromise(tx.objectStore('patient_profiles').getAll())) || []) as PatientProfile[];
    // Sort by last visit descending, then total visits desc
    list.sort((a, b) => b.lastVisitDate.localeCompare(a.lastVisitDate) || b.totalVisits - a.totalVisits);
    return list;
  } catch {
    return [];
  }
}

export async function savePatientProfile(profile: PatientProfile): Promise<PatientProfile> {
  const db = await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction(['patient_profiles', OUTBOX_STORE], 'readwrite');
  profile.updatedAt = Date.now();
  tx.objectStore('patient_profiles').put(profile);
  enqueueInTx(tx, 'profile', profile.id);
  await txDone(tx);
  return profile;
}

/**
 * Re-indexes all existing patient entries to build or update patient profiles
 * (useful on initialization or when syncing data)
 */
export async function syncAllPatientProfiles(): Promise<PatientProfile[]> {
  const db = await dbForOwner(await currentLedgerOwner());
  const allEntries = await getAllPatientEntries();
  const namesMap = new Map<string, string>();
  allEntries.forEach((e) => {
    const norm = normalizePatientName(e.patientName);
    if (norm && !namesMap.has(norm)) namesMap.set(norm, e.patientName.trim());
  });

  // Profiles whose visits no longer exist are removed as well (allowDelete).
  const orphanNames = (await getAllPatientProfiles())
    .map((profile) => profile.name)
    .filter((name) => !namesMap.has(normalizePatientName(name)));
  await recomputeProfilesTx(db, [...namesMap.values(), ...orphanNames], { enqueue: false, allowDelete: true });

  return getAllPatientProfiles();
}

// ---------------- Settlements ---------------- //

export async function getAllSettlements(): Promise<Settlement[]> {
  const db = await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction('settlements', 'readonly');
  const settlements = ((await requestPromise(tx.objectStore('settlements').getAll())) || []) as Settlement[];
  settlements.sort((a, b) => b.settlementDate.localeCompare(a.settlementDate) || b.createdAt - a.createdAt);
  return settlements;
}

export async function getLatestSettlement(): Promise<Settlement | null> {
  const settlements = await getAllSettlements();
  return settlements.length > 0 ? settlements[0] : null;
}

export async function saveSettlement(settlement: Settlement): Promise<Settlement> {
  const db = await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction(['settlements', OUTBOX_STORE], 'readwrite');
  tx.objectStore('settlements').put(settlement);
  enqueueInTx(tx, 'settlement', settlement.settlementId);
  await txDone(tx);
  return settlement;
}

/**
 * Delete a settlement batch. Its visits return to Pending with a newer version,
 * so the reversal wins during multi-device sync. The deletion is recorded as a
 * tombstone in the same transaction.
 */
export async function deleteSettlement(settlementId: string): Promise<void> {
  const db = await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction(['settlements', 'patient_entries', 'audit_logs', OUTBOX_STORE], 'readwrite');
  const settlementStore = tx.objectStore('settlements');
  const patientStore = tx.objectStore('patient_entries');
  const auditStore = tx.objectStore('audit_logs');

  settlementStore.get(settlementId).onsuccess = (event) => {
    const existing = (event.target as IDBRequest).result as Settlement | undefined;
    const audit = makeAudit({
      action: 'SETTLEMENT_DELETED',
      targetId: settlementId,
      targetType: 'settlement',
      timestamp: Math.max(Date.now(), (existing?.createdAt || 0) + 1),
      details: `Deleted settlement batch ${settlementId} - Associated patients reverted to Pending`,
    });
    auditStore.put(audit);
    enqueueInTx(tx, 'audit', audit.id);
    settlementStore.delete(settlementId);
    enqueueInTx(tx, 'settlement', settlementId);
  };

  patientStore.getAll().onsuccess = (event) => {
    const entries = ((event.target as IDBRequest).result as PatientEntry[]) ?? [];
    for (const entry of entries) {
      if (entry.settlementId !== settlementId) continue;
      const reverted: PatientEntry = {
        ...entry,
        settlementStatus: 'Pending',
        settlementId: null,
        updatedAt: Math.max(Date.now(), (entry.updatedAt || entry.createdAt || 0) + 1),
      };
      patientStore.put(reverted);
      enqueueInTx(tx, 'entry', reverted.id);
    }
  };

  await txDone(tx);
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

/**
 * Batch-settle every pending visit in the period. Visits, the new settlement
 * and the audit event are written in one transaction; the batch ID is derived
 * from the day's existing batches.
 */
export async function executeSettlement(params: {
  periodFrom: string;
  periodTo: string;
  amountReceived: number;
  remarks: string;
}): Promise<Settlement> {
  const db = await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction(['patient_entries', 'settlements', 'audit_logs', OUTBOX_STORE], 'readwrite');
  const patientStore = tx.objectStore('patient_entries');
  const settlementStore = tx.objectStore('settlements');
  const auditStore = tx.objectStore('audit_logs');
  const done = txDone(tx);
  let created: Settlement | null = null;

  const todayStr = todayDateKey();
  const dateCompact = todayStr.replace(/-/g, '');

  settlementStore.getAll().onsuccess = (settlementsEvent) => {
    const existingSettlements = (((settlementsEvent.target as IDBRequest).result as Settlement[]) || []).slice();
    existingSettlements.sort((a, b) => b.settlementDate.localeCompare(a.settlementDate) || b.createdAt - a.createdAt);

    const latest = existingSettlements.length > 0 ? existingSettlements[0] : null;
    const previousDue = latest ? latest.dueBalance : 0;

    const todaySettlements = existingSettlements.filter((s) => s.settlementDate === todayStr);
    const seq = String(todaySettlements.length + 1).padStart(2, '0');
    const settlementId = `ST-${dateCompact}-${seq}`;

    patientStore.getAll().onsuccess = (entriesEvent) => {
      const allEntries = ((entriesEvent.target as IDBRequest).result as PatientEntry[]) || [];
      const eligible = allEntries.filter(
        (e) => e.settlementStatus === 'Pending' && e.date >= params.periodFrom && e.date <= params.periodTo
      );

      const periodShare = eligible.reduce((acc, curr) => acc + curr.doctorShare, 0);
      const totalPayable = periodShare + previousDue;
      const dueBalance = totalPayable - params.amountReceived;

      for (const entry of eligible) {
        const settled: PatientEntry = {
          ...entry,
          settlementStatus: 'Settled',
          settlementId,
          updatedAt: Math.max(Date.now(), (entry.updatedAt || 0) + 1),
        };
        patientStore.put(settled);
        enqueueInTx(tx, 'entry', settled.id);
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
        patientIds: eligible.map((e) => e.id),
        createdAt: Date.now(),
      };
      settlementStore.put(newSettlement);
      enqueueInTx(tx, 'settlement', settlementId);

      const audit = makeAudit({
        action: 'SETTLEMENT_CREATED',
        targetId: settlementId,
        targetType: 'settlement',
        details: `Reconciled batch ${settlementId} (${params.periodFrom} to ${params.periodTo}): ${eligible.length} visits. Claimable: ৳${totalPayable}, Paid: ৳${params.amountReceived}, Due: ৳${dueBalance}`,
        newData: newSettlement,
      });
      auditStore.put(audit);
      enqueueInTx(tx, 'audit', audit.id);
      created = newSettlement;
    };
  };

  await done;
  if (!created) throw new Error('Settlement could not be created.');
  return created;
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

        // ── One-time "Follow-up" preset back-fill ──────────────────────
        // Records saved by builds before the follow-up feature lack the flag.
        // Their customized lists get "Follow-up" added once and the flag is
        // persisted, so a doctor who later removes the preset from Settings
        // keeps it removed. Records without a stored list keep using today's
        // defaults (which already contain the preset), so nothing is frozen.
        const needsFollowUpCheck = stored.followUpPresetsChecked !== true;
        const storedProcedures =
          Array.isArray(stored.procedures) && stored.procedures.length > 0
            ? stored.procedures
            : null;
        const storedAmountPresets =
          Array.isArray(stored.amountPresets) && stored.amountPresets.length > 0
            ? stored.amountPresets
            : null;

        const procedures = storedProcedures
          ? needsFollowUpCheck
            ? withFollowUpProcedure(storedProcedures)
            : storedProcedures
          : DEFAULT_PROCEDURES;
        const amountPresets = storedAmountPresets
          ? needsFollowUpCheck
            ? withFollowUpAmountPreset(storedAmountPresets)
            : storedAmountPresets
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
            followUpPresetsChecked: true,
          },
          // Only the checked fields change in storage. Everything else stays as
          // saved, so today's defaults are not frozen into the record.
          migratedRecord:
            needsMigration || needsFollowUpCheck
              ? {
                  ...stored,
                  doctorName,
                  doctorEmail,
                  doctorPhoto,
                  ownerUid,
                  ...(storedProcedures ? { procedures } : {}),
                  ...(storedAmountPresets ? { amountPresets } : {}),
                  legacyIdentityChecked: true,
                  followUpPresetsChecked: true,
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
  // Account ownership is managed by activateLedgerOwner (it switches the ledger).
  if (settings.dataOwnerUid && settings.dataOwnerUid !== (await currentLedgerOwner())) {
    await activateLedgerOwner(settings.dataOwnerUid);
  }
  const current = await getSettings();
  const { dataOwnerUid: _ownerIgnored, ...patch } = settings;
  // Anything saved by this build has already passed the placeholder and
  // follow-up preset checks, so both flags are stamped on the record.
  const updated = {
    ...current,
    ...patch,
    dataOwnerUid: current.dataOwnerUid ?? null,
    legacyIdentityChecked: true,
    followUpPresetsChecked: true,
  };
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
  const db = await dbForOwner(await currentLedgerOwner());
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
    // The connection is shared and cached; it must not be closed here.
  }

  // If a genuine patient shares a sample name, retain their profile and
  // recalculate its totals from genuine visits only, preserving notes/phone.
  await recomputeProfilesTx(db, profilesToRebuild, { enqueue: false, allowDelete: true });

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

// ---------------- Multi-device Cloud Sync ---------------- //

/**
 * Union a snapshot of cloud records into the active ledger. Used by the
 * legacy-blob import and by tests. Nothing local is discarded, and the
 * changes are not echoed back to the cloud.
 */
export async function mergeRemoteSyncData(remote: Partial<SyncLedgerData>): Promise<boolean> {
  const db = await dbForOwner(await currentLedgerOwner());
  return (await applyLedgerRows(db, remote, { enqueue: false })) > 0;
}

// ---------------- Google Drive Restore ---------------- //

/**
 * Remove every patient record (entries, settlements, profiles, audit logs)
 * from the ACTIVE account's local ledger, keeping settings and the outbox.
 * Nothing is deleted from any cloud copy.
 */
export async function clearAllPatientData(): Promise<void> {
  const db = await dbForOwner(await currentLedgerOwner());
  const tx = db.transaction(LEDGER_STORES as unknown as string[], 'readwrite');
  for (const storeName of LEDGER_STORES) tx.objectStore(storeName).clear();
  await txDone(tx);
}

/**
 * Replace the active account's ledger with the contents of a backup snapshot,
 * in a single transaction (so an interruption leaves the old data intact).
 * Cloud bookkeeping fields stay local so a stale backup cannot clobber this
 * device's backup schedule, folder, or account ownership.
 *
 * A snapshot with no records never replaces existing local records, so an
 * empty or truncated file cannot erase data.
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
    // The follow-up preset back-fill works the same way: a backup written before
    // the feature still gets "Follow-up" added once after it is restored.
    followUpPresetsChecked: backupSettings.followUpPresetsChecked === true,
    lastDriveSnapshotTimestamp: current.lastDriveSnapshotTimestamp ?? null,
    lastDriveSyncAt: current.lastDriveSyncAt ?? null,
    driveFolderId: current.driveFolderId ?? null,
    driveLatestFileId: current.driveLatestFileId ?? null,
    ledgerSpreadsheetId: current.ledgerSpreadsheetId ?? null,
    // Which account owns this device's cached dataset is device bookkeeping,
    // not dataset content — a backup (or an imported file) never re-tags it.
    dataOwnerUid: current.dataOwnerUid ?? null,
    procedures:
      backupSettings.procedures && backupSettings.procedures.length > 0
        ? backupSettings.procedures
        : current.procedures,
    amountPresets:
      backupSettings.amountPresets && backupSettings.amountPresets.length > 0
        ? backupSettings.amountPresets
        : current.amountPresets,
  };

  const rows: SyncLedgerData = {
    patientEntries: (payload.patientEntries || []).map((row) => normalizeRemoteRecord('entry', row)),
    settlements: (payload.settlements || []).map((row) => normalizeRemoteRecord('settlement', row)),
    patientProfiles: (payload.patientProfiles || []).map((row) => normalizeRemoteRecord('profile', row)),
    auditLogs: (payload.auditLogs || []).map((row) => normalizeRemoteRecord('audit', row)),
  };

  const db = await dbForOwner(await currentLedgerOwner());
  const existing = await readLedgerData(db);
  if (isSyncLedgerDataEmpty(rows) && !isSyncLedgerDataEmpty(existing)) {
    throw new Error('The backup contains no records, so the current data was left unchanged.');
  }

  const tx = db.transaction([...LEDGER_STORES, OUTBOX_STORE], 'readwrite');
  const fill = (kind: SyncKind, storeName: LedgerStore, list: any[]) => {
    const store = tx.objectStore(storeName);
    store.clear();
    for (const row of list) {
      store.put(row);
      enqueueInTx(tx, kind, (kind === 'settlement' ? row.settlementId : row.id) as string);
    }
  };
  fill('entry', 'patient_entries', rows.patientEntries);
  fill('settlement', 'settlements', rows.settlements);
  fill('profile', 'patient_profiles', rows.patientProfiles);
  fill('audit', 'audit_logs', rows.auditLogs);
  await txDone(tx);

  await writeSettingsRecord(mergedSettings);
  await removeLegacyDemoData();
}
