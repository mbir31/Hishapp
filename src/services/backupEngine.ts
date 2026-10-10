/**
 * HISAPP — CLOUD BACKUP ENGINE
 * ─────────────────────────────────────────────────────────────────
 * Orchestrates the app's dual-backup strategy:
 *
 *   1. LOCAL (simultaneous): every entry/settlement write already goes
 *      straight into IndexedDB (durable browser database).
 *   2. CLOUD: after every local change the engine merges the ledger into the
 *      signed-in user's Firebase Realtime Database for live multi-device
 *      sync, then writes a debounced Google Drive recovery snapshot.
 *
 * SIGN-IN RECONCILIATION: legacy Drive snapshots are merged or restored on
 * sign-in, then the account-scoped Realtime Database becomes the live source.
 * A different Gmail account never receives another account's local records.
 *
 * UI subscribes to `status` to show live backup state.
 */
import {
  clearAllPatientData,
  mergeRemoteSyncData,
  getSettings,
  getSyncLedgerData,
  restoreAllData,
  saveSettings,
} from '../db/indexedDB';
import {
  ensureGoogleToken,
  getSilentGoogleToken,
  onAuthChanged,
  signInWithGoogle,
  signOutGoogle,
  type HisappUser,
} from './firebaseAuth';
import { isFirebaseConfigured } from '../config/firebase';
import {
  checkAndRunWeeklyAutoBackup,
  createDriveBackup,
  downloadLatestDriveBackup,
  type DriveBackupMeta,
  type DriveBackupPayload,
} from './driveBackup';
import { decideSignInSync, isSyncLedgerDataEmpty } from './cloudSync';
import { syncSheetsLedger } from './sheetsLedger';
import { signOutIdentityPatch } from './identity';
import { connectRealtimeSync, type RealtimeSyncSession } from './realtimeSync';

export type BackupPhase = 'not-configured' | 'signed-out' | 'idle' | 'syncing' | 'synced' | 'error';

export interface BackupStatus {
  phase: BackupPhase;
  isConfigured: boolean;
  isOnline: boolean;
  user: HisappUser | null;
  lastBackupAt: number | null;
  pendingChanges: boolean;
  error: string | null;
}

type Listener = (status: BackupStatus) => void;

const AUTO_BACKUP_DEBOUNCE_MS = 3500;

