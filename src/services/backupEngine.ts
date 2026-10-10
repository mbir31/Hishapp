/**
 * HISAPP — BACKUP & SYNC ENGINE
 * ─────────────────────────────────────────────────────────────────
 * Every local write is durable at once and is protected in two places:
 *
 *   1. THIS DEVICE — each save commits the record AND its "still needs to reach
 *      the cloud" marker in one IndexedDB transaction (see db/indexedDB.ts).
 *   2. THE CLOUD — when online the outbox is pushed immediately (within
 *      milliseconds of a save) to the account's Realtime Database, where other
 *      devices on the same account receive it right away. The Google Drive
 *      "latest" file is refreshed about one second after the last change
 *      (at most eight seconds apart), and weekly / manual archives are kept.
 *
 * Accounts: each signed-in Google account has its own local ledger. Signing in
 * activates that account's ledger; signing out or switching accounts never
 * deletes local data, so no account's records can appear in another's ledger.
 *
 * Drive access uses a token that is renewed silently in the background. The
 * user is asked to reconnect only when Google requires an explicit approval.
 * Realtime sync does not depend on Drive.
 */
import {
  activateLedgerOwner,
  currentLedgerOwner,
  getSettings,
  restoreAllData,
  saveSettings,
} from '../db/indexedDB';
import {
  ensureGoogleToken,
  getSilentGoogleToken,
  isSilentDriveRenewalConfigured,
  onAuthChanged,
  refreshDriveTokenSilently,
  signInWithGoogle,
  signOutGoogle,
  type HisappUser,
} from './firebaseAuth';
import { isFirebaseConfigured } from '../config/firebase';
import {
  checkAndRunWeeklyAutoBackup,
  createDriveBackup,
  downloadLatestDriveBackup,
  syncDriveLatest,
  type DriveBackupResult,
} from './driveBackup';
import { syncSheetsLedger } from './sheetsLedger';
import { signOutIdentityPatch } from './identity';
import { connectRealtimeSync, type RealtimeSyncSession } from './realtimeSync';

export type BackupPhase = 'not-configured' | 'signed-out' | 'idle' | 'syncing' | 'synced' | 'error';

export interface BackupStatus {
  phase: BackupPhase;
  isConfigured: boolean;
  isOnline: boolean;
  user: HisappUser | null;
  /** Last successful cloud write (Drive latest or archive), epoch ms. */
  lastBackupAt: number | null;
  /** Local changes not yet confirmed by the cloud (realtime outbox or Drive refresh). */
  pendingChanges: boolean;
  /** Number of records still waiting in the realtime outbox. */
  pendingCount: number;
  /** Google Drive needs one tap on "Reconnect Google Drive" (Google requires approval). */
  driveNeedsReconnect: boolean;
  error: string | null;
}

type Listener = (status: BackupStatus) => void;
type ToastType = 'success' | 'info' | 'warning' | 'error';

const DRIVE_DEBOUNCE_MS = 1000;
const DRIVE_MAX_WAIT_MS = 8000;
const DRIVE_RETRY_MS = 30_000;
const TOKEN_CHECK_MS = 5 * 60 * 1000;
const SIGN_OUT_FLUSH_TIMEOUT_MS = 8000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);

class BackupEngine {
  private listeners = new Set<Listener>();
  private started = false;
  private user: HisappUser | null = null;

  // Realtime session (one per active account)
  private session: RealtimeSyncSession | null = null;
  private sessionOwner: string | null = null;
  private sessionOpening: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCount = 0;
  private realtimeError: string | null = null;

  // Drive
  private driveTimer: ReturnType<typeof setTimeout> | null = null;
  private driveFirstPendingAt: number | null = null;
  private drivePending = false;
  private driveInFlight: Promise<void> | null = null;
  private driveNeedsReconnectFlag = false;
  private driveError: string | null = null;
  private lastBackupAt: number | null = null;

  private dataChangeVersion = 0;
  private error: string | null = null;
  private phase: BackupPhase = 'signed-out';
  private signedInFlow: Promise<void> | null = null;
  private tokenTimer: ReturnType<typeof setInterval> | null = null;
  private onRestoredCb: (() => void) | null = null;
  private onToastCb: ((title: string, desc?: string, type?: ToastType) => void) | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────

