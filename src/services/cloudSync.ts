/**
 * HISAPP — SIGN-IN CLOUD SYNC POLICY (PURE)
 * ─────────────────────────────────────────────────────────────────
 * Decides what happens to the local browser cache when a Google account
 * signs in. Google Drive is the source of truth: the freshly signed-in
 * account's Drive backup is pulled FIRST and takes priority over the local
 * cache, so a second Gmail account on a shared device never sees — or backs
 * up — the previous account's data.
 *
 * This module is pure (no I/O) so the whole policy is unit-testable.
 */

export type SignInSyncAction =
  /** Replace the local cache with the signing-in account's Drive backup. */
  | 'restore-cloud'
  /** Wipe the local cache: it belongs to a different account that has no cloud backup. */
  | 'clear-local'
  /** Keep the local cache (it is empty, or at least as new as the cloud copy). */
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
  /** Whether the signing-in account's Drive holds a backup with records. */
  cloudHasData: boolean;
  /** snapshotTimestamp of the newest Drive backup (0 when there is none). */
  cloudSnapshotAt: number;
  /** The device's last known cloud sync point (0 when it never synced). */
  lastSyncedAt: number;
}

export interface SignInSyncDecision {
  action: SignInSyncAction;
  /** True when the local cache is known to belong to a different account. */
  accountSwitched: boolean;
}

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

  // ── Same account (or a never-synced device): empty cache adopts cloud ──
  // New device / wiped browser: restore the user's most recent Drive backup
  // so no data is ever lost.
  if (!input.localHasData) {
    return {
      action: input.cloudHasData ? 'restore-cloud' : 'keep-local',
      accountSwitched: false,
    };
  }

  // ── Same account with local data: cloud wins only when strictly newer ──
  // The cloud copy wins when it is newer than what this device last synced
  // (e.g. another device of the same account backed up newer data). When the
  // local cache is at least as new — typically offline edits made while
  // signed out — the local cache wins and is pushed to Drive afterwards, so
  // no offline work is ever clobbered by an older cloud snapshot.
  const cloudIsNewer = input.cloudHasData && input.cloudSnapshotAt > input.lastSyncedAt;
  return {
    action: cloudIsNewer ? 'restore-cloud' : 'keep-local',
    accountSwitched: false,
  };
}