class BackupEngine {
  private listeners = new Set<Listener>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private backupInFlight: Promise<void> | null = null;
  private realtimeSession: RealtimeSyncSession | null = null;
  private realtimeStartPromise: Promise<void> | null = null;
  private realtimeUserUid: string | null = null;
  private realtimeError: string | null = null;
  private dataChangeVersion = 0;
  private pendingChanges = false;
  private user: HisappUser | null = null;
  private lastBackupAt: number | null = null;
  private error: string | null = null;
  private phase: BackupPhase = 'signed-out';
  private started = false;
  private onRestoredCb: (() => void) | null = null;
  private signedInFlow: Promise<void> | null = null;
  private onToastCb: ((title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void) | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────

  async start(hooks?: {
    onRestored?: () => void;
    onToast?: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  }): Promise<() => void> {
    if (hooks?.onRestored) this.onRestoredCb = hooks.onRestored;
    if (hooks?.onToast) this.onToastCb = hooks.onToast;

    this.recomputePhase();
    this.emit();

    const unsubscribeAuth = await onAuthChanged(async (user) => {
      const previousUser = this.user;
      this.user = user;
      if (user) {
        this.error = null;
        this.recomputePhase();
        this.emit();
        await this.handleSignedIn(previousUser);
      } else {
        this.realtimeSession?.close();
        this.realtimeSession = null;
        this.realtimeUserUid = null;
        this.realtimeError = null;
        // No account signed in (fresh load signed out, or the session ended):
        // scrub any residual account identity out of the local settings cache
        // so a previously signed-in Gmail photo is never shown again.
        await this.scrubResidualIdentity();
        this.recomputePhase();
        this.emit();
      }
    });

    // Retry pending backups when the device comes back online
    window.addEventListener('online', this.handleOnline);
    this.started = true;
    return () => {
      window.removeEventListener('online', this.handleOnline);
      unsubscribeAuth();
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      if (this.realtimeSyncTimer) clearTimeout(this.realtimeSyncTimer);
      this.realtimeSession?.close();
      this.realtimeSession = null;
      this.realtimeUserUid = null;
      this.started = false;
    };
  }

  private handleOnline = () => {
    if (this.user) {
      this.scheduleRealtimeSync(0);
      if (this.pendingChanges) this.scheduleAutoBackup(500);
    }
    this.emit();
  };

  /**
   * Removes any leftover account identity (photo / email / owner uid) from
   * the local settings database while NO account is signed in. Older builds
   * could leave a previously signed-in account's profile photo cached here,
   * which then kept showing in the header across refreshes. A Doctor Name the
   * doctor typed in Settings is intentionally kept — only account-owned
   * identity fields are cleared. The dataset-owner tag (dataOwnerUid) is
   * device bookkeeping and is left untouched.
   */
  private async scrubResidualIdentity(): Promise<void> {
    try {
      const settings = await getSettings();
      if (settings.doctorPhoto || settings.doctorEmail || settings.ownerUid) {
        await saveSettings({ doctorPhoto: '', doctorEmail: '', ownerUid: null });
        this.onRestoredCb?.(); // let the app refresh the profile UI
      }
    } catch (err) {
      console.warn('Could not scrub residual profile identity:', err);
    }
  }

  private async handleSignedIn(previousUser: HisappUser | null): Promise<void> {
    if (this.signedInFlow) {
      const ongoingFlow = this.signedInFlow;
      await ongoingFlow;
      if (this.signedInFlow === ongoingFlow) return;
      if (!this.realtimeSession && this.user && getSilentGoogleToken(this.user.uid)) {
        await this.handleSignedIn(this.user);
      }
      return;
    }

    const flow = this.performSignedIn(previousUser);
    this.signedInFlow = flow;
    try {
      await flow;
    } finally {
      if (this.signedInFlow === flow) this.signedInFlow = null;
    }
  }

  private async performSignedIn(previousUser: HisappUser | null): Promise<void> {
    const signingInUser = this.user;
    if (!signingInUser) return;
    if (this.backupInFlight) await this.backupInFlight.catch(() => {});
    if (this.user?.uid !== signingInUser.uid) return;

    try {
      // Personalize the clinic profile from the user's own Gmail account.
      // Hisapp ships with NO pre-filled doctor / account identity, so the
      // profile is only populated once somebody actually signs in (or if the
      // doctor name is still blank because it was never typed).
      const settings = await getSettings();
      const identityIsAutoFilled = !!settings.ownerUid || !!settings.doctorEmail;
      if (!identityIsAutoFilled && !settings.doctorName.trim()) {
        await saveSettings({
          doctorName: signingInUser.name,
          doctorEmail: signingInUser.email,
          doctorPhoto: signingInUser.photoURL || settings.doctorPhoto || '',
          ownerUid: signingInUser.uid,
        });
        this.onRestoredCb?.(); // let the app refresh settings UI
      } else if (settings.ownerUid && settings.ownerUid !== signingInUser.uid) {
        // A different Google account signed in on this device — follow it,
        // but never clobber a Doctor Name the doctor typed in Settings: that
        // field is what the header displays.
        await saveSettings({
          doctorName: settings.doctorName.trim() || signingInUser.name,
          doctorEmail: signingInUser.email,
          doctorPhoto: signingInUser.photoURL || '',
          ownerUid: signingInUser.uid,
        });
        this.onRestoredCb?.();
      }

      if (this.user?.uid !== signingInUser.uid) return;

      // Import a legacy Drive snapshot first. Live cross-device changes use
      // the authenticated Realtime Database listener started below; same-
      // account data is merged by record rather than replacing offline edits.
      let cloudSyncFailed = false;
      const token = getSilentGoogleToken(signingInUser.uid);
      if (token) {
        try {
          const latest = await downloadLatestDriveBackup(token);
          if (this.user?.uid !== signingInUser.uid) return;
          await this.reconcileCloudWithLocal(latest, previousUser);
        } catch (syncErr: any) {
          cloudSyncFailed = true;
          console.warn('Sign-in cloud sync notice:', syncErr);
          if (syncErr?.message !== 'SESSION_EXPIRED') {
            this.error = syncErr?.message || 'Cloud sync failed';
            this.recomputePhase();
            this.emit();
          }
        }
      }

      // Safety guard: never upload the local cache into a DIFFERENT account's
      // cloud path. If a switch cannot be verified against Drive, isolate the
      // prior account's local data before opening the new user's RTDB session.
      let [postSyncSettings, localSyncData] = await Promise.all([getSettings(), getSyncLedgerData()]);
      if (this.user?.uid !== signingInUser.uid) return;
      const cacheStillBelongsToPreviousAccount =
        !!postSyncSettings.dataOwnerUid && postSyncSettings.dataOwnerUid !== signingInUser.uid;
      const accountChangedThisSession = !!previousUser && previousUser.uid !== signingInUser.uid;
      const hasDriveToken = !!getSilentGoogleToken(signingInUser.uid);
      const unclaimedCacheFromPreviousSession =
        !postSyncSettings.dataOwnerUid &&
        accountChangedThisSession &&
        !isSyncLedgerDataEmpty(localSyncData);
      const accountSwitchWasNotVerified =
        (cacheStillBelongsToPreviousAccount || unclaimedCacheFromPreviousSession) &&
        (cloudSyncFailed || !hasDriveToken);

      if (accountSwitchWasNotVerified) {
        // Never leave the previous account's clinical data visible to the new
        // account when Drive cannot be checked. Its own cloud copy remains
        // untouched; the newly authenticated user's RTDB data is loaded next.
        if (!isSyncLedgerDataEmpty(localSyncData)) await clearAllPatientData();
        await saveSettings({ dataOwnerUid: signingInUser.uid, lastDriveSnapshotTimestamp: null });
        this.onRestoredCb?.();
        this.onToastCb?.(
          'Previous Account Data Isolated',
          'This device was switched to a different Gmail account. Previous records were hidden here and were not sent to the new account.',
          'warning'
        );
        [postSyncSettings, localSyncData] = await Promise.all([getSettings(), getSyncLedgerData()]);
      }

      const localDatasetIsUnclaimed =
        !postSyncSettings.dataOwnerUid && !isSyncLedgerDataEmpty(localSyncData);
      if (localDatasetIsUnclaimed && (cloudSyncFailed || !hasDriveToken)) {
        this.onToastCb?.(
          'Account Sync Needs Verification',
          'Local records were not sent to the cloud. Reconnect Google Drive from Settings before syncing this unclaimed data.',
          'warning'
        );
        return;
      }

      // A brand-new, empty cache is safe to associate even if the user has not
      // authorized the Drive archive yet. Never claim an untagged non-empty
      // cache until the Drive account reconciliation above has succeeded.
      if (!postSyncSettings.dataOwnerUid && isSyncLedgerDataEmpty(localSyncData)) {
        await saveSettings({ dataOwnerUid: signingInUser.uid });
      }

      // Realtime Database is the live source for same-account devices. The
      // initial snapshot is merged with local records before we schedule any
      // Drive safety snapshot, preventing stale devices from replacing newer
      // entries.
      await this.startRealtimeSync(signingInUser.uid);

      // Weekly safety snapshot (runs at most once every 7 days)
      const freshToken = getSilentGoogleToken(signingInUser.uid);
      if (freshToken) {
        const didRun = await checkAndRunWeeklyAutoBackup(freshToken);
        if (didRun) {
          try {
            await syncSheetsLedger(freshToken);
          } catch (ledgerErr) {
            console.warn('Weekly ledger sync notice:', ledgerErr);
          }
          await this.syncLastBackupTime();
          this.onToastCb?.(
            'Weekly Backup Saved',
            'A safety snapshot was archived to Hisapp_Backups on Google Drive.',
            'info'
          );
        }
      }

      // Anything changed while signed out? Push it now.
      if (this.pendingChanges) {
        this.scheduleAutoBackup(1000);
      }
    } catch (err: any) {
      console.warn('Post sign-in backup check notice:', err);
      if (err?.message !== 'SESSION_EXPIRED') {
        this.error = err?.message || 'Cloud backup check failed';
      }
      this.recomputePhase();
      this.emit();
    }
  }

  private async startRealtimeSync(userUid: string): Promise<void> {
    if (this.realtimeSession && this.realtimeUserUid === userUid) return;
    if (this.realtimeStartPromise) {
      await this.realtimeStartPromise;
      if (this.realtimeSession && this.realtimeUserUid === userUid) return;
    }

    const startup = this.openRealtimeSync(userUid);
    this.realtimeStartPromise = startup;
    try {
      await startup;
    } finally {
      if (this.realtimeStartPromise === startup) this.realtimeStartPromise = null;
    }
  }

  private async openRealtimeSync(userUid: string): Promise<void> {
    if (this.realtimeSession && this.realtimeUserUid === userUid) return;

    this.realtimeSession?.close();
    this.realtimeSession = null;
    this.realtimeUserUid = null;

    try {
      const session = await connectRealtimeSync(userUid, {
        onRemoteData: () => {
          this.onRestoredCb?.();
          this.dataChangeVersion += 1;
          this.pendingChanges = true;
          if (this.user?.uid === userUid) this.scheduleAutoBackup();
          this.emit();
        },
        onSynced: () => {
          this.realtimeError = null;
          this.recomputePhase();
          this.emit();
        },
        onError: (error) => {
          this.realtimeError = error.message || 'Realtime cloud sync failed';
          this.recomputePhase();
          this.emit();
          console.warn('Realtime cloud sync notice:', error);
        },
      });

      // Auth could have changed while the initial database snapshot was loading.
      if (this.user?.uid !== userUid) {
        session.close();
        return;
      }
      this.realtimeSession = session;
      this.realtimeUserUid = userUid;
      this.realtimeError = null;
      this.recomputePhase();
      this.emit();
    } catch (error: any) {
      this.realtimeError = error?.message || 'Realtime cloud sync failed';
      this.recomputePhase();
      this.emit();
      console.warn('Could not start Realtime Database sync:', error);
    }
  }

  private async ensureSafeDatasetOwner(): Promise<boolean> {
    const user = this.user;
    if (!user) return false;

    try {
      const settings = await getSettings();
      if (this.user?.uid !== user.uid) return false;
      if (settings.dataOwnerUid === user.uid) return true;

      const localData = await getSyncLedgerData();
      if (this.user?.uid !== user.uid) return false;
      if (!settings.dataOwnerUid && isSyncLedgerDataEmpty(localData)) {
        await saveSettings({ dataOwnerUid: user.uid });
        return this.user?.uid === user.uid;
      }

      this.realtimeError =
        'Local records are not verified for this Google account. Reconnect Google Drive from Settings before syncing.';
      this.recomputePhase();
      this.emit();
      return false;
    } catch (error: any) {
      this.realtimeError = error?.message || 'Could not verify the local dataset owner.';
      this.recomputePhase();
      this.emit();
      return false;
    }
  }

  private async syncRealtimeNow(): Promise<boolean> {
    if (!this.user || !(await this.ensureSafeDatasetOwner())) return false;
    if (!this.realtimeSession || this.realtimeUserUid !== this.user.uid) {
      await this.startRealtimeSync(this.user.uid);
    }
    if (!this.realtimeSession) return false;

    try {
      await this.realtimeSession.syncNow();
      this.realtimeError = null;
      this.recomputePhase();
      this.emit();
      return true;
    } catch (error: any) {
      this.realtimeError = error?.message || 'Realtime cloud sync failed';
      this.recomputePhase();
      this.emit();
      console.warn('Realtime cloud sync failed:', error);
      return false;
    }
  }

  /**
   * Reconcile a legacy Google Drive snapshot with the local browser cache.
   * The account-switch policy isolates data; same-account records are merged
   * before the realtime database becomes the live source of truth.
   *
   *   • account switch  → replace or clear the cache to preserve account
   *                       isolation;
   *   • empty cache     → restore the Drive snapshot on a new device;
   *   • known owner     → merge same-account records and retain offline edits;
   *   • unclaimed cache → keep the existing privacy-first cloud precedence.
   */
  private async reconcileCloudWithLocal(
    latest: { meta: DriveBackupMeta; payload: DriveBackupPayload } | null,
    previousUser: HisappUser | null
  ): Promise<void> {
    const user = this.user;
    if (!user) return;

    const settings = await getSettings();
    const localWasEmpty = isSyncLedgerDataEmpty(await getSyncLedgerData());
    const cloudHasData =
      !!latest &&
      !isSyncLedgerDataEmpty({
        patientEntries: latest.payload.patientEntries ?? [],
        settlements: latest.payload.settlements ?? [],
        auditLogs: latest.payload.auditLogs ?? [],
        patientProfiles: latest.payload.patientProfiles ?? [],
      });
    const cloudSnapshotAt = latest?.payload.snapshotTimestamp ?? 0;

    const decision = decideSignInSync({
      userUid: user.uid,
      previousUserUid: previousUser?.uid ?? null,
      dataOwnerUid: settings.dataOwnerUid ?? null,
      localHasData: !localWasEmpty,
      cloudHasData,
      cloudSnapshotAt,
      lastSyncedAt: settings.lastDriveSnapshotTimestamp ?? 0,
    });

    if (decision.action === 'restore-cloud' && latest) {
      // Cloud wins: replace the local cache with the account's Drive backup.
      await restoreAllData(latest.payload);
      // The local cache now mirrors this account's cloud snapshot — tag the
      // dataset owner and sync point so the NEXT sign-in compares correctly.
      await saveSettings({
        dataOwnerUid: user.uid,
        lastDriveSnapshotTimestamp: cloudSnapshotAt || null,
      });
      this.onRestoredCb?.();
      if (decision.accountSwitched) {
        this.onToastCb?.(
          'Synced from Google Drive',
          `Loaded "${latest.meta.name}" — this device now shows ${user.email}'s records.`,
          'success'
        );
      } else if (localWasEmpty) {
        this.onToastCb?.(
          'Data Restored from Google Drive',
          `Loaded "${latest.meta.name}" — your records are back.`,
          'success'
        );
      } else {
        this.onToastCb?.(
          'Synced from Google Drive',
          `Loaded "${latest.meta.name}" — newer cloud data replaced this device's cache.`,
          'info'
        );
      }
      return;
    }

    if (decision.action === 'merge-cloud' && latest) {
      const changed = await mergeRemoteSyncData({
        patientEntries: latest.payload.patientEntries ?? [],
        settlements: latest.payload.settlements ?? [],
        auditLogs: latest.payload.auditLogs ?? [],
        patientProfiles: latest.payload.patientProfiles ?? [],
      });
      await saveSettings({
        dataOwnerUid: user.uid,
        lastDriveSnapshotTimestamp: cloudSnapshotAt || null,
      });
      if (changed) this.onRestoredCb?.();
      this.onToastCb?.(
        'Cloud Records Merged',
        `Merged ${latest.payload.patientEntries?.length ?? 0} visits from "${latest.meta.name}" without removing offline records.`,
        'success'
      );
      return;
    }

    if (decision.action === 'clear-local') {
      // A different account signed in and has no Drive backup of its own:
      // the local cache belongs to the previous account — remove it from
      // this device. It remains backed up in that account's own Google Drive
      // and returns when that account signs in again.
      await clearAllPatientData();
      await saveSettings({ dataOwnerUid: user.uid, lastDriveSnapshotTimestamp: null });
      this.onRestoredCb?.();
      this.onToastCb?.(
        'Previous Account Data Cleared',
        'This device held records from another Google account. They were removed here and remain backed up in that account’s Google Drive.',
        'warning'
      );
      return;
    }

    // keep-local: the cache is empty, or at least as new as the cloud copy
    // (offline edits made while signed out are pushed right after sign-in).
    // Claim the dataset for this account so a later sign-in by a DIFFERENT
    // account is detected as an account switch.
    await saveSettings({ dataOwnerUid: user.uid });
  }

  // ── Status ───────────────────────────────────────────────────────

  getStatus(): BackupStatus {
    return {
      phase: this.phase,
      isConfigured: this.isConfigured(),
      isOnline: navigator.onLine,
      user: this.user,
      lastBackupAt: this.lastBackupAt,
      pendingChanges: this.pendingChanges,
      error: this.error || this.realtimeError,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  private isConfigured(): boolean {
    return isFirebaseConfigured();
  }

  private recomputePhase(): void {
    if (!this.isConfigured()) {
      this.phase = 'not-configured';
    } else if (!this.user) {
      this.phase = 'signed-out';
    } else if (this.backupInFlight) {
      this.phase = 'syncing';
    } else if (this.error || this.realtimeError) {
      this.phase = 'error';
    } else {
      this.phase = 'idle';
    }
  }

  private emit(): void {
    const status = this.getStatus();
    this.listeners.forEach((listener) => listener(status));
  }

  private async syncLastBackupTime(): Promise<void> {
    const settings = await getSettings();
    this.lastBackupAt = settings.lastDriveSnapshotTimestamp ?? null;
  }

  // ── Backup operations ────────────────────────────────────────────

  /**
   * Call AFTER every local (IndexedDB) write. The write itself is the
   * simultaneous local backup; this schedules the cloud counterpart.
   */
  onDataChanged(): void {
    if (!this.started) return;
    this.dataChangeVersion += 1;
    this.pendingChanges = true;
    this.emit();
    if (this.user && this.isConfigured()) {
      this.scheduleRealtimeSync();
      this.scheduleAutoBackup();
    }
  }

  private scheduleRealtimeSync(delay = 250): void {
    if (this.realtimeSyncTimer) clearTimeout(this.realtimeSyncTimer);
    this.realtimeSyncTimer = setTimeout(() => {
      this.realtimeSyncTimer = null;
      void this.syncRealtimeNow();
    }, delay);
  }

  private scheduleAutoBackup(delay = AUTO_BACKUP_DEBOUNCE_MS): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runBackup('auto');
    }, delay);
  }