  async start(hooks?: {
    onRestored?: () => void;
    onToast?: (title: string, desc?: string, type?: ToastType) => void;
  }): Promise<() => void> {
    if (hooks?.onRestored) this.onRestoredCb = hooks.onRestored;
    if (hooks?.onToast) this.onToastCb = hooks.onToast;

    this.recomputePhase();
    this.emit();

    const unsubscribeAuth = await onAuthChanged(async (user) => {
      this.user = user;
      if (user) {
        this.error = null;
        this.recomputePhase();
        this.emit();
        await this.handleSignedIn();
      } else {
        this.closeSession();
        this.cancelDriveTimer();
        this.drivePending = false;
        this.driveNeedsReconnectFlag = false;
        // No account signed in: remove residual account identity from settings.
        // Local records stay on the device under their owner's ledger.
        await this.scrubResidualIdentity();
        this.recomputePhase();
        this.emit();
      }
    });

    window.addEventListener('online', this.handleOnline);
    window.addEventListener('visibilitychange', this.handleVisibility);
    this.tokenTimer = setInterval(() => void this.ensureDriveFresh(), TOKEN_CHECK_MS);
    this.started = true;

    return () => {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('visibilitychange', this.handleVisibility);
      if (this.tokenTimer) clearInterval(this.tokenTimer);
      this.tokenTimer = null;
      unsubscribeAuth();
      this.cancelDriveTimer();
      this.cancelFlushTimer();
      this.closeSession();
      this.started = false;
    };
  }

  private handleOnline = () => {
    if (!this.user) return;
    this.scheduleFlush(0);
    if (this.drivePending) this.scheduleDrive(0);
    this.emit();
  };

  private handleVisibility = () => {
    if (document.visibilityState !== 'visible' || !this.user) return;
    void this.ensureDriveFresh();
    this.scheduleFlush(0);
  };

  /**
   * Removes account-owned identity fields (photo / email / owner uid) from the
   * settings store while no account is signed in. A Doctor Name typed in
   * Settings is kept.
   */
  private async scrubResidualIdentity(): Promise<void> {
    try {
      const settings = await getSettings();
      if (settings.doctorPhoto || settings.doctorEmail || settings.ownerUid) {
        await saveSettings({ doctorPhoto: '', doctorEmail: '', ownerUid: null });
        this.onRestoredCb?.();
      }
    } catch (err) {
      console.warn('Could not scrub residual profile identity:', err);
    }
  }

  private async handleSignedIn(): Promise<void> {
    if (this.signedInFlow) await this.signedInFlow.catch(() => {});
    if (!this.user) return;
    if (this.session && this.sessionOwner === this.user.uid) {
      this.markDrivePending();
      return;
    }
    const flow = this.performSignedIn();
    this.signedInFlow = flow;
    try {
      await flow;
    } finally {
      if (this.signedInFlow === flow) this.signedInFlow = null;
    }
  }

