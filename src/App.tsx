import React, { useState, useEffect, useCallback } from 'react';
import { ClinicSettings, PatientEntry, Settlement, TabType, ToastMessage } from './types';
import {
  DEFAULT_SETTINGS,
  getAllPatientEntries,
  getAllSettlements,
  getSettings,
  seedDemoDataIfEmpty,
} from './db/indexedDB';
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

  // Entry saved callback
  const handleEntrySaved = (newEntry: PatientEntry) => {
    setEntries((prev) => [newEntry, ...prev]);
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
        isOnline={isOnline}
        onOpenSettings={() => setIsSettingsOpen(true)}
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

      {/* Settings Glass Modal */}
      {isSettingsOpen && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          settings={settings}
          onSaveSettings={(newSettings) => setSettings(newSettings)}
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