  /** Manual "Backup Now" — safe to call from a click handler. */
  async backupNow(): Promise<DriveBackupOk | null> {
    if (!this.isConfigured()) {
      this.onToastCb?.(
        'Firebase Not Configured',
        'Paste your Firebase web config in src/config/firebase.ts to enable cloud backup.',
        'warning'
      );
      return null;
    }
    if (!this.user) {
      this.onToastCb?.(
        'Sign-In Required',
        'Sign in from Settings before syncing this device with your cloud account.',
        'warning'
      );
      return null;
    }
    return (await this.runBackup('manual')) as DriveBackupOk | null;
  }

  async signIn(): Promise<HisappUser | null> {
    try {
      const { user } = await signInWithGoogle();
      // Firebase may notify listeners just before the Google Drive token is
      // cached. Re-run (or wait for) the account flow now that the token exists.
      if (this.user?.uid === user.uid) {
        this.error = null;
        await this.handleSignedIn(this.user);
        if (this.pendingChanges) this.scheduleAutoBackup(500);
        this.recomputePhase();
        this.emit();
      }
      return user;
    } catch (err: any) {
      this.error = err?.message || 'Sign-in failed';
      this.recomputePhase();
      this.emit();
      this.onToastCb?.('Sign-In Failed', this.error ?? undefined, 'error');
      return null;
    }
  }

