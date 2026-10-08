import React, { useState, useEffect, useCallback } from 'react';
import { ClinicSettings, PatientEntry, Settlement, TabType, ToastMessage } from './types';
import {
  DEFAULT_SETTINGS,
  getAllPatientEntries,
  getAllSettlements,
  getSettings,
  saveSettings,
  seedDemoDataIfEmpty,
} from './db/indexedDB';
import {
  fetchGoogleUserProfile,
  getOrCreateSpreadsheet,
  initGoogleAuth,
  requestGoogleSignIn,
  syncLocalDataToGoogleSheet,
  SyncStatus,
  GOOGLE_CLIENT_ID,
  getCachedToken,
} from './services/googleSheets';
import {
  createDriveSnapshot,
  checkAndRunWeeklyAutoSnapshot,
} from './services/googleDriveSnapshot';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { DashboardTab } from './components/DashboardTab';
import { EntryTab } from './components/EntryTab';
import { SettlementTab } from './components/SettlementTab';
import { HistoryTab } from './components/HistoryTab';
import { SettingsModal } from './components/SettingsModal';
import { SettlementReceiptModal } from './components/SettlementReceiptModal';
import { ToastContainer } from './components/Toast';

export default function App() {
  const isOnline = useOnlineStatus();

  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [entries, setEntries] = useState<PatientEntry[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settings, setSettings] = useState<ClinicSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [receiptSettlement, setReceiptSettlement] = useState<Settlement | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isConnected: false,
    isSyncing: false,
    lastSynced: null,
    spreadsheetId: null,
    spreadsheetUrl: null,
    user: null,
    error: null,
    pendingCount: 0,
  });

  // Toast dispatch helper
  const showToast = useCallback(
    (title: string, desc?: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      setToasts((prev) => [...prev, { id, title, description: desc, type }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Load all initial data from IndexedDB
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

      const unsyncedCount =
        allEntries.filter((e) => !e.synced).length +
        allSettlements.filter((s) => !s.synced).length;

      setSyncStatus((prev) => ({
        ...prev,
        pendingCount: unsyncedCount,
        lastSynced: appSettings.lastSyncTimestamp || null,
        spreadsheetId: appSettings.spreadsheetId || null,
        spreadsheetUrl: appSettings.spreadsheetId
          ? `https://docs.google.com/spreadsheets/d/${appSettings.spreadsheetId}/edit`
          : null,
      }));
    } catch (err) {
      console.error('Failed to load local database:', err);
    }
  }, []);

  // Initial load & seed
  useEffect(() => {
    async function init() {
      try {
        await seedDemoDataIfEmpty();
        await refreshData();
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [refreshData]);

  // Register service worker if available in browser for offline PWA functionality
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => reg.update())
        .catch((err) => console.log('SW registration note:', err));
    }
  }, []);

  // Trigger Google Drive & Sheets Sync
  const handleTriggerSync = useCallback(
    async (tokenOverride?: string) => {
      if (!isOnline) {
        showToast('Device Offline', 'Cannot sync while offline. All changes are saved locally.', 'warning');
        return;
      }

      setSyncStatus((prev) => ({ ...prev, isSyncing: true, error: null }));

      try {
        let token = tokenOverride;
        if (!token) {
          // If we have no cached token, prompt sign-in
          token = await requestGoogleSignIn(settings.googleClientId);
        }

        // 1. Get or create spreadsheet
        const sheetInfo = await getOrCreateSpreadsheet(token);

        // Update settings if spreadsheetId changed
        if (sheetInfo.spreadsheetId !== settings.spreadsheetId) {
          const updatedSettings = await saveSettings({
            spreadsheetId: sheetInfo.spreadsheetId,
          });
          setSettings(updatedSettings);
        }

        // 2. Push data to sheets
        const result = await syncLocalDataToGoogleSheet(token, sheetInfo.spreadsheetId);

        // 3. Mark last synced time
        const now = Date.now();
        await saveSettings({ lastSyncTimestamp: now });

        setSyncStatus((prev) => ({
          ...prev,
          isConnected: true,
          isSyncing: false,
          lastSynced: now,
          spreadsheetId: sheetInfo.spreadsheetId,
          spreadsheetUrl: sheetInfo.url,
          pendingCount: 0,
        }));

        await refreshData();
        showToast(
          'Google Sheets Synchronized!',
          `Uploaded ${result.syncedPatients} patient entries and ${result.syncedSettlements} settlements.`,
          'success'
        );
      } catch (err: any) {
        console.error('Sync failed:', err);
        setSyncStatus((prev) => ({
          ...prev,
          isSyncing: false,
          error: err?.message || 'Sync failed',
        }));
        showToast('Sync Failed', err?.message || 'Please verify Google permissions', 'error');
      }
    },
    [isOnline, settings.googleClientId, settings.spreadsheetId, refreshData, showToast]
  );

  // Background Sync & Snapshot: Automatically push pending records or run weekly auto-snapshot
  useEffect(() => {
    if (isOnline && syncStatus.isConnected) {
      const token = getCachedToken();
      if (token) {
        if (syncStatus.pendingCount > 0 && settings.autoSync) {
          handleTriggerSync(token).catch((err) => {
            console.warn('Background auto-sync on reconnect error:', err);
          });
        }
        // Check weekly Google Drive auto-snapshot in Hisapp_Backups/
        checkAndRunWeeklyAutoSnapshot(token)
          .then((didRun) => {
            if (didRun) {
              getSettings().then(setSettings);
              showToast('Weekly Snapshot Saved', 'Backed up clinical database to Hisapp_Backups/ on Google Drive', 'info');
            }
          })
          .catch((err) => console.warn('Weekly auto-snapshot check notice:', err));
      }
    }
  }, [isOnline, syncStatus.isConnected, syncStatus.pendingCount, settings.autoSync, handleTriggerSync, showToast]);

  // Manual Trigger Snapshot handler
  const handleTriggerSnapshot = useCallback(async () => {
    if (!isOnline) {
      showToast('Offline', 'Cannot create Google Drive snapshot while offline.', 'warning');
      return;
    }
    try {
      let token = getCachedToken();
      if (!token) {
        token = await requestGoogleSignIn(settings.googleClientId);
      }
      const res = await createDriveSnapshot(token);
      const updated = await getSettings();
      setSettings(updated);
      showToast(
        'Drive Snapshot Uploaded!',
        `Saved "${res.fileName}" to Google Drive folder "${res.folderName}" with ${res.totalEntries} visits.`,
        'success'
      );
    } catch (err: any) {
      console.error('Snapshot failed:', err);
      showToast('Snapshot Failed', err?.message || 'Failed to backup to Google Drive', 'error');
    }
  }, [isOnline, settings.googleClientId, showToast]);

  // Google Sign In handler
  const handleGoogleSignIn = async (clientId?: string) => {
    try {
      const token = await requestGoogleSignIn(clientId);
      const userProfile = await fetchGoogleUserProfile(token);

      // Auto update doctor name from Google profile if default
      if (userProfile.name) {
        const updated = await saveSettings({
          doctorName: userProfile.name,
          doctorEmail: userProfile.email,
          doctorPhoto: userProfile.picture,
        });
        setSettings(updated);
      }

      setSyncStatus((prev) => ({
        ...prev,
        isConnected: true,
        user: userProfile,
      }));

      // Initiate initial sync
      await handleTriggerSync(token);
    } catch (err: any) {
      console.error('Google Sign In failed:', err);
      throw err;
    }
  };

  // Entry saved callback
  const handleEntrySaved = (newEntry: PatientEntry) => {
    setEntries((prev) => [newEntry, ...prev]);
    // Try background sync if connected and online
    if (isOnline && syncStatus.isConnected && settings.autoSync) {
      handleTriggerSync().catch(() => {});
    }
  };

  // Settlement completed callback
  const handleSettlementCompleted = (settlement: Settlement) => {
    setSettlements((prev) => [settlement, ...prev]);
    // Mark settled entries locally in state
    setEntries((prev) =>
      prev.map((e) =>
        settlement.patientIds.includes(e.id)
          ? { ...e, settlementStatus: 'Settled', settlementId: settlement.settlementId }
          : e
      )
    );
    setReceiptSettlement(settlement);

    if (isOnline && syncStatus.isConnected && settings.autoSync) {
      handleTriggerSync().catch(() => {});
    }
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
  };

  const handleEntryUpdated = (updatedEntry: PatientEntry) => {
    setEntries((prev) => prev.map((e) => (e.id === updatedEntry.id ? updatedEntry : e)));
  };

  const handleEntryDeleted = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const pendingCount = entries.filter((e) => e.settlementStatus === 'Pending').length;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F7FC]">
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
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F4F7FC] via-[#EBF1FA] to-[#FDFBFE] text-slate-800 flex flex-col font-sans">
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Fixed Frosted-Glass Header */}
      <Header
        settings={settings}
        syncStatus={syncStatus}
        isOnline={isOnline}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onTriggerSync={() => handleTriggerSync()}
      />

      {/* Main Content View with Tabs */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 pt-4 sm:pt-6">
        {activeTab === 'dashboard' && (
          <DashboardTab
            entries={entries}
            settlements={settlements}
            settings={settings}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        )}

        {activeTab === 'entry' && (
          <EntryTab
            settings={settings}
            existingEntries={entries}
            onEntrySaved={handleEntrySaved}
            onUpdateSettings={(newSettings) => setSettings(newSettings)}
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

        {activeTab === 'history' && (
          <HistoryTab
            entries={entries}
            settings={settings}
            onEntryUpdated={handleEntryUpdated}
            onEntryDeleted={handleEntryDeleted}
            showToast={showToast}
          />
        )}
      </main>

      {/* Fixed iOS Frosted Bottom Navigation Dock */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        pendingCount={pendingCount}
      />

      {/* Settings & Drive Sync Glass Modal */}
      {isSettingsOpen && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          settings={settings}
          syncStatus={syncStatus}
          onSaveSettings={(newSettings) => setSettings(newSettings)}
          onGoogleSignIn={handleGoogleSignIn}
          onTriggerSync={() => handleTriggerSync()}
          onTriggerSnapshot={handleTriggerSnapshot}
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
