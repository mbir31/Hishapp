/**
 * HISAPP — CLOUD SYNC POLICY (PURE)
 * ─────────────────────────────────────────────────────────────────
 * Decides how to reconcile the local browser cache with the signed-in
 * account's legacy Google Drive snapshot. Realtime Database is the live
 * multi-device sync source; Drive snapshots remain a recovery layer. Account
 * switches still isolate datasets so one Gmail account never sees or backs
 * up another account's local records.
 */

import type { AuditLogEntry, PatientEntry, PatientProfile, Settlement } from '../types';

export type SignInSyncAction =
  /** Replace the local cache with the signing-in account's Drive backup. */
  | 'restore-cloud'
  /** Merge same-account Drive data with local records without discarding offline entries. */
  | 'merge-cloud'
  /** Wipe the local cache: it belongs to a different account that has no cloud backup. */
  | 'clear-local'
  /** Keep the local cache (it is empty, or there is no cloud copy to merge). */
  | 'keep-local';

export interface SignInSyncInput {
  /** Firebase uid of the account signing in right now. */
  userUid: string;
  /** Uid of the account that was signed in just before, within this app session. */
  previousUserUid: string | null;
  /** Persisted owner of the locally cached dataset (survives sign-out). */
  dataOwnerUid: string | null;
  /** Whether the local database currently holds any records. */
  localHasData: boolean;
  /** Whether the signing-in account's Drive holds any syncable data. */
  cloudHasData: boolean;
  /** snapshotTimestamp of the newest Drive backup (0 when there is none). */
  cloudSnapshotAt: number;
  /** The device's last known Drive sync point (0 when it never synced). */
  lastSyncedAt: number;
}

export interface SignInSyncDecision {
  action: SignInSyncAction;
  /** True when the local cache is known to belong to a different account. */
  accountSwitched: boolean;
}

/** Ledger data shared through the authenticated Firebase Realtime Database. */
export interface SyncLedgerData {
  patientEntries: PatientEntry[];
  settlements: Settlement[];
  auditLogs: AuditLogEntry[];
  patientProfiles: PatientProfile[];
}

export const EMPTY_SYNC_LEDGER_DATA: SyncLedgerData = {
  patientEntries: [],
  settlements: [],
  auditLogs: [],
  patientProfiles: [],
};

/**
 * True when the local cache belongs to an account other than the one signing
 * in. Two signals, because a sign-out clears the in-memory session user:
 *   • previousUserUid — catches an account swap within one app session
 *     (e.g. the sign-in popup was pointed at another Gmail account), even on
 *     installs whose backups predate the persisted dataOwnerUid tag;
 *   • dataOwnerUid — the persisted tag, which survives sign-out and app
 *     restarts.
 */
export function isAccountSwitch(input: Pick<SignInSyncInput, 'userUid' | 'previousUserUid' | 'dataOwnerUid'>): boolean {
  return (
    (!!input.previousUserUid && input.previousUserUid !== input.userUid) ||
    (!!input.dataOwnerUid && input.dataOwnerUid !== input.userUid)
  );
}

export function decideSignInSync(input: SignInSyncInput): SignInSyncDecision {
  // ── Account switch: the new account's Drive backup always wins ──────
  // The local cache holds the PREVIOUS account's records. Restore the new
  // account's own backup over it — or, when the new account has no backups
  // yet, clear the cache so its owner is neither shown nor uploaded here.
  // (The previous account's data stays safe in its own Google Drive.)
  if (isAccountSwitch(input)) {
    return {
      action: input.cloudHasData ? 'restore-cloud' : 'clear-local',
      accountSwitched: true,
    };
  }

  // A new device or wiped browser adopts the account's existing backup.
  if (!input.localHasData) {
    return {
      action: input.cloudHasData ? 'restore-cloud' : 'keep-local',
      accountSwitched: false,
    };
  }

  // A cache already tagged to this account may contain offline or concurrent
  // edits. Merge the Drive copy into it instead of replacing it: the live
  // Realtime Database sync then reconciles both devices' records by ID and
  // per-record update time.
  if (input.dataOwnerUid === input.userUid) {
    return {
      action: input.cloudHasData ? 'merge-cloud' : 'keep-local',
      accountSwitched: false,
    };
  }

  // An unclaimed local cache can belong to another person who used the app
  // while signed out. Preserve the account-isolation policy for that case:
  // only adopt a newer Drive snapshot; otherwise keep the local data.
  const cloudIsNewer = input.cloudHasData && input.cloudSnapshotAt > input.lastSyncedAt;
  return {
    action: cloudIsNewer ? 'restore-cloud' : 'keep-local',
    accountSwitched: false,
  };
}