  async signOut(): Promise<void> {
    // Remove the Google identity that was auto-filled at sign-in so the app
    // falls back to "clinic only, no account" (clinic name + logo are kept).
    let clearedIdentity = false;
    try {
      const settings = await getSettings();
      const identityPatch = signOutIdentityPatch(settings, this.user);
      if (identityPatch) {
        // A Doctor Name the doctor typed after sign-in survives sign-out.
        await saveSettings(identityPatch);
        clearedIdentity = true;
      }
    } catch (err) {
      console.warn('Could not clear profile identity on sign-out:', err);
    }

    // Tag the local dataset with the departing account. The data itself
    // stays safely on the device, but a later sign-in by a DIFFERENT Gmail
    // account must be detected as an account switch — that account's own
    // Drive backup then takes priority over this cache (see cloudSync.ts).
    if (this.user) {
      try {
        await saveSettings({ dataOwnerUid: this.user.uid });
      } catch (err) {
        console.warn('Could not tag the local dataset owner on sign-out:', err);
      }
    }

    // Flush the live ledger before ending the Firebase auth session.
    await this.syncRealtimeNow();
    this.realtimeSession?.close();
    this.realtimeSession = null;
    this.realtimeUserUid = null;
    if (this.realtimeSyncTimer) clearTimeout(this.realtimeSyncTimer);
    this.realtimeSyncTimer = null;

    await signOutGoogle();
    this.pendingChanges = false;
    this.error = null;
    this.recomputePhase();
    this.emit();
    if (clearedIdentity) this.onRestoredCb?.();
  }

