/**
 * HISAPP — CLOUD BACKUP ENGINE
 * ─────────────────────────────────────────────────────────────────
 * Orchestrates the app's dual-backup strategy:
 *
 *   1. LOCAL (simultaneous): every entry/settlement write already goes
 *      straight into IndexedDB (durable browser database).
 *   2. CLOUD: after every local change this engine schedules a debounced
 *      Google Drive backup to the signed-in user's OWN Drive, plus a
 *      weekly safety snapshot. When a user signs in on an empty device,
 *      their latest Drive backup is restored automatically.
 *
 * UI subscribes to `status` to show live backup state.
 */
import {
  getAllPatientEntries,
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
} from './driveBackup';
import { syncSheetsLedger } from './sheetsLedger';

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
      // Personalize the clinic profile the first time a Google account connects
      const settings = await getSettings();
      if (settings.doctorName === 'Dr. MBR (BDS, PGT-OMS)') {
        await saveSettings({
          doctorName: this.user!.name,
          doctorEmail: this.user!.email,
          doctorPhoto: this.user!.photoURL || settings.doctorPhoto,
        });
        this.onRestoredCb?.(); // let the app refresh settings UI
      }

      // New device / wiped browser: local DB is empty → auto-restore the
      // user's most recent Google Drive backup so no data is ever lost.
      const entries = await getAllPatientEntries();
      if (entries.length === 0) {
        const token = getSilentGoogleToken();
        if (token) {
          const latest = await downloadLatestDriveBackup(token);
          if (latest && (latest.payload.patientEntries?.length || latest.payload.settlements?.length)) {
            await restoreAllData(latest.payload);
            this.onRestoredCb?.();
            this.onToastCb?.(
              'Data Restored from Google Drive',
              `Loaded "${latest.meta.name}" — your records are back.`,
              'success'
            );
          }
        }
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
      void previousUser;
    } catch (err: any) {
      console.warn('Post sign-in backup check notice:', err);
      if (err?.message !== 'SESSION_EXPIRED') {
        this.error = err?.message || 'Cloud backup check failed';
      }
      this.recomputePhase();
      this.emit();
    }
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
    await signOutGoogle();
    this.pendingChanges = false;
    this.error = null;
    this.recomputePhase();
    this.emit();
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