/**
 * Merge local and remote records without dropping independent device writes.
 * Entity IDs are stable across sync. Conflicts on the same ID use the newest
 * `updatedAt`/`createdAt` value; exact timestamp ties use a deterministic
 * lexical comparison so every device reaches the same result.
 *
 * Deletions travel as audit-log tombstones. A later save/undo can recreate a
 * record by carrying a newer `updatedAt` than its delete event.
 */
export function mergeSyncLedgerData(
  local: Partial<SyncLedgerData> | null | undefined,
  remote: Partial<SyncLedgerData> | null | undefined
): SyncLedgerData {
  const auditLogs = mergeRows(
    local?.auditLogs ?? [],
    remote?.auditLogs ?? [],
    (row) => row.id,
    (row) => row.timestamp
  );
  const deletedEntryAt = new Map<string, number>();
  const deletedSettlementAt = new Map<string, number>();

  for (const log of auditLogs) {
    if (log.action === 'ENTRY_DELETED' && log.targetType === 'patient_entry') {
      deletedEntryAt.set(log.targetId, Math.max(deletedEntryAt.get(log.targetId) ?? 0, log.timestamp || 0));
    }
    if (log.action === 'SETTLEMENT_DELETED' && log.targetType === 'settlement') {
      deletedSettlementAt.set(
        log.targetId,
        Math.max(deletedSettlementAt.get(log.targetId) ?? 0, log.timestamp || 0)
      );
    }
  }

  const patientEntries = mergeRows(
    local?.patientEntries ?? [],
    remote?.patientEntries ?? [],
    (row) => row.id,
    (row) => Math.max(Number(row.updatedAt) || 0, Number(row.createdAt) || 0)
  )
    .filter((entry) => (deletedEntryAt.get(entry.id) ?? 0) < Math.max(entry.updatedAt || 0, entry.createdAt || 0))
    .sort((a, b) => a.date.localeCompare(b.date) || a.serial - b.serial || a.id.localeCompare(b.id));

  const settlements = mergeRows(
    local?.settlements ?? [],
    remote?.settlements ?? [],
    (row) => row.settlementId,
    (row) => Number(row.createdAt) || 0
  )
    .filter((settlement) => (deletedSettlementAt.get(settlement.settlementId) ?? 0) < (settlement.createdAt || 0))
    .sort((a, b) => a.settlementDate.localeCompare(b.settlementDate) || a.createdAt - b.createdAt);

  const patientProfiles = mergeRows(
    local?.patientProfiles ?? [],
    remote?.patientProfiles ?? [],
    (profile) => profile.id,
    (profile) => Math.max(Number(profile.updatedAt) || 0, Number(profile.createdAt) || 0)
  ).sort((a, b) => a.id.localeCompare(b.id));

  return { patientEntries, settlements, auditLogs, patientProfiles };
}

export function isSyncLedgerDataEmpty(data: Partial<SyncLedgerData> | null | undefined): boolean {
  return (
    !data?.patientEntries?.length &&
    !data?.settlements?.length &&
    !data?.auditLogs?.length &&
    !data?.patientProfiles?.length
  );
}

/** Equality that ignores record-array order, as Realtime Database object order is unspecified. */
export function syncLedgerDataEqual(
  left: Partial<SyncLedgerData> | null | undefined,
  right: Partial<SyncLedgerData> | null | undefined
): boolean {
  const a = canonicalSyncData(left);
  const b = canonicalSyncData(right);
  return stableStringify(a) === stableStringify(b);
}

function mergeRows<T>(
  first: T[],
  second: T[],
  getId: (row: T) => string,
  getVersion: (row: T) => number
): T[] {
  const merged = new Map<string, T>();
  for (const candidate of [...first, ...second]) {
    if (!candidate) continue;
    const id = getId(candidate);
    if (!id) continue;
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, candidate);
      continue;
    }

    const candidateVersion = Number(getVersion(candidate)) || 0;
    const existingVersion = Number(getVersion(existing)) || 0;
    if (
      candidateVersion > existingVersion ||
      (candidateVersion === existingVersion && stableStringify(candidate) > stableStringify(existing))
    ) {
      merged.set(id, candidate);
    }
  }
  return Array.from(merged.values());
}

function canonicalSyncData(data: Partial<SyncLedgerData> | null | undefined): SyncLedgerData {
  return {
    patientEntries: [...(data?.patientEntries ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    settlements: [...(data?.settlements ?? [])].sort((a, b) => a.settlementId.localeCompare(b.settlementId)),
    auditLogs: [...(data?.auditLogs ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    patientProfiles: [...(data?.patientProfiles ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
