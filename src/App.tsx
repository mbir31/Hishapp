import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ClinicSettings, PatientEntry, Settlement, TabType, ToastAction, ToastMessage } from './types';
import {
  DEFAULT_SETTINGS,
  getAllPatientEntries,
  getAllSettlements,
  getSettings,
  removeLegacyDemoData,
  savePatientEntry,
  saveSettings,
} from './db/indexedDB';
import { backupEngine, type BackupStatus } from './services/backupEngine';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { DashboardTab } from './components/DashboardTab';
import { EntryTab } from './components/EntryTab';
import { SettlementTab } from './components/SettlementTab';
import { RecordsTab } from './components/RecordsTab';
import { SettingsModal } from './components/SettingsModal';
import { SettlementReceiptModal } from './components/SettlementReceiptModal';
import { ToastContainer } from './components/Toast';
import { AppBackground } from './components/AppBackground';
import { displayDateKey, weekdayNameDateKey } from './utils/dateUtils';

/** Left-to-right order of the bottom navigation — drives the slide direction
 *  of the tab change animation. */
const TAB_ORDER: TabType[] = ['dashboard', 'entry', 'records', 'settlement'];

const INITIAL_BACKUP_STATUS: BackupStatus = {
  phase: 'signed-out',
  isConfigured: false,
  isOnline: true,
  user: null,
  lastBackupAt: null,
  pendingChanges: false,
  error: null,
};