  private async performSignedIn(): Promise<void> {
    const signingIn = this.user;
    if (!signingIn) return;
    if (this.driveInFlight) await this.driveInFlight.catch(() => {});
    if (this.user?.uid !== signingIn.uid) return;

    try {
      // Personalize the clinic profile from the user's own Gmail account.
      // Hisapp ships with NO pre-filled doctor / account identity.
      const settings = await getSettings();
      const identityIsAutoFilled = !!settings.ownerUid || !!settings.doctorEmail;
      if (!identityIsAutoFilled && !settings.doctorName.trim()) {
        await saveSettings({
          doctorName: signingIn.name,
          doctorEmail: signingIn.email,
          doctorPhoto: signingIn.photoURL || settings.doctorPhoto || '',
          ownerUid: signingIn.uid,
        });
        this.onRestoredCb?.();
      } else if (settings.ownerUid && settings.ownerUid !== signingIn.uid) {
        // A different Google account signed in on this device. Follow it, but
        // never clobber a Doctor Name the doctor typed in Settings.
        await saveSettings({
          doctorName: settings.doctorName.trim() || signingIn.name,
          doctorEmail: signingIn.email,
          doctorPhoto: signingIn.photoURL || '',
          ownerUid: signingIn.uid,
        });
        this.onRestoredCb?.();
      }
      if (this.user?.uid !== signingIn.uid) return;

      // Activate this account's ledger. Guest records on a never-linked device
      // move into the account; other accounts' ledgers are left untouched.
      const previousOwner = await currentLedgerOwner();
      const { claimed } = await activateLedgerOwner(signingIn.uid);
      if (this.user?.uid !== signingIn.uid) return;
      this.onRestoredCb?.();
      if (claimed > 0) {
        this.onToastCb?.(
          'Records Saved to Your Account',
          `${claimed} record${claimed === 1 ? '' : 's'} from this device are now backed up to ${signingIn.email}.`,
          'success'
        );
      } else if (previousOwner && previousOwner !== signingIn.uid) {
        this.onToastCb?.(
          'Switched Google Account',
          `This device now shows ${signingIn.email}'s records. The previous account's records stay on this device for its next sign-in.`,
          'info'
        );
      }

      // Realtime sync does not depend on Drive. Open it right away.
      void this.openSession(signingIn.uid);

      // Refresh the Drive token silently if needed, then import any newer Drive
      // copy and upload the complete local state.
      await this.ensureDriveFresh();
      this.markDrivePending();
      await this.syncLastBackupTime();
    } catch (err: any) {
      console.warn('Sign-in setup notice:', err);
      this.error = err?.message || 'Sign-in setup failed';
    }
    this.recomputePhase();
    this.emit();
  }

  // ── Realtime session ─────────────────────────────────────────────

  private async openSession(uid: string): Promise<void> {
    if (this.session && this.sessionOwner === uid) return;
    if (this.sessionOpening) await this.sessionOpening.catch(() => {});
    if (this.session && this.sessionOwner === uid) return;

    const opening = (async () => {
      this.closeSession();
      try {
        const session = await connectRealtimeSync(uid, {
          onRemoteData: () => {
            if (this.user?.uid !== uid) return;
            this.onRestoredCb?.();
            this.dataChangeVersion += 1;
            this.markDrivePending();
            this.emit();
          },
          onSynced: (pending) => {
            if (this.user?.uid !== uid) return;
            this.pendingCount = pending;
            this.realtimeError = null;
            this.recomputePhase();
            this.emit();
          },
          onError: (error) => {
            if (this.user?.uid !== uid) return;
            this.realtimeError = error.message || 'Realtime cloud sync failed';
            this.recomputePhase();
            this.emit();
            console.warn('Realtime cloud sync notice:', error);
          },
        });
        if (this.user?.uid !== uid) {
          session.close();
          return;
        }
        this.session = session;
        this.sessionOwner = uid;
        this.realtimeError = null;
        this.recomputePhase();
        this.emit();
        void session.flush();
      } catch (error: any) {
        this.realtimeError = error?.message || 'Realtime cloud sync failed';
        this.recomputePhase();
        this.emit();
        console.warn('Could not start Realtime Database sync:', error);
      }
    })();
    this.sessionOpening = opening;
    try {
      await opening;
    } finally {
      if (this.sessionOpening === opening) this.sessionOpening = null;
    }
  }

  private closeSession(): void {
    this.cancelFlushTimer();
    this.session?.close();
    this.session = null;
    this.sessionOwner = null;
    this.pendingCount = 0;
  }

