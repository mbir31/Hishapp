/**
 * HISAPP — CLOUD DATA VAULT BACKUP & SYNC ENGINE (HARDENED & FAIL-SAFE)
 * ─────────────────────────────────────────────────────────────────
 * Central Cloud Firestore sync engine for Hisapp.
 *
 * Each clinic / doctor uses an 11-digit mobile number and secret 4-digit PIN
 * to unlock and synchronize their private data vault.
 *
 * RESILIENCE ARCHITECTURE:
 *   1. Persistent Storage Guarantee via navigator.storage.persist()
 *   2. Atomic outbox commits in IndexedDB transactions
 *   3. Realtime Firestore subcollections + Consolidated Cloud Recovery Snapshots
 *   4. Multi-tab live coordination via BroadcastChannel
 *   5. Secondary Local Emergency Fail-Safe Snapshot in browser storage
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
  createCloudRecoverySnapshot,
  getAvailableCloudSnapshots,
  reconcileVaultRecords,
  restoreFromCloudSnapshot,
  restoreFromSpecificSnapshot,
  type FirestoreSyncSession,
} from './firestoreSync';
import {
  ensurePersistentStorage,
  getStorageHealth,
  isStoragePersisted,
  type StorageHealth,
} from './storagePersistence';
import { crossTabSync } from './crossTabSync';
import {
  captureEmergencyLocalSnapshot,
  getEmergencySnapshotMeta,
  inspectDualStoreHealth,
  restoreFromEmergencySnapshot,
  type DualStoreHealth,
  type EmergencySnapshotMeta,
} from './emergencyBackup';
import type { CloudSnapshotInfo, ReconciliationResult } from '../types';

export type BackupPhase = 'not-configured' | 'signed-out' | 'idle' | 'syncing' | 'synced' | 'error';

export interface VaultUser {
  phoneNumber: string;
  name?: string;
}

export interface BackupStatus {
  phase: BackupPhase;
  isConfigured: boolean;
  isOnline: boolean;
  isStoragePersisted: boolean;
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

const SYNC_DEBOUNCE_MS = 1000;

class BackupEngine {
  private listeners = new Set<Listener>();
  private started = false;
  private user: VaultUser | null = null;
  private syncSession: FirestoreSyncSession | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private crossTabUnsub: (() => void) | null = null;

  private phase: BackupPhase = 'signed-out';
  private pendingCount = 0;
  private lastBackupAt: number | null = null;
  private isStoragePersistedFlag = false;
  private error: string | null = null;
  private onRemoteDataChangedCb: (() => void) | null = null;

  /** Initialize the engine, request persistent storage, and resume session */
  start(onRemoteDataChanged: () => void): () => void {
    if (this.started) return () => {};
    this.started = true;
    this.onRemoteDataChangedCb = onRemoteDataChanged;

    // 1. Request OS/Browser storage persistence guarantee
    void ensurePersistentStorage().then((persisted) => {
      this.isStoragePersistedFlag = persisted;
      this.emit();
    });

    // 2. Subscribe to cross-tab live synchronization
    this.crossTabUnsub = crossTabSync.subscribe((msg) => {
      if (msg.type === 'DATA_CHANGED') {
        this.emit();
        this.onRemoteDataChangedCb?.();
      } else if (msg.type === 'SESSION_CHANGED') {
        const savedSession = getStoredVaultSession();
        if (savedSession && (!this.user || this.user.phoneNumber !== savedSession.phoneNumber)) {
          void this.resumeSession(savedSession);
        } else if (!savedSession && this.user) {
          void this.signOut();
        }
      }
    });

    // 3. Service Worker Background Sync message listener
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'BACKGROUND_SYNC_TRIGGER') {
          if (this.user && this.syncSession) {
            void this.syncSession.flush();
          }
        }
      });
    }

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
      void this.resumeSession(savedSession);
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
    if (this.crossTabUnsub) {
      this.crossTabUnsub();
      this.crossTabUnsub = null;
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
          crossTabSync.notifyDataChanged(session.phoneNumber);
          void captureEmergencyLocalSnapshot();
        },
        onSynced: (pending) => {
          this.pendingCount = pending;
          this.lastBackupAt = Date.now();
          this.phase = pending > 0 ? 'syncing' : 'synced';
          this.error = null;
          this.emit();
          void captureEmergencyLocalSnapshot();
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
          crossTabSync.notifyDataChanged(session.phoneNumber);
          void captureEmergencyLocalSnapshot();
        },
        onSynced: (pending) => {
          this.pendingCount = pending;
          this.lastBackupAt = Date.now();
          this.phase = pending > 0 ? 'syncing' : 'synced';
          this.error = null;
          this.emit();
          void captureEmergencyLocalSnapshot();
        },
        onError: (err) => {
          this.error = err.message || 'Firestore sync issue';
          this.phase = 'error';
          this.emit();
        },
      });

      // Flush local records to newly opened vault
      await this.syncSession.flush();
      void this.syncSession.saveSnapshot();
      void captureEmergencyLocalSnapshot();

      crossTabSync.notifySessionChanged(session.phoneNumber);

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
          crossTabSync.notifyDataChanged(session.phoneNumber);
          void captureEmergencyLocalSnapshot();
        },
        onSynced: (pending) => {
          this.pendingCount = pending;
          this.lastBackupAt = Date.now();
          this.phase = pending > 0 ? 'syncing' : 'synced';
          this.error = null;
          this.emit();
          void captureEmergencyLocalSnapshot();
        },
        onError: (err) => {
          this.error = err.message || 'Firestore sync issue';
          this.phase = 'error';
          this.emit();
        },
      });

      await this.syncSession.flush();
      void this.syncSession.saveSnapshot();
      void captureEmergencyLocalSnapshot();

      crossTabSync.notifySessionChanged(session.phoneNumber);

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
    const prevUser = this.user?.phoneNumber;
    this.user = null;
    this.phase = isFirebaseConfigured() ? 'signed-out' : 'not-configured';
    this.pendingCount = 0;
    this.error = null;
    this.emit();
    crossTabSync.notifySessionChanged(null);
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
   * Debounces and flushes changes to Cloud Firestore, updates cross-tab sync,
   * and takes an emergency local snapshot.
   */
  onDataChanged(): void {
    crossTabSync.notifyDataChanged(this.user?.phoneNumber);
    void captureEmergencyLocalSnapshot();

    // Register Background Sync if supported so browser flushes even if tab closes
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'SyncManager' in window) {
      navigator.serviceWorker.ready
        .then((reg) => {
          if ('sync' in reg) {
            return (reg as any).sync.register('hisapp-cloud-sync');
          }
        })
        .catch(() => {});
    }

    if (!this.user || !this.syncSession) return;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      try {
        const settings = await getSettings();
        if (settings.autoBackup !== false) {
          await this.syncSession?.flush();
          void this.syncSession?.saveSnapshot();
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
      await this.syncSession.saveSnapshot();
      void captureEmergencyLocalSnapshot();
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

  /**
   * Run bidirectional reconciliation between local IndexedDB and Cloud Firestore
   */
  async reconcileVault(): Promise<ReconciliationResult> {
    if (!this.user) {
      throw new Error('অনুগ্রহ করে প্রথমে ক্লাউড ভল্টে লগইন করুন (Please log into your vault first).');
    }
    this.phase = 'syncing';
    this.emit();

    try {
      const result = await reconcileVaultRecords(this.user.phoneNumber);
      this.lastBackupAt = Date.now();
      this.pendingCount = await countOutbox(this.user.phoneNumber);
      this.phase = this.pendingCount > 0 ? 'syncing' : 'synced';
      this.emit();
      this.onRemoteDataChangedCb?.();
      void captureEmergencyLocalSnapshot();
      return result;
    } catch (err: any) {
      this.phase = 'error';
      this.error = err.message || 'Reconciliation failed';
      this.emit();
      throw err;
    }
  }

  /**
   * Get list of all available multi-generation rolling cloud snapshots
   */
  async getAvailableCloudSnapshots(): Promise<CloudSnapshotInfo[]> {
    if (!this.user) {
      return [];
    }
    return await getAvailableCloudSnapshots(this.user.phoneNumber);
  }

  /**
   * Restore from a specific rolling cloud snapshot generation
   */
  async restoreCloudSnapshotByKey(
    key: 'latest' | 'yesterday' | 'last_week'
  ): Promise<{ entries: number; settlements: number }> {
    if (!this.user) {
      throw new Error('Please log in first.');
    }
    this.phase = 'syncing';
    this.emit();

    try {
      const result = await restoreFromSpecificSnapshot(this.user.phoneNumber, key);
      this.lastBackupAt = Date.now();
      this.phase = 'synced';
      this.emit();
      this.onRemoteDataChangedCb?.();
      crossTabSync.notifyDataChanged(this.user.phoneNumber);
      void captureEmergencyLocalSnapshot();
      return result;
    } catch (err: any) {
      this.phase = 'error';
      this.error = err.message || `Failed to restore ${key} snapshot`;
      this.emit();
      throw err;
    }
  }

  /**
   * Restore from the Consolidated Cloud Recovery Snapshot (latest)
   */
  async restoreCloudSnapshot(): Promise<{ entries: number; settlements: number }> {
    return this.restoreCloudSnapshotByKey('latest');
  }

  /**
   * Restore from the Secondary Local Emergency Snapshot
   */
  async restoreEmergencySnapshot(): Promise<{ entries: number; settlements: number }> {
    const result = await restoreFromEmergencySnapshot();
    this.onRemoteDataChangedCb?.();
    this.emit();
    return result;
  }

  /**
   * Inspect dual-store redundancy health (Primary DB vs Safety Mirror)
   */
  async getDualStoreHealth(): Promise<DualStoreHealth> {
    return await inspectDualStoreHealth();
  }

  /** Get storage health and eviction protection info */
  async getStorageHealthInfo(): Promise<StorageHealth> {
    return await getStorageHealth();
  }

  getStatus(): BackupStatus {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    return {
      phase: this.phase,
      isConfigured: isFirebaseConfigured(),
      isOnline,
      isStoragePersisted: this.isStoragePersistedFlag,
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