export default function App() {
  const isOnline = useOnlineStatus();

  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [tabDirection, setTabDirection] = useState<'forward' | 'backward'>('forward');
  const [entries, setEntries] = useState<PatientEntry[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settings, setSettings] = useState<ClinicSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [receiptSettlement, setReceiptSettlement] = useState<Settlement | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>(INITIAL_BACKUP_STATUS);

  const engineUnsubscribeRef = useRef<(() => void) | null>(null);

  // Toast dispatch helper (supports an optional action button + custom duration)
  const showToast = useCallback(
    (
      title: string,
      desc?: string,
      type: 'success' | 'info' | 'warning' | 'error' = 'info',
      options?: { action?: ToastAction; duration?: number }
    ) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      setToasts((prev) => [
        ...prev,
        { id, title, description: desc, type, action: options?.action, duration: options?.duration },
      ]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, options?.duration ?? 4000);
    },
    []
  );

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Load all initial data from IndexedDB (the simultaneous local backup)
  const refreshData = useCallback(async () => {
    try {
      const [allEntries, allSettlements, appSettings] = await Promise.all([
        getAllPatientEntries(),
        getAllSettlements(),
        getSettings(),
      ]);
      setEntries(allEntries);
      setSettlements(allSettlements);
      setSettings(appSettings);
    } catch (err) {
      console.error('Failed to load local database:', err);
    }
  }, []);

  // Initial load and cloud-backup engine startup (no demo seeding)
  useEffect(() => {
    async function init() {
      try {
        const removedDemoData = await removeLegacyDemoData();
        await refreshData();

        // Start the dual-backup engine: Firebase auth + Google Drive sync
        engineUnsubscribeRef.current = await backupEngine.start({
          onRestored: () => {
            void refreshData();
          },
          onToast: showToast,
        });
        backupEngine.subscribe(setBackupStatus);
        if (removedDemoData) backupEngine.onDataChanged();
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
    return () => {
      engineUnsubscribeRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the engine aware of connectivity for backup scheduling
  useEffect(() => {
    if (!isOnline && backupStatus.pendingChanges) {
      showToast(
        'Working Offline',
        'Changes are saved locally and will sync across your devices and back up to Google Drive when you reconnect.',
        'info'
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // Register service worker if available in browser for offline PWA functionality
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => reg.update())
        .catch((err) => console.log('SW registration note:', err));
    }
  }, []);

  // Entry saved callback — local backup happens in IndexedDB, then cloud sync
  const handleEntrySaved = (newEntry: PatientEntry) => {
    setEntries((prev) => [newEntry, ...prev]);
    backupEngine.onDataChanged();
  };

  // Settlement completed callback
  const handleSettlementCompleted = (settlement: Settlement) => {
    setSettlements((prev) => [settlement, ...prev]);
    setEntries((prev) =>
      prev.map((e) =>
        settlement.patientIds.includes(e.id)
          ? { ...e, settlementStatus: 'Settled', settlementId: settlement.settlementId }
          : e
      )
    );
    setReceiptSettlement(settlement);
    backupEngine.onDataChanged();
  };

  const handleSettlementDeleted = (settlementId: string) => {
    setSettlements((prev) => prev.filter((s) => s.settlementId !== settlementId));
    setEntries((prev) =>
      prev.map((e) =>
        e.settlementId === settlementId
          ? { ...e, settlementStatus: 'Pending', settlementId: null }
          : e
      )
    );
    backupEngine.onDataChanged();
  };

  const handleEntryUpdated = (updatedEntry: PatientEntry) => {
    setEntries((prev) => prev.map((e) => (e.id === updatedEntry.id ? updatedEntry : e)));
    backupEngine.onDataChanged();
  };

  const handleEntryDeleted = (deletedEntry: PatientEntry) => {
    setEntries((prev) => prev.filter((e) => e.id !== deletedEntry.id));
    backupEngine.onDataChanged();

    // Offer an Undo action so an accidental delete can be reversed
    showToast(
      'Record Deleted',
      `Removed visit of ${deletedEntry.patientName} (${weekdayNameDateKey(deletedEntry.date)} ${displayDateKey(deletedEntry.date)})`,
      'info',
      {
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            void (async () => {
              try {
                const restoredEntry = { ...deletedEntry, updatedAt: Date.now() };
                await savePatientEntry(restoredEntry);
                setEntries((prev) => [restoredEntry, ...prev]);
                backupEngine.onDataChanged();
                showToast(
                  'Record Restored',
                  `Visit of ${deletedEntry.patientName} is back in the ledger`,
                  'success'
                );
              } catch (err: any) {
                showToast('Undo Failed', err?.message || 'Could not restore the record', 'error');
              }
            })();
          },
        },
      }
    );
  };

  const handleSettingsSaved = (newSettings: ClinicSettings) => {
    setSettings(newSettings);
    backupEngine.onDataChanged();
  };

  // Tab switching keeps track of the travel direction so the panel can slide
  // in from the matching side (iOS-style page transition).
  const handleChangeTab = (tab: TabType) => {
    if (tab === activeTab) return;
    setTabDirection(TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(activeTab) ? 'forward' : 'backward');
    setActiveTab(tab);
  };

  const pendingCount = entries.filter((e) => e.settlementStatus === 'Pending').length;

  if (isLoading) {
    return (
      <>
        <AppBackground />
        <div className="relative z-0 min-h-screen flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-16 h-16 rounded-2xl p-0.5 bg-gradient-to-tr from-indigo-500 via-sky-500 to-emerald-400 shadow-lg shadow-indigo-500/10 flex items-center justify-center animate-pulse">
              <img
                src="/applogo.png"
                alt="Hisapp Launcher Logo"
                className="w-full h-full rounded-[14px] object-contain bg-white p-1"
              />
            </div>
            <p className="text-xs font-bold text-slate-500 tracking-wider uppercase">
              Loading Hisapp...
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="relative z-0 min-h-screen text-slate-800 flex flex-col font-sans">
      {/* Fixed, non-scrollable soothing gradient background (behind everything) */}
      <AppBackground />

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Floating frosted-glass header dock */}
      <Header
        settings={settings}
        isOnline={isOnline}
        backup={backupStatus}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onSyncNow={() => void backupEngine.backupNow()}
      />

      {/* Firebase setup banner — shown until the web config is pasted */}
      {!backupStatus.isConfigured && (
        <div className="w-full max-w-4xl mx-auto px-4 pt-3">
          <div className="ios-glass-subtle px-4 py-2.5 rounded-2xl bg-amber-50/60 border border-amber-200/70 text-[11px] text-amber-800 flex items-center gap-2">
            <span className="font-bold">Cloud backup not configured:</span>
            <span>
              paste your Firebase web app config into <code className="font-mono">src/config/firebase.ts</code> (see instructions in that file), then sign in from Settings.
            </span>
          </div>
        </div>
      )}

      {/* Main Content View with Tabs — the keyed wrapper replays the
          slide/fade transition every time the active tab changes. */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 pt-4 pb-36 sm:pt-6 sm:pb-40">
        <div key={activeTab} className={`tab-panel tab-panel--${tabDirection}`}>
          {activeTab === 'dashboard' && (
            <DashboardTab
              entries={entries}
              settlements={settlements}
              settings={settings}
              onNavigateTab={handleChangeTab}
            />
          )}

          {activeTab === 'entry' && (
            <EntryTab
              settings={settings}
              existingEntries={entries}
              onEntrySaved={handleEntrySaved}
              onEntryUpdated={handleEntryUpdated}
              onUpdateSettings={handleSettingsSaved}
              showToast={showToast}
            />
          )}

          {activeTab === 'records' && (
            <RecordsTab
              entries={entries}
              settings={settings}
              onEntryUpdated={handleEntryUpdated}
              onEntryDeleted={handleEntryDeleted}
              showToast={showToast}
            />
          )}

          {activeTab === 'settlement' && (
            <SettlementTab
              entries={entries}
              settlements={settlements}
              settings={settings}
              onSettlementCompleted={handleSettlementCompleted}
              onSettlementDeleted={handleSettlementDeleted}
              showToast={showToast}
            />
          )}
        </div>
      </main>

      {/* Fixed iOS Frosted Bottom Navigation Dock */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={handleChangeTab}
        pendingCount={pendingCount}
      />

      {/* Settings Glass Modal */}
      {isSettingsOpen && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          settings={settings}
          backup={backupStatus}
          onSaveSettings={handleSettingsSaved}
          onBackupSignIn={() => backupEngine.signIn()}
          onBackupSignOut={() => backupEngine.signOut()}
          onBackupNow={() => backupEngine.backupNow()}
          onRestoreFromDrive={() => backupEngine.restoreLatest()}
          onToggleAutoBackup={async (enabled) => {
            const updated = await saveSettings({ autoBackup: enabled });
            handleSettingsSaved(updated);
            if (enabled) backupEngine.onDataChanged();
          }}
          onDataImported={() => {
            void refreshData();
            backupEngine.onDataChanged();
          }}
          showToast={showToast}
        />
      )}

      {/* Digital Settlement Receipt Modal */}
      {receiptSettlement && (
        <SettlementReceiptModal
          settlement={receiptSettlement}
          settings={settings}
          onClose={() => setReceiptSettlement(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}