  private scheduleFlush(delay: number): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, delay);
  }

  private cancelFlushTimer(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private async flushNow(): Promise<void> {
    if (!this.session) {
      if (this.user && !this.sessionOpening) void this.openSession(this.user.uid);
      return;
    }
    try {
      await this.session.flush();
    } catch (error) {
      console.warn('Cloud flush failed (kept in the local outbox):', error);
    }
  }

  // ── Drive scheduling ─────────────────────────────────────────────

  private markDrivePending(): void {
    if (!this.user || !this.isConfigured()) return;
    this.drivePending = true;
    const now = Date.now();
    if (this.driveFirstPendingAt === null) this.driveFirstPendingAt = now;
    const waited = now - this.driveFirstPendingAt;
    const delay = Math.max(0, Math.min(DRIVE_DEBOUNCE_MS, DRIVE_MAX_WAIT_MS - waited));
    this.scheduleDrive(delay);
    this.emit();
  }

  private scheduleDrive(delay: number): void {
    if (this.driveTimer) clearTimeout(this.driveTimer);
    this.driveTimer = setTimeout(() => {
      this.driveTimer = null;
      void this.runDriveSync('auto');
    }, delay);
  }

  private cancelDriveTimer(): void {
    if (this.driveTimer) clearTimeout(this.driveTimer);
    this.driveTimer = null;
    this.driveFirstPendingAt = null;
  }

  /** Renews the Drive token silently when it is near expiry. Never opens a popup. */
  private async ensureDriveFresh(): Promise<void> {
    const user = this.user;
    if (!user || !this.isConfigured()) return;
    const hadPending = this.drivePending;
    if (getSilentGoogleToken(user.uid)) {
      this.driveNeedsReconnectFlag = false;
      if (hadPending) this.scheduleDrive(0);
      this.emit();
      return;
    }
    const token = await refreshDriveTokenSilently(user);
    if (this.user?.uid !== user.uid) return;
    this.driveNeedsReconnectFlag = !token;
    if (token && (this.drivePending || hadPending)) this.scheduleDrive(0);
    this.emit();
  }

  /**
   * One Drive cycle: import a newer Drive copy if another device wrote one,
   * overwrite Hisapp_Latest.json with the full local state, and — for manual
   * or weekly runs — create an archive and update the Hisapp_Ledger sheet.
   */
  private async runDriveSync(trigger: 'auto' | 'manual'): Promise<DriveBackupResult | null> {
    if (this.driveInFlight) {
      await this.driveInFlight.catch(() => {});
    }
    const user = this.user;
    if (!user || !this.isConfigured()) return null;
    if (!navigator.onLine) {
      // Stays pending. The 'online' event reschedules it.
      this.emit();
      return null;
    }

    const token = await refreshDriveTokenSilently(user);
    if (this.user?.uid !== user.uid) return null;
    if (!token) {
      this.driveNeedsReconnectFlag = true;
      this.driveError = null;
      this.recomputePhase();
      this.emit();
      if (trigger === 'manual') {
        this.onToastCb?.(
          'Reconnect Google Drive',
          'Records are still syncing across your devices. Tap Reconnect Google Drive in Settings to refresh the Drive backup.',
          'warning'
        );
      }
      return null;
    }
    this.driveNeedsReconnectFlag = false;

    const snapshotVersion = this.dataChangeVersion;
    let result: DriveBackupResult | null = null;

    const cycle = (async () => {
      try {
        const latest = await syncDriveLatest(token, user.uid);
        if (this.user?.uid !== user.uid) return;
        if (latest.imported > 0) {
          this.onRestoredCb?.();
          this.dataChangeVersion += 1;
          this.scheduleFlush(0);
        }
        this.lastBackupAt = latest.modifiedAt;
        this.driveError = null;

        let ledgerNote = '';
        if (trigger === 'manual') {
          result = await createDriveBackup(token);
          try {
            const ledger = await syncSheetsLedger(token);
            ledgerNote = ` and Hisapp_Ledger updated (${ledger.entries} visits)`;
          } catch (ledgerErr: any) {
            console.warn('Ledger sheet sync notice:', ledgerErr);
            this.onToastCb?.(
              'Sheet Sync Issue',
              ledgerErr?.message?.startsWith('SHEETS_API_DISABLED')
                ? 'Enable the Google Sheets API on the Firebase project to use Hisapp_Ledger. JSON backups are unaffected.'
                : `Backup saved, but the ledger sheet could not update: ${ledgerErr?.message || 'unknown error'}`,
              'warning'
            );
          }
          this.onToastCb?.(
            'Backed Up to Google Drive!',
            `Saved "${result.fileName}" (${result.totalEntries} visits, ${result.totalSettlements} settlements) to ${result.folderName}/${ledgerNote}.`,
            'success'
          );
        } else {
          const archived = await checkAndRunWeeklyAutoBackup(token);
          if (archived) {
            try {
              await syncSheetsLedger(token);
            } catch (ledgerErr) {
              console.warn('Weekly ledger sync notice:', ledgerErr);
            }
            this.onToastCb?.(
              'Weekly Backup Saved',
              'A safety snapshot was archived to Hisapp_Backups on Google Drive.',
              'info'
            );
          }
        }

        // Changes made while the upload was running stay pending.
        if (this.dataChangeVersion === snapshotVersion) {
          this.drivePending = false;
          this.driveFirstPendingAt = null;
        } else {
          this.drivePending = true;
          this.driveFirstPendingAt = Date.now();
          this.scheduleDrive(DRIVE_DEBOUNCE_MS);
        }
        await this.syncLastBackupTime();
      } catch (err: any) {
        if (err?.message === 'SESSION_EXPIRED') {
          this.driveNeedsReconnectFlag = true;
          this.driveError = null;
          if (trigger === 'manual') {
            this.onToastCb?.(
              'Reconnect Google Drive',
              'Google Drive needs approval again. Tap Reconnect Google Drive in Settings.',
              'warning'
            );
          }
        } else {
          this.driveError = err?.message || 'Drive backup failed';
          console.warn('Drive backup notice:', err);
          if (trigger === 'manual') {
            this.onToastCb?.('Backup Failed', this.driveError ?? undefined, 'error');
          }
          // Keep retrying in the background.
          this.drivePending = true;
          this.scheduleDrive(DRIVE_RETRY_MS);
        }
      }
    })();

    this.driveInFlight = cycle;
    this.recomputePhase();
    this.emit();
    try {
      await cycle;
    } finally {
      if (this.driveInFlight === cycle) this.driveInFlight = null;
      this.recomputePhase();
      this.emit();
    }
    return result;
  }

  // ── Status ───────────────────────────────────────────────────────

  getStatus(): BackupStatus {
    return {
      phase: this.phase,
      isConfigured: this.isConfigured(),
      isOnline: navigator.onLine,
      user: this.user,
      lastBackupAt: this.lastBackupAt,
      pendingChanges: this.pendingCount > 0 || this.drivePending,
      pendingCount: this.pendingCount,
      driveNeedsReconnect: this.driveNeedsReconnectFlag,
      error: this.error || this.realtimeError || this.driveError,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private isConfigured(): boolean {
    return isFirebaseConfigured();
  }

  private recomputePhase(): void {
    if (!this.isConfigured()) {
      this.phase = 'not-configured';
    } else if (!this.user) {
      this.phase = 'signed-out';
    } else if (this.driveInFlight) {
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
    const candidates = [settings.lastDriveSyncAt ?? 0, settings.lastDriveSnapshotTimestamp ?? 0];
    const latest = Math.max(...candidates);
    this.lastBackupAt = latest > 0 ? latest : null;
  }

  // ── Public operations ────────────────────────────────────────────

  /**
   * Call AFTER every local (IndexedDB) write. The write is already durable and
   * queued for the cloud. When online this pushes it immediately; the Drive
   * copy follows about a second later.
   */
  onDataChanged(): void {
    if (!this.started) return;
    this.dataChangeVersion += 1;
    if (this.user) {
      this.drivePending = true;
      this.scheduleFlush(0);
      this.markDrivePending();
    }
    this.emit();
  }

  /** Manual "Sync Now / Backup Now": push the outbox, then update Drive and archive. */
  async backupNow(): Promise<DriveBackupResult | null> {
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
    if (!navigator.onLine) {
      this.onToastCb?.(
        'Device Offline',
        'Reconnect to the internet to back up. Local data is saved safely on this device.',
        'warning'
      );
      return null;
    }
    const user = this.user;
    if (!this.session || this.sessionOwner !== user.uid) await this.openSession(user.uid);
    await withTimeout(this.flushNow(), 15_000);
    return this.runDriveSync('manual');
  }

  /** Explicit sign-in (popup, from a button). Afterwards the account's sync starts. */
  async signIn(): Promise<HisappUser | null> {
    try {
      const { user } = await signInWithGoogle();
      // The auth listener may already have run for this user. Re-run the account
      // flow now that the Drive token is cached.
      if (this.user?.uid === user.uid) {
        this.error = null;
        await this.handleSignedIn();
        this.markDrivePending();
        this.driveNeedsReconnectFlag = false;
      }
      this.recomputePhase();
      this.emit();
      return user;
    } catch (err: any) {
      this.error = err?.message || 'Sign-in failed';
      this.recomputePhase();
      this.emit();
      this.onToastCb?.('Sign-In Failed', this.error ?? undefined, 'error');
      return null;
    }
  }

  /**
   * Explicit reconnect of Google Drive (button). Opens a popup only when a
   * silent renewal is not possible. Call from a click handler.
   */
  async reconnectDrive(): Promise<boolean> {
    const user = this.user;
    if (!user) return false;
    try {
      const silent = await refreshDriveTokenSilently(user);
      if (!silent) await ensureGoogleToken(user.uid);
      this.driveNeedsReconnectFlag = false;
      this.driveError = null;
      this.markDrivePending();
      this.emit();
      this.onToastCb?.('Google Drive Connected', 'Drive backup will refresh shortly.', 'success');
      return true;
    } catch (err: any) {
      this.driveError = err?.message || 'Could not reconnect Google Drive';
      this.emit();
      this.onToastCb?.('Reconnect Failed', this.driveError ?? undefined, 'error');
      return false;
    }
  }

  /** Whether silent Drive renewal is set up (a Web client ID is configured). */
  canRenewDriveSilently(): boolean {
    return isSilentDriveRenewalConfigured();
  }

  async signOut(): Promise<void> {
    // Remove the Google identity auto-filled at sign-in. Clinic name and logo stay.
    let clearedIdentity = false;
    try {
      const settings = await getSettings();
      const identityPatch = signOutIdentityPatch(settings, this.user);
      if (identityPatch) {
        await saveSettings(identityPatch);
        clearedIdentity = true;
      }
    } catch (err) {
      console.warn('Could not clear profile identity on sign-out:', err);
    }

    // Push everything still queued before the session ends. Anything not yet
    // confirmed stays in the account's outbox and is sent at the next sign-in.
    await withTimeout(this.flushNow(), SIGN_OUT_FLUSH_TIMEOUT_MS);
    this.closeSession();
    this.cancelDriveTimer();
    this.drivePending = false;
    this.driveNeedsReconnectFlag = false;

    await signOutGoogle();
    this.error = null;
    this.driveError = null;
    this.recomputePhase();
    this.emit();
    if (clearedIdentity) this.onRestoredCb?.();
  }

  // ── Restore ──────────────────────────────────────────────────────

  /**
   * Manual restore: replaces this device's records with the most recently
   * modified Drive backup. The restored records are then synced to the
   * account's other devices.
   */
  async restoreLatest(): Promise<{ fileName: string; entries: number } | null> {
    if (!this.isConfigured() || !this.user) {
      this.onToastCb?.('Not Signed In', 'Sign in with your Gmail account first.', 'warning');
      return null;
    }
    const user = this.user;
    try {
      if (this.driveInFlight) await this.driveInFlight.catch(() => {});
      if (this.user?.uid !== user.uid) return null;
      const token = (await refreshDriveTokenSilently(user)) ?? (await ensureGoogleToken(user.uid));
      const latest = await downloadLatestDriveBackup(token);
      if (this.user?.uid !== user.uid) return null;
      if (!latest) {
        this.onToastCb?.('No Backups Found', 'Your Hisapp_Backups folder on Google Drive is empty.', 'info');
        return null;
      }
      await restoreAllData(latest.payload);
      this.dataChangeVersion += 1;
      this.onRestoredCb?.();
      this.markDrivePending();
      this.scheduleFlush(0);
      await this.syncLastBackupTime();
      this.onToastCb?.(
        'Restored from Google Drive',
        `Loaded "${latest.meta.name}" — ${latest.payload.patientEntries?.length ?? 0} visits, ${latest.payload.settlements?.length ?? 0} settlements.`,
        'success'
      );
      return { fileName: latest.meta.name, entries: latest.payload.patientEntries?.length ?? 0 };
    } catch (err: any) {
      const message =
        err?.message === 'SESSION_EXPIRED'
          ? 'Google session expired — reconnect Google Drive in Settings.'
          : err?.message || 'Restore failed';
      this.onToastCb?.('Restore Failed', message, 'error');
      return null;
    }
  }
}

/** App-wide singleton */
export const backupEngine = new BackupEngine();