  private async runBackup(trigger: 'auto' | 'manual'): Promise<DriveBackupOk | null> {
    if (this.backupInFlight) {
      await this.backupInFlight.catch(() => {});
    }
    if (trigger === 'manual' && this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.lastResult = null;
    const runUser = this.user;
    if (!runUser) return null;
    if (!navigator.onLine) {
      this.onToastCb?.(
        'Device Offline',
        trigger === 'manual'
          ? 'Reconnect to the internet to back up. Local data is saved safely on this device.'
          : undefined,
        trigger === 'manual' ? 'warning' : undefined
      );
      return null;
    }

    if (!(await this.ensureSafeDatasetOwner()) || this.user?.uid !== runUser.uid) {
      this.error = this.realtimeError || 'Local data is not verified for this account.';
      if (trigger === 'manual') {
        this.onToastCb?.('Account Sync Needs Verification', this.error, 'warning');
      }
      this.recomputePhase();
      this.emit();
      return null;
    }

    this.error = null;
    this.recomputePhase();
    this.emit();

    this.backupInFlight = (async () => {
      try {
        // Realtime sync is independent of the Drive OAuth access token and is
        // always attempted first, so a one-tap sync never opens a sign-in popup.
        const realtimeSynced = await this.syncRealtimeNow();
        if (this.user?.uid !== runUser.uid) return;
        const token = getSilentGoogleToken(runUser.uid);
        if (!token) {
          this.error = 'Google Drive access expired — reconnect Drive from Settings to create a backup.';
          if (trigger === 'manual') {
            this.onToastCb?.(
              realtimeSynced ? 'Records Synced Across Devices' : 'Drive Reconnection Needed',
              realtimeSynced
                ? 'Live cloud sync completed. Reconnect Google Drive in Settings to refresh the backup archive.'
                : 'The Drive backup token has expired. Reconnect Google Drive from Settings to sync this device.',
              'warning'
            );
          }
          this.recomputePhase();
          this.emit();
          return;
        }

        if (this.user?.uid !== runUser.uid || !(await this.ensureSafeDatasetOwner())) {
          this.error = this.realtimeError || 'Local data is not verified for this account.';
          this.recomputePhase();
          this.emit();
          return;
        }
        if (this.user?.uid !== runUser.uid) return;

        const snapshotVersion = this.dataChangeVersion;
        const result = await createDriveBackup(token);
        // The JSON snapshot remains the restore source; ledger errors are non-fatal.
        let ledgerNote = '';
        try {
          const ledger = await syncSheetsLedger(token);
          ledgerNote = ` and Hisapp_Ledger updated (${ledger.entries} visits)`;
        } catch (ledgerErr: any) {
          console.warn('Ledger sheet sync notice:', ledgerErr);
          if (trigger === 'manual') {
            this.onToastCb?.(
              'Sheet Sync Issue',
              ledgerErr?.message?.startsWith('SHEETS_API_DISABLED')
                ? 'Enable the Google Sheets API on the Firebase project to use Hisapp_Ledger. JSON backups are unaffected.'
                : `Backup saved, but the ledger sheet could not update: ${ledgerErr?.message || 'unknown error'}`,
              'warning'
            );
          }
        }
        if (this.dataChangeVersion === snapshotVersion) {
          this.pendingChanges = false;
          if (this.debounceTimer) clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        } else {
          // A local or remote record changed while the Drive snapshot was
          // uploading; leave it queued and write a fresh snapshot afterwards.
          this.pendingChanges = true;
          if (!this.debounceTimer) this.scheduleAutoBackup(1000);
        }
        await this.syncLastBackupTime();
        this.recomputePhase();
        this.emit();

        if (trigger === 'manual') {
          this.onToastCb?.(
            'Backed Up to Google Drive!',
            `Saved "${result.fileName}" (${result.totalEntries} visits, ${result.totalSettlements} settlements) to ${result.folderName}/${ledgerNote}.`,
            'success'
          );
        }
        this.lastResult = result;
      } catch (err: any) {
        if (err?.message === 'SESSION_EXPIRED') {
          // A sync tap must never interrupt with a Google popup. Reconnection
          // is an explicit action in Settings; Realtime Database may still have
          // synchronized records successfully in the meantime.
          this.error = 'Google Drive access expired — reconnect Drive from Settings.';
          if (trigger === 'manual') {
            this.onToastCb?.('Drive Reconnection Needed', this.error, 'warning');
          }
        } else {
          this.error = err?.message || 'Backup failed';
          if (trigger === 'manual') {
            this.onToastCb?.('Backup Failed', this.error ?? undefined, 'error');
          } else {
            console.warn('Auto backup failed:', err);
          }
        }
        this.recomputePhase();
        this.emit();
      } finally {
        this.backupInFlight = null;
        this.recomputePhase();
        this.emit();
      }
    })();

    return this.backupInFlight.then(() => this.lastResult ?? null);
  }

  private lastResult: import('./driveBackup').DriveBackupResult | null = null;

  // ── Restore ──────────────────────────────────────────────────────

  /** Manual restore: pulls the newest Drive backup over local data. */
  async restoreLatest(): Promise<{ fileName: string; entries: number } | null> {
    if (!this.isConfigured() || !this.user) {
      this.onToastCb?.('Not Signed In', 'Sign in with your Gmail account first.', 'warning');
      return null;
    }
    const user = this.user;
    try {
      if (this.backupInFlight) await this.backupInFlight.catch(() => {});
      if (this.user?.uid !== user.uid) return null;
      let token = getSilentGoogleToken(user.uid);
      if (!token) token = await ensureGoogleToken(user.uid);
      const latest = await downloadLatestDriveBackup(token);
      if (this.user?.uid !== user.uid) return null;
      if (!latest) {
        this.onToastCb?.(
          'No Backups Found',
          'Your Hisapp_Backups folder on Google Drive is empty.',
          'info'
        );
        return null;
      }
      await restoreAllData(latest.payload);
      // The local cache now mirrors the signed-in account's cloud backup.
      await saveSettings({ dataOwnerUid: user.uid });
      await this.syncLastBackupTime();
      await this.syncRealtimeNow();
      this.onRestoredCb?.();
      this.onToastCb?.(
        'Restored from Google Drive',
        `Loaded "${latest.meta.name}" — ${latest.payload.patientEntries?.length ?? 0} visits, ${latest.payload.settlements?.length ?? 0} settlements.`,
        'success'
      );
      return { fileName: latest.meta.name, entries: latest.payload.patientEntries?.length ?? 0 };
    } catch (err: any) {
      const message =
        err?.message === 'SESSION_EXPIRED'
          ? 'Google session expired — please tap Backup Now / Sign In again.'
          : err?.message || 'Restore failed';
      this.onToastCb?.('Restore Failed', message, 'error');
      return null;
    }
  }
}

interface DriveBackupOk {
  fileName: string;
}

/** App-wide singleton */
export const backupEngine = new BackupEngine();
