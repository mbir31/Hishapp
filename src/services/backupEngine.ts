/**
 * HISAPP — CLOUD DATA VAULT BACKUP & SYNC ENGINE
 * ─────────────────────────────────────────────────────────────────
 * Central Cloud Firestore sync engine for Hisapp.
 *
 * Each clinic / doctor uses an 11-digit mobile number and secret 4-digit PIN
 * to unlock and synchronize their private data vault.
 *
 * All local writes commit instantly to IndexedDB and queue in the persistent
 * sync outbox. When connected, changes sync to Cloud Firestore in real time.
 */
import { activateLedgerOwner, countOutbox, getSettings } from '../db/indexedDB';
import { isFirebaseConfigured } from '../config/firebase';
import {
  changeVaultPin,
  clearVaultSession,
  getStoredVaultSession,
  loginOrCreateVault,
  type VaultSession,
} from './vaultAuth';
import {
  isBiometricAvailable,
  isBiometricEnrolledFor,
  loginWithBiometric,
  registerBiometric,
  resetPinWithBiometric,
} from './biometricAuth';
import {
  connectFirestoreSync,
  type FirestoreSyncSession,
} from './firestoreSync';

export type BackupPhase = 'not-configured' | 'signed-out' | 'idle' | 'syncing' | 'synced' | 'error';

export interface VaultUser {
  phoneNumber: string;
  name?: string;
}

export interface BackupStatus {
  phase: BackupPhase;
  isConfigured: boolean;
  isOnline: boolean;
  user: VaultUser | null;
  /** Timestamp of the last confirmed cloud write, epoch ms */
  lastBackupAt: number | null;
  /** Local records waiting to be pushed to Cloud Firestore */
  pendingChanges: boolean;
  /** Exact count of pending outbox items */
  pendingCount: number;
  error: string | null;
}

type Listener = (status: BackupStatus) => void;

const SYNC_DEBOUNCE_MS = 1200;

class BackupEngine {
  private listeners = new Set<Listener>();
  private started = false;
  private user: VaultUser | null = null;
  private syncSession: FirestoreSyncSession | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private phase: BackupPhase = 'signed-out';
  private pendingCount = 0;
  private lastBackupAt: number | null = null;
  private error: string | null = null;
  private onRemoteDataChangedCb: (() => void) | null = null;

  /** Initialize the engine and resume any saved session */
  start(onRemoteDataChanged: () => void): () => void {
    if (this.started) return () => {};
    this.started = true;
    this.onRemoteDataChangedCb = onRemoteDataChanged;

    if (!isFirebaseConfigured()) {
      this.phase = 'not-configured';
      this.emit();
      return () => {};
    }

    // Network connectivity listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleNetworkOnline);
      window.addEventListener('offline', this.handleNetworkOffline);
    }

    // Check for existing session
    const savedSession = getStoredVaultSession();
    if (savedSession) {
      this.resumeSession(savedSession);
    } else {
      this.phase = 'signed-out';
      this.emit();
    }

