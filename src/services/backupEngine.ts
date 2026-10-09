/**
 * HISAPP — CLOUD BACKUP ENGINE
 * ─────────────────────────────────────────────────────────────────
 * Orchestrates the app's dual-backup strategy:
 *
 *   1. LOCAL (simultaneous): every entry/settlement write already goes
 *      straight into IndexedDB (durable browser database).
 *   2. CLOUD: after every local change this engine schedules a debounced
 *      Google Drive backup to the signed-in user's OWN Drive, plus a
 *      weekly safety snapshot.
 *
 * SIGN-IN IS CLOUD-FIRST: whenever an account signs in, its latest Google
 * Drive backup is pulled and takes priority over this device's local cache
 * (see cloudSync.ts). A different Gmail account signing in on the same
 * device therefore gets ITS OWN cloud data — the previous account's cached
 * records are never shown to it nor backed up into it.
 *
 * UI subscribes to `status` to show live backup state.
 */
import {
  clearAllPatientData,
  getAllPatientEntries,
  getAllSettlements,
  getSettings,
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
import { decideSignInSync } from './cloudSync';
import { syncSheetsLedger } from './sheetsLedger';
import { signOutIdentityPatch } from './identity';

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
  private backupInFlight: Promise<void> | null = null;
  private pendingChanges = false;
  private user: HisappUser | null = null;
  private lastBackupAt: number | null = null;
  private error: string | null = null;
  private phase: BackupPhase = 'signed-out';
  private started = false;
  private onRestoredCb: (() => void) | null = null;
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
      this.started = false;
    };
  }

  private handleOnline = () => {
    if (this.pendingChanges && this.user) {
      this.scheduleAutoBackup(500);
    }
    this.emit();
  };

  private async handleSignedIn(previousUser: HisappUser | null): Promise<void> {
    try {
      // Personalize the clinic profile from the user's own Gmail account.
      // Hisapp ships with NO pre-filled doctor / account identity, so the
      // profile is only populated once somebody actually signs in (or if the
      // doctor name is still blank because it was never typed).
      const settings = await getSettings();
      const identityIsAutoFilled = !!settings.ownerUid || !!settings.doctorEmail;
      if (!identityIsAutoFilled && !settings.doctorName.trim()) {
        await saveSettings({
          doctorName: this.user!.name,
          doctorEmail: this.user!.email,
          doctorPhoto: this.user!.photoURL || settings.doctorPhoto || '',
          ownerUid: this.user!.uid,
        });
        this.onRestoredCb?.(); // let the app refresh settings UI
      } else if (settings.ownerUid && settings.ownerUid !== this.user!.uid) {
        // A different Google account signed in on this device — follow it,
        // but never clobber a Doctor Name the doctor typed in Settings: that
        // field is what the header displays.
        await saveSettings({
          doctorName: settings.doctorName.trim() || this.user!.name,
          doctorEmail: this.user!.email,
          doctorPhoto: this.user!.photoURL || '',
          ownerUid: this.user!.uid,
        });
        this.onRestoredCb?.();
      }

      // ── Cloud-first sync: the signing-in account's Google Drive backup
      // takes priority over this device's local browser cache ────────────
      // The latest backup is pulled FIRST and reconciled with the local
      // cache (see reconcileCloudWithLocal). When a different Gmail account
      // signs in on this device (logout → login as another account), its own
      // Drive backup replaces the previous account's cached records — the
      // local cache never rules over the cloud backup.
      let cloudSyncFailed = false;
      const token = getSilentGoogleToken();
      if (token) {
        try {
          const latest = await downloadLatestDriveBackup(token);
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
      // Drive. If an account switch was detected but the cloud sync could not
      // finish, the cache still holds the previous account's records — hold
      // the weekly/pending pushes until the next successful sync.
      const postSyncSettings = await getSettings();
      const cacheStillBelongsToPreviousAccount =
        !!postSyncSettings.dataOwnerUid && postSyncSettings.dataOwnerUid !== this.user!.uid;
      const switchSyncIncomplete =
        cloudSyncFailed &&
        ((!!previousUser && previousUser.uid !== this.user!.uid) || cacheStillBelongsToPreviousAccount);
      if (switchSyncIncomplete) {
        this.onToastCb?.(
          'Cloud Sync Unavailable',
          'Could not reach Google Drive to sync this account. Local data was left untouched — it will sync on the next sign-in.',
          'warning'
        );
        return;
      }

      // Weekly safety snapshot (runs at most once every 7 days)
      const freshToken = getSilentGoogleToken();
      if (freshToken) {
        const didRun = await checkAndRunWeeklyAutoBackup(freshToken);
        if (didRun) {
          try {
            await syncSheetsLedger(freshToken);
          } catch (ledgerErr) {
            console.warn('Weekly ledger sync notice:', ledgerErr);
          }
          this.syncLastBackupTime();
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

  /**
   * Cloud-first reconciliation at sign-in. The latest Drive backup of the
   * account that just signed in is passed in; the sync policy (cloudSync.ts)
   * decides how it interacts with this device's local cache:
   *
   *   • account switch  → the new account's cloud backup replaces the cache
   *                       (or the cache is cleared when it has no backups);
   *   • empty cache     → the cloud backup is restored (new device);
   *   • newer cloud     → the cloud backup wins (another device synced);
   *   • otherwise       → the local cache wins so offline edits made while
   *                       signed out survive and are pushed right after.
   */
  private async reconcileCloudWithLocal(
    latest: { meta: DriveBackupMeta; payload: DriveBackupPayload } | null,
    previousUser: HisappUser | null
  ): Promise<void> {
    const user = this.user;
    if (!user) return;

    const settings = await getSettings();
    const entries = await getAllPatientEntries();
    const settlements = await getAllSettlements();
    const localWasEmpty = entries.length === 0 && settlements.length === 0;
    const cloudHasData =
      !!latest && !!(latest.payload.patientEntries?.length || latest.payload.settlements?.length);
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
      error: this.error,
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
    } else if (this.error) {
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
    this.pendingChanges = true;
    this.emit();
    if (this.user && this.isConfigured()) {
      this.scheduleAutoBackup();
    }
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
    return (await this.runBackup('manual')) as DriveBackupOk | null;
  }

  async signIn(): Promise<HisappUser | null> {
    try {
      const { user } = await signInWithGoogle();
      // onAuthChanged will fire and drive the rest of the flow
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
    if (!this.user) return null;
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

    this.error = null;
    this.recomputePhase();
    this.emit();

    this.backupInFlight = (async () => {
      try {
        let token = getSilentGoogleToken();
        if (!token) {
          if (trigger === 'auto') {
            // Never open a popup on its own for auto backups; wait for manual.
            this.recomputePhase();
            this.emit();
            return;
          }
          token = await ensureGoogleToken();
        }

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
        this.pendingChanges = false;
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
          // Ask for a fresh token silently-next-time; manual retry will popup.
          this.error = 'Google session expired — tap Backup Now to reconnect.';
          if (trigger === 'manual') {
            try {
              const freshToken = await ensureGoogleToken();
              const result = await createDriveBackup(freshToken);
              let ledgerUpdated = false;
              try {
                await syncSheetsLedger(freshToken);
                ledgerUpdated = true;
              } catch (ledgerErr) {
                console.warn('Ledger sheet sync notice:', ledgerErr);
              }
              this.pendingChanges = false;
              await this.syncLastBackupTime();
              this.error = null;
              this.lastResult = result;
              this.onToastCb?.(
                'Backed Up to Google Drive!',
                `Saved "${result.fileName}" to ${result.folderName}/${ledgerUpdated ? ' and updated Hisapp_Ledger' : ''}.`,
                'success'
              );
            } catch (retryErr: any) {
              this.error = retryErr?.message || 'Backup failed';
            }
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
      let token = getSilentGoogleToken();
      if (!token) token = await ensureGoogleToken();
      const latest = await downloadLatestDriveBackup(token);
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
