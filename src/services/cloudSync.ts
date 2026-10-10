/**
 * HISAPP — CLOUD SYNC RULES (PURE)
 * ─────────────────────────────────────────────────────────────────
 * Pure, side-effect-free rules shared by the local IndexedDB layer and the
 * Realtime Database sync engine:
 *
 *   • record normalization — Realtime Database drops empty arrays and null
 *     fields, so every record read from the cloud is restored to the exact
 *     shape the app expects before it is compared or stored;
 *   • versions & fingerprints — each record has ONE deterministic winner rule
 *     (higher version, then larger fingerprint). Every device applies the same
 *     rule, so all devices converge on identical data without coordination;
 *   • merge — union of independent records, with audit-log tombstones deciding
 *     deletions. Nothing is ever dropped silently: a record disappears only
 *     when a deletion event for it is newer than its last edit.
 */

import type { AuditLogEntry, PatientEntry, PatientProfile, Settlement } from '../types';

/** Ledger data shared through the authenticated sync layer. */
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

/** The four synced record kinds (one cloud collection each). */
export type SyncKind = 'entry' | 'settlement' | 'profile' | 'audit';

const asArray = <T = unknown>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  // Realtime Database returns integer-keyed objects for sparse arrays.
  if (value && typeof value === 'object') return Object.values(value as Record<string, T>);
  return [];
};

const asNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const asText = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : value == null ? fallback : String(value);

/**
 * Restore a record read from the cloud to the shape the app stores locally.
 * Missing arrays become [], missing optional text becomes '' and missing
 * nullable references become null, so the same logical record always has the
 * same fingerprint on every device.
 */
export function normalizeRemoteRecord<T extends object>(kind: SyncKind, value: T): T {
  const row = { ...value } as Record<string, unknown>;
  switch (kind) {
    case 'entry':
      row.id = asText(row.id);
      row.serial = asNumber(row.serial);
      row.date = asText(row.date);
      row.patientName = asText(row.patientName);
      row.procedure = asText(row.procedure);
      row.receivedAmount = asNumber(row.receivedAmount);
      row.doctorShare = asNumber(row.doctorShare);
      row.settlementStatus = row.settlementStatus === 'Settled' ? 'Settled' : 'Pending';
      row.settlementId = row.settlementId == null || row.settlementId === '' ? null : asText(row.settlementId);
      row.remarks = asText(row.remarks);
      row.createdAt = asNumber(row.createdAt);
      row.updatedAt = asNumber(row.updatedAt);
      break;
    case 'settlement':
      row.settlementId = asText(row.settlementId);
      row.settlementDate = asText(row.settlementDate);
      row.periodFrom = asText(row.periodFrom);
      row.periodTo = asText(row.periodTo);
      row.patientCount = asNumber(row.patientCount);
      row.periodShare = asNumber(row.periodShare);
      row.previousDue = asNumber(row.previousDue);
      row.totalPayable = asNumber(row.totalPayable);
      row.amountReceived = asNumber(row.amountReceived);
      row.dueBalance = asNumber(row.dueBalance);
      row.remarks = asText(row.remarks);
      row.patientIds = asArray<string>(row.patientIds).map((id) => asText(id));
      row.createdAt = asNumber(row.createdAt);
      break;
    case 'profile':
      row.id = asText(row.id);
      row.name = asText(row.name);
      row.phone = asText(row.phone);
      row.notes = asText(row.notes);
      row.totalVisits = asNumber(row.totalVisits);
      row.totalBilled = asNumber(row.totalBilled);
      row.totalDoctorShare = asNumber(row.totalDoctorShare);
      row.firstVisitDate = asText(row.firstVisitDate);
      row.lastVisitDate = asText(row.lastVisitDate);
      row.procedures = asArray<string>(row.procedures).map((p) => asText(p));
      row.createdAt = asNumber(row.createdAt);
      row.updatedAt = asNumber(row.updatedAt);
      break;
    case 'audit':
      row.id = asText(row.id);
      row.timestamp = asNumber(row.timestamp);
      row.action = asText(row.action);
      row.targetId = asText(row.targetId);
      row.targetType = asText(row.targetType);
      row.details = asText(row.details);
      break;
  }
  return row as T;
}

/** Logical version used for last-write-wins between devices. */
export function recordVersion(kind: SyncKind, row: unknown): number {
  const r = (row ?? {}) as Record<string, unknown>;
  switch (kind) {
    case 'entry':
    case 'profile':
      return Math.max(asNumber(r.updatedAt), asNumber(r.createdAt));
    case 'settlement':
      return asNumber(r.createdAt);
    case 'audit':
      return asNumber(r.timestamp);
  }
}

/**
 * Stable content fingerprint. Missing, null and undefined fields are treated
 * alike so a locally stored record and its cloud copy compare as equal.
 */
export function recordFingerprint(value: unknown): string {
  return stableStringify(value);
}

/** True when `candidate` should replace `existing` under the shared winner rule. */
export function candidateWins(
  kind: SyncKind,
  candidate: unknown,
  existing: unknown
): boolean {
  const cv = recordVersion(kind, candidate);
  const ev = recordVersion(kind, existing);
  if (cv !== ev) return cv > ev;
  return recordFingerprint(candidate) > recordFingerprint(existing);
}

/**
 * Merge local and remote records without dropping independent device writes.
 * Entity IDs are stable across sync. Conflicts on the same ID use the newest
 * version; exact ties use a deterministic fingerprint comparison so every
 * device reaches the same result.
 *
 * Deletions travel as audit-log tombstones. A later save/undo can recreate a
 * record by carrying a newer version than its delete event.
 */
export function mergeSyncLedgerData(
  local: Partial<SyncLedgerData> | null | undefined,
  remote: Partial<SyncLedgerData> | null | undefined
): SyncLedgerData {
  const auditLogs = mergeRows(
    local?.auditLogs ?? [],
    remote?.auditLogs ?? [],
    (row) => row.id,
    (row) => recordVersion('audit', row)
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
    (row) => recordVersion('entry', row)
  )
    .filter((entry) => (deletedEntryAt.get(entry.id) ?? 0) < recordVersion('entry', entry))
    .sort((a, b) => a.date.localeCompare(b.date) || a.serial - b.serial || a.id.localeCompare(b.id));

  const settlements = mergeRows(
    local?.settlements ?? [],
    remote?.settlements ?? [],
    (row) => row.settlementId,
    (row) => recordVersion('settlement', row)
  )
    .filter((settlement) => (deletedSettlementAt.get(settlement.settlementId) ?? 0) < (settlement.createdAt || 0))
    .sort((a, b) => a.settlementDate.localeCompare(b.settlementDate) || a.createdAt - b.createdAt);

  const patientProfiles = mergeRows(
    local?.patientProfiles ?? [],
    remote?.patientProfiles ?? [],
    (profile) => profile.id,
    (profile) => recordVersion('profile', profile)
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
      (candidateVersion === existingVersion && recordFingerprint(candidate) > recordFingerprint(existing))
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
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item ?? null)).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object)
      .filter((key) => object[key] !== undefined && object[key] !== null)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