    return () => {
      this.stop();
    };
  }

  private stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.syncSession) {
      this.syncSession.close();
      this.syncSession = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleNetworkOnline);
      window.removeEventListener('offline', this.handleNetworkOffline);
    }
    this.started = false;
  }

  private handleNetworkOnline = () => {
    this.emit();
    if (this.user && this.syncSession) {
      void this.syncSession.flush();
    }
  };

  private handleNetworkOffline = () => {
    this.emit();
  };

  private async resumeSession(session: VaultSession): Promise<void> {
    try {
      this.user = { phoneNumber: session.phoneNumber };
      this.phase = 'syncing';
      this.emit();

      await activateLedgerOwner(session.phoneNumber);
      this.pendingCount = await countOutbox(session.phoneNumber);

      this.syncSession = connectFirestoreSync(session.phoneNumber, {
        onRemoteData: () => {
          this.emit();
          this.onRemoteDataChangedCb?.();
        },
        onSynced: (pending) => {
          this.pendingCount = pending;
          this.lastBackupAt = Date.now();
          this.phase = pending > 0 ? 'syncing' : 'synced';
          this.error = null;
          this.emit();
        },
        onError: (err) => {
          this.error = err.message || 'Firestore sync issue';
          this.phase = 'error';
          this.emit();
        },
      });

      this.phase = this.pendingCount > 0 ? 'syncing' : 'synced';
      this.emit();
    } catch (err: any) {
      this.error = err.message || 'Failed to resume vault session';
      this.phase = 'error';
      this.emit();
    }
  }

  /**
   * Log into or provision a new cloud vault with phone number & 4-digit PIN.
   */
  async login(phone: string, pin: string): Promise<VaultSession> {
    this.phase = 'syncing';
    this.error = null;
    this.emit();

    try {
      const session = await loginOrCreateVault(phone, pin);
      this.user = { phoneNumber: session.phoneNumber };

      await activateLedgerOwner(session.phoneNumber);
      this.pendingCount = await countOutbox(session.phoneNumber);

      if (this.syncSession) {
        this.syncSession.close();
      }

      this.syncSession = connectFirestoreSync(session.phoneNumber, {
        onRemoteData: () => {
          this.emit();
          this.onRemoteDataChangedCb?.();
        },
        onSynced: (pending) => {
          this.pendingCount = pending;
          this.lastBackupAt = Date.now();
          this.phase = pending > 0 ? 'syncing' : 'synced';
          this.error = null;
          this.emit();
        },
        onError: (err) => {
          this.error = err.message || 'Firestore sync issue';
          this.phase = 'error';
          this.emit();
        },
      });

      // Flush local records to newly opened vault
      await this.syncSession.flush();

      this.phase = 'synced';
      this.emit();
      return session;
    } catch (err: any) {
      this.user = null;
      this.phase = 'signed-out';
      this.error = err.message || 'Login failed';
      this.emit();
      throw err;
    }
  }

  /**
   * Log into cloud vault using device biometrics (Fingerprint / Face ID).
   */
  async loginWithBiometrics(phone: string): Promise<VaultSession> {
    this.phase = 'syncing';
    this.error = null;
    this.emit();

    try {
      const session = await loginWithBiometric(phone);
      this.user = { phoneNumber: session.phoneNumber };

      await activateLedgerOwner(session.phoneNumber);
      this.pendingCount = await countOutbox(session.phoneNumber);

      if (this.syncSession) {
        this.syncSession.close();
      }

      this.syncSession = connectFirestoreSync(session.phoneNumber, {
        onRemoteData: () => {
          this.emit();
          this.onRemoteDataChangedCb?.();
        },
        onSynced: (pending) => {
          this.pendingCount = pending;
          this.lastBackupAt = Date.now();
          this.phase = pending > 0 ? 'syncing' : 'synced';
          this.error = null;
          this.emit();
        },
        onError: (err) => {
          this.error = err.message || 'Firestore sync issue';
          this.phase = 'error';
          this.emit();
        },
      });

      await this.syncSession.flush();
      this.phase = 'synced';
      this.emit();
      return session;
    } catch (err: any) {
      this.user = null;
      this.phase = 'signed-out';
      this.error = err.message || 'Biometric login failed';
      this.emit();
      throw err;
    }
  }

  /**
   * Enable/register biometrics for the logged-in vault user
   */
  async enableBiometrics(): Promise<boolean> {
    if (!this.user) {
      throw new Error('Please log in first.');
    }
    return await registerBiometric(this.user.phoneNumber);
  }

  /**
   * Reset PIN using Biometric verification
   */
  async resetPinWithBiometrics(phone: string, newPin: string): Promise<void> {
    await resetPinWithBiometric(phone, newPin);
    if (this.user && this.user.phoneNumber === phone) {
      this.emit();
    }
  }

  /**
   * Sign out of the cloud vault on this device
   */
  async signOut(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.syncSession) {
      this.syncSession.close();
      this.syncSession = null;
    }
    clearVaultSession();
    this.user = null;
    this.phase = isFirebaseConfigured() ? 'signed-out' : 'not-configured';
    this.pendingCount = 0;
    this.error = null;
    this.emit();
  }

  /**
   * Change secret 4-digit PIN of the current vault
   */
  async changePin(oldPin: string, newPin: string): Promise<void> {
    if (!this.user) {
      throw new Error('দয়া করে প্রথমে লগইন করুন (Please log in first).');
    }
    await changeVaultPin(this.user.phoneNumber, oldPin, newPin);
  }

  /**
   * Called whenever a visit, settlement, or profile is added/modified locally.
   * Debounces and flushes changes to Cloud Firestore.
   */
  onDataChanged(): void {
    if (!this.user || !this.syncSession) return;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      try {
        const settings = await getSettings();
        if (settings.autoBackup !== false) {
          await this.syncSession?.flush();
        }
      } catch {
        // ignore background flush errors
      }
    }, SYNC_DEBOUNCE_MS);
  }

  /**
   * Trigger an immediate on-demand cloud sync
   */
  async backupNow(): Promise<void> {
    if (!this.user) {
      throw new Error('অনুগ্রহ করে ক্লাউড ভল্টে লগইন করুন (Please log into your vault).');
    }
    if (!this.syncSession) {
      throw new Error('সিঙ্ক সেশন সক্রিয় নয় (Sync session not active).');
    }

    this.phase = 'syncing';
    this.emit();
    try {
      await this.syncSession.flush();
      this.lastBackupAt = Date.now();
      this.phase = 'synced';
      this.emit();
    } catch (err: any) {
      this.phase = 'error';
      this.error = err.message || 'Failed to sync now';
      this.emit();
      throw err;
    }
  }

  getStatus(): BackupStatus {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    return {
      phase: this.phase,
      isConfigured: isFirebaseConfigured(),
      isOnline,
      user: this.user,
      lastBackupAt: this.lastBackupAt,
      pendingChanges: this.pendingCount > 0,
      pendingCount: this.pendingCount,
      error: this.error,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const status = this.getStatus();
    this.listeners.forEach((listener) => {
      try {
        listener(status);
      } catch {
        // ignore subscriber error
      }
    });
  }
}

export const backupEngine = new BackupEngine();
