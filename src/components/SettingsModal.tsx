import React, { useRef, useState } from 'react';
import {
  X,
  CloudUpload,
  Download,
  Upload,
  Building2,
  Sparkles,
  Save,
  LogIn,
  LogOut,
  RotateCcw,
  FileSpreadsheet,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { ClinicSettings } from '../types';
import {
  DEFAULT_CLINIC_LOGO,
  DEFAULT_CLINIC_NAME,
  exportAllDataCSV,
  exportAllDataJSON,
  logAudit,
  restoreAllData,
  saveSettings,
  syncAllPatientProfiles,
} from '../db/indexedDB';
import {
  ImportResult,
  parseCSVFiles,
  parseJSONBackup,
} from '../utils/importData';
import type { BackupStatus } from '../services/backupEngine';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { AuditLogModal } from './AuditLogModal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ClinicSettings;
  backup: BackupStatus;
  onSaveSettings: (settings: ClinicSettings) => void;
  onBackupSignIn: () => Promise<any>;
  onBackupSignOut: () => Promise<void>;
  onBackupNow: () => Promise<any>;
  onRestoreFromDrive: () => Promise<any>;
  onToggleAutoBackup: (enabled: boolean) => void;
  onDataImported?: () => void;
  showToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  backup,
  onSaveSettings,
  onBackupSignIn,
  onBackupSignOut,
  onBackupNow,
  onRestoreFromDrive,
  onToggleAutoBackup,
  onDataImported,
  showToast,
}) => {
  const [clinicName, setClinicName] = useState<string>(settings.clinicName || DEFAULT_CLINIC_NAME);
  const [clinicLogo, setClinicLogo] = useState<string>(settings.clinicLogo || DEFAULT_CLINIC_LOGO);
  const [doctorName, setDoctorName] = useState<string>(settings.doctorName);
  const [currencySymbol, setCurrencySymbol] = useState<string>(settings.currencySymbol || '৳');
  const [sharePercentage, setSharePercentage] = useState<number>(settings.sharePercentage || 40);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState<boolean>(false);

  // File import state (restore from JSON / CSV backup files)
  const [importConfirm, setImportConfirm] = useState<ImportResult | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  // Sync state when settings prop updates
  React.useEffect(() => {
    setClinicName(settings.clinicName || DEFAULT_CLINIC_NAME);
    setClinicLogo(settings.clinicLogo || DEFAULT_CLINIC_LOGO);
    setDoctorName(settings.doctorName);
    setCurrencySymbol(settings.currencySymbol || '৳');
    setSharePercentage(settings.sharePercentage || 40);
  }, [settings]);

  if (!isOpen) return null;

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Invalid File', 'Please select an image file (PNG, JPG, SVG, WebP)', 'warning');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('File Too Large', 'Please upload a logo under 5MB', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setClinicLogo(result);
        showToast('Logo Preview Loaded', 'Remember to tap Save Profile to keep changes', 'info');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleResetDefaultLogo = () => {
    setClinicLogo(DEFAULT_CLINIC_LOGO);
    showToast('Reset to Default', `${DEFAULT_CLINIC_NAME} logo restored`, 'info');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      const effectiveShare = Math.max(1, Math.min(100, Number(sharePercentage) || 40));
      const updated = await saveSettings({
        clinicName: clinicName.trim() || DEFAULT_CLINIC_NAME,
        clinicLogo: clinicLogo.trim() || DEFAULT_CLINIC_LOGO,
        doctorName: doctorName.trim(),
        currencySymbol: currencySymbol.trim() || '৳',
        sharePercentage: effectiveShare,
      });
      onSaveSettings(updated);
      showToast('Settings Saved', 'Clinic profile, share rate, and logo updated', 'success');
    } catch (err: any) {
      showToast('Failed to save', err?.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportJSON = async () => {
    try {
      const json = await exportAllDataJSON();
      const dateStr = new Date().toISOString().split('T')[0];
      downloadFile(json, `dental_income_tracker_backup_${dateStr}.json`, 'application/json');
      showToast('JSON Export Complete', 'All patient visits & settlements saved to disk', 'success');
    } catch (err: any) {
      showToast('Export Failed', err?.message, 'error');
    }
  };

  const handleExportCSV = async () => {
    try {
      const { patientEntriesCSV, settlementsCSV } = await exportAllDataCSV();
      const dateStr = new Date().toISOString().split('T')[0];
      downloadFile(
        patientEntriesCSV,
        `Patient_Entries_${dateStr}.csv`,
        'text/csv;charset=utf-8;'
      );
      setTimeout(() => {
        downloadFile(
          settlementsCSV,
          `Settlements_${dateStr}.csv`,
          'text/csv;charset=utf-8;'
        );
      }, 500);
      showToast('CSV Export Complete', 'Patient Entries and Settlements CSV downloaded', 'success');
    } catch (err: any) {
      showToast('Export Failed', err?.message, 'error');
    }
  };

  // ── File Import (restore from JSON / CSV backup) ─────────────────

  const handleImportFiles = async (files: FileList | null, kind: 'json' | 'csv') => {
    if (!files || files.length === 0) return;

    try {
      if (kind === 'json') {
        const text = await files[0].text();
        const result = parseJSONBackup(text, files[0].name);
        if (result.patientEntries.length === 0 && result.settlements.length === 0) {
          showToast('Nothing to Import', 'The selected JSON file has no patient entries or settlements', 'warning');
          return;
        }
        setImportConfirm(result);
      } else {
        const texts = await Promise.all(
          Array.from(files).map(async (f) => ({ name: f.name, text: await f.text() }))
        );
        const result = parseCSVFiles(texts);
        if (result.patientEntries.length === 0) {
          showToast(
            'Nothing to Import',
            'No valid patient entries found in the selected CSV file(s)',
            'warning'
          );
          return;
        }
        setImportConfirm(result);
      }
    } catch (err: any) {
      showToast('Import Failed', err?.message || 'Could not read the selected file', 'error');
    } finally {
      // Reset the input so the same file can be selected again
      if (kind === 'json' && jsonFileRef.current) jsonFileRef.current.value = '';
      if (kind === 'csv' && csvFileRef.current) csvFileRef.current.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!importConfirm) return;

    try {
      setIsImporting(true);

      // Safety net: download a snapshot of the CURRENT data before replacing it
      try {
        const json = await exportAllDataJSON();
        const dateStr = new Date().toISOString().split('T')[0];
        downloadFile(
          json,
          `dental_income_tracker_before_import_${dateStr}.json`,
          'application/json'
        );
      } catch (backupErr) {
        console.warn('Pre-import safety backup notice:', backupErr);
      }

      await restoreAllData({
        patientEntries: importConfirm.patientEntries,
        settlements: importConfirm.settlements,
        settings: importConfirm.settings,
      });
      // Rebuild patient profiles from the imported entries
      await syncAllPatientProfiles();
      await logAudit({
        action: 'DATA_IMPORTED',
        targetId: 'full_restore',
        targetType: 'patient_entry',
        details: `Imported ${importConfirm.patientEntries.length} visits and ${importConfirm.settlements.length} settlements from file (${importConfirm.source})${importConfirm.skippedRows > 0 ? ` — ${importConfirm.skippedRows} invalid rows skipped` : ''}. Previous device data was replaced.`,
      });

      showToast(
        'Import Complete',
        `Restored ${importConfirm.patientEntries.length} visits and ${importConfirm.settlements.length} settlements from ${importConfirm.source}`,
        'success'
      );
      setImportConfirm(null);
      onDataImported?.();
    } catch (err: any) {
      showToast('Import Failed', err?.message || 'Could not import the selected file', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  // Human-friendly timestamp for the backup status strip
  const formatBackupTime = (ts: number): string =>
    new Date(ts).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  // Persisted snapshot timestamp is the source of truth; engine value as fallback
  const lastBackupTs = settings.lastDriveSnapshotTimestamp ?? backup.lastBackupAt ?? null;
  const isSyncing = backup.phase === 'syncing';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in overflow-y-auto">
      <div className="ios-glass bg-white/95 rounded-3xl p-6 w-full max-w-xl shadow-2xl space-y-6 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Clinic &amp; Backup Settings</h3>
              <p className="text-xs text-slate-500">Account, Google Drive backup, branding &amp; profile</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section 0: Account & Google Drive Cloud Backup */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-sky-50/70 via-indigo-50/50 to-white border border-sky-100 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CloudUpload className="w-4 h-4 text-sky-600" />
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Account &amp; Google Drive Backup
              </h4>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                backup.phase === 'syncing'
                  ? 'bg-indigo-100 text-indigo-800'
                  : backup.user
                  ? 'bg-emerald-100 text-emerald-800'
                  : backup.isConfigured
                  ? 'bg-slate-100 text-slate-600'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {!backup.isConfigured
                ? 'Setup Needed'
                : backup.phase === 'syncing'
                ? 'Backing Up...'
                : backup.phase === 'error'
                ? 'Needs Attention'
                : backup.user
                ? 'Protected'
                : 'Backup Off'}
            </span>
          </div>

          {/* Cloud backup status strip: last successful backup + live progress */}
          {backup.isConfigured && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white/80 border border-white shadow-2xs">
                <div className="flex items-center gap-2 min-w-0">
                  {isSyncing ? (
                    <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin shrink-0" />
                  ) : backup.phase === 'error' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-slate-900 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      Last successful backup
                    </p>
                    <p className="text-[10.5px] text-slate-500 truncate">
                      {isSyncing
                        ? 'Backing up to Google Drive…'
                        : lastBackupTs
                        ? formatBackupTime(lastBackupTs)
                        : 'No cloud backup yet — tap "Backup to Drive Now" below'}
                    </p>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                    isSyncing
                      ? 'bg-indigo-100 text-indigo-800'
                      : backup.phase === 'error'
                      ? 'bg-rose-100 text-rose-800'
                      : backup.pendingChanges
                      ? 'bg-sky-100 text-sky-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {isSyncing
                    ? 'Syncing…'
                    : backup.phase === 'error'
                    ? 'Backup Error'
                    : backup.pendingChanges
                    ? 'Changes Pending'
                    : 'Up to Date'}
                </span>
              </div>

              {/* Indeterminate progress bar while a backup is running */}
              {isSyncing && (
                <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full w-1/3 rounded-full bg-indigo-500 animate-pulse" />
                </div>
              )}

              {backup.phase === 'error' && backup.error && (
                <p className="text-[10.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
                  {backup.error}
                </p>
              )}
            </div>
          )}

          {!backup.isConfigured ? (
            <p className="text-xs text-slate-600 leading-relaxed">
              Connect your Firebase project to enable Gmail sign-in and automatic Google Drive
              backup. Paste your web app config into{' '}
              <code className="text-[11px] font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 text-indigo-600">
                src/config/firebase.ts
              </code>{' '}
              — instructions are inside that file.
            </p>
          ) : !backup.user ? (
            <>
              <p className="text-xs text-slate-600 leading-relaxed">
                Sign in with your own Gmail account. Every entry is saved on this device
                (IndexedDB) <span className="font-semibold">and</span> backed up to your personal
                Google Drive in a private <span className="font-semibold">Hisapp_Backups/</span>{' '}
                folder — only Hisapp can read its own files there.
              </p>
              <button
                type="button"
                onClick={() => onBackupSignIn()}
                className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-semibold shadow-2xs flex items-center justify-center gap-2 active:scale-95 transition"
              >
                <svg className="w-4 h-4" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
                <span>Sign in with Google (Gmail)</span>
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/80 border border-white shadow-2xs">
                {backup.user.photoURL && (
                  <img
                    src={backup.user.photoURL}
                    alt={backup.user.name}
                    className="w-8 h-8 rounded-full border border-slate-200"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-900 truncate">{backup.user.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {backup.user.email}
                    {settings.lastDriveSnapshotTimestamp
                      ? ` · Last backup: ${new Date(settings.lastDriveSnapshotTimestamp).toLocaleString()}`
                      : ' · No backup yet'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onBackupSignOut()}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold flex items-center gap-1 active:scale-95 transition shrink-0"
                >
                  <LogOut className="w-3 h-3" />
                  Sign Out
                </button>
              </div>

              <label className="flex items-center justify-between p-2.5 rounded-xl bg-white/80 border border-white shadow-2xs cursor-pointer">
                <div>
                  <p className="text-xs font-bold text-slate-900">Automatic Cloud Backup</p>
                  <p className="text-[11px] text-slate-500">
                    Simultaneously back up to Google Drive after every change.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.autoBackup !== false}
                  onClick={() => onToggleAutoBackup(!(settings.autoBackup !== false))}
                  className={`relative w-10 h-5.5 rounded-full transition-colors shrink-0 ${
                    settings.autoBackup !== false ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                  style={{ height: '22px' }}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${
                      settings.autoBackup !== false ? 'translate-x-[18px]' : ''
                    }`}
                  />
                </button>
              </label>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onBackupNow()}
                  disabled={backup.phase === 'syncing'}
                  className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition disabled:opacity-60"
                >
                  <CloudUpload className={`w-3.5 h-3.5 ${backup.phase === 'syncing' ? 'animate-pulse' : ''}`} />
                  <span>{backup.phase === 'syncing' ? 'Backing Up...' : 'Backup to Drive Now'}</span>
                </button>
                {settings.ledgerSpreadsheetId && (
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${settings.ledgerSpreadsheetId}/edit`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 hover:bg-emerald-100 transition"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Open Ledger Sheet</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Restore your latest Google Drive backup? This replaces the data currently on this device with your cloud copy.'
                      )
                    ) {
                      onRestoreFromDrive();
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore from Drive</span>
                </button>
                {backup.pendingChanges && (
                  <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-1 rounded-full">
                    Changes queued for cloud backup…
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Section 1: Clinic & Doctor Profile */}
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Doctor &amp; Clinic Identity
            </h4>
            <span className="text-[10px] text-slate-400">Customizable Branding</span>
          </div>

          {/* Clinic Logo Customization */}
          <div className="p-3.5 rounded-2xl bg-slate-50/80 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-700">Clinic Brand Logo</label>
              <button
                type="button"
                onClick={handleResetDefaultLogo}
                className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 transition"
              >
                Reset to Default
              </button>
            </div>

            <div className="flex items-center gap-3.5">
              {/* Logo Preview */}
              <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center justify-center overflow-hidden p-1 shrink-0">
                {clinicLogo ? (
                  <img
                    src={clinicLogo}
                    alt="Clinic Logo Preview"
                    className="w-full h-full object-contain rounded-xl"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Building2 className="w-6 h-6 text-slate-400" />
                )}
              </div>

              {/* Upload Controls */}
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold cursor-pointer active:scale-95 transition inline-flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Image</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoFileUpload}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setClinicLogo('/applogo.png');
                      showToast('App Launcher Logo Selected', 'Set to app launcher icon', 'info');
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                  >
                    Use App Logo
                  </button>
                  <span className="text-[10px] text-slate-400">PNG, JPG, SVG, WebP</span>
                </div>
                <input
                  type="text"
                  placeholder="Or enter logo URL (e.g. /applogo.png)..."
                  value={clinicLogo}
                  onChange={(e) => setClinicLogo(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-[11px] text-slate-800 outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">Clinic Name</label>
              <input
                type="text"
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                placeholder={DEFAULT_CLINIC_NAME}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 outline-none focus:border-indigo-500 font-semibold"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">Doctor Name</label>
              <input
                type="text"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="Filled from your Google sign-in"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 outline-none focus:border-indigo-500 font-semibold"
              />
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                Left empty until you sign in with your own Gmail — no account is pre-loaded.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">
                Currency Symbol
              </label>
              <input
                type="text"
                value={currencySymbol}
                onChange={(e) => setCurrencySymbol(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 outline-none focus:border-indigo-500"
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-700">
                  Doctor's Share Rate (%)
                </label>
                <span className="text-[10px] text-slate-400">Default: 40%</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={sharePercentage}
                  onChange={(e) =>
                    setSharePercentage(
                      Math.max(1, Math.min(100, parseFloat(e.target.value) || 0))
                    )
                  }
                  className="w-full px-3 py-2 pr-8 rounded-xl border border-slate-200 text-xs font-bold text-indigo-700 outline-none focus:border-indigo-500 bg-white"
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  %
                </span>
              </div>
              {/* Quick rate presets */}
              <div className="flex items-center gap-1.5 mt-1.5">
                {[30, 40, 50, 60].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setSharePercentage(rate)}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold transition ${
                      sharePercentage === rate
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {rate}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 active:scale-95 text-white text-xs font-bold transition flex items-center justify-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Profile Changes'}</span>
          </button>
        </form>

        {/* Section 2: Audit Trail & Emergency Backups */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Backups &amp; Data Safety
          </h4>

          {/* Internal Financial Audit Trail */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
            <div>
              <h5 className="text-xs font-bold text-slate-900">Financial Audit Trail</h5>
              <p className="text-[11px] text-slate-500">
                Tamper-resistant log tracking when records were created, edited, or deleted.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAuditModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold active:scale-95 transition shrink-0 shadow-xs"
            >
              View Audit Log
            </button>
          </div>

          {/* Emergency Local Files Export */}
          <div>
            <span className="text-[11px] font-bold text-slate-700 block mb-1">
              Emergency Local Downloads (Offline)
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleExportJSON}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95"
              >
                <Download className="w-3.5 h-3.5 text-indigo-600" />
                <span>Export JSON Backup</span>
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600" />
                <span>Export CSV (2 Sheets)</span>
              </button>
            </div>
          </div>

          {/* Restore from File (JSON / CSV import) */}
          <div>
            <span className="text-[11px] font-bold text-slate-700 block mb-1">
              Restore from File (Import)
            </span>
            <p className="text-[10.5px] text-slate-500 mb-2 leading-relaxed">
              Replace this device's data with a backup file (e.g. on a new phone). Your current
              data is downloaded as a safety copy automatically before anything is replaced.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Import JSON Backup</span>
                <input
                  ref={jsonFileRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => handleImportFiles(e.target.files, 'json')}
                  className="hidden"
                />
              </label>
              <label className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Import CSV Files</span>
                <input
                  ref={csvFileRef}
                  type="file"
                  accept=".csv,text/csv"
                  multiple
                  onChange={(e) => handleImportFiles(e.target.files, 'csv')}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              CSV import: select the exported Patient_Entries CSV (and optionally the Settlements
              CSV) together.
            </p>
          </div>

          {/* Import Confirmation Panel (shown after a file is parsed) */}
          {importConfirm && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 space-y-2.5 animate-in fade-in">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <p className="font-bold text-rose-900">Replace all data on this device?</p>
                  <p className="text-rose-800">
                    The file <strong>{importConfirm.source}</strong> contains{' '}
                    <strong>{importConfirm.patientEntries.length} visits</strong> and{' '}
                    <strong>{importConfirm.settlements.length} settlements</strong>
                    {importConfirm.skippedRows > 0
                      ? ` (${importConfirm.skippedRows} invalid rows skipped)`
                      : ''}
                    . Current records will be replaced. A safety backup of the current data
                    downloads first.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setImportConfirm(null)}
                  disabled={isImporting}
                  className="flex-1 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={isImporting}
                  className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-70"
                >
                  {isImporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>{isImporting ? 'Importing…' : 'Import & Replace'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Progressive Web App Install */}
        <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <img
              src="/applogo.png"
              alt="Hisapp Launcher Logo"
              className="w-7 h-7 rounded-lg object-contain shadow-xs border border-slate-200 bg-white"
            />
            <div>
              <h5 className="text-xs font-bold text-slate-900">Install as Mobile App (PWA)</h5>
              <p className="text-[11px] text-slate-500">
                Works 100% offline from your home screen.
              </p>
            </div>
          </div>

          {isInstalled ? (
            <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
              Installed
            </span>
          ) : isInstallable ? (
            <button
              onClick={install}
              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold active:scale-95 transition"
            >
              Install
            </button>
          ) : isIOS ? (
            <button
              onClick={() => setShowIOSPrompt(true)}
              className="px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold active:scale-95 transition"
            >
              iOS Guide
            </button>
          ) : (
            <span className="text-[11px] text-slate-400">PWA Active</span>
          )}
        </div>

        {/* iOS Install Prompt Modal */}
        {showIOSPrompt && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60">
            <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-3">
              <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
                <img
                  src="/applogo.png"
                  alt="Hisapp"
                  className="w-10 h-10 rounded-xl object-contain border border-slate-200 shadow-xs"
                />
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Install Hisapp on iPhone / iPad</h4>
                  <p className="text-[11px] text-slate-500">Add to your Home Screen</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                1. Tap the <strong>Share</strong> icon (box with upward arrow) in the Safari toolbar.<br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.<br />
                3. Tap <strong>Add</strong> at top right.
              </p>
              <button
                onClick={() => setShowIOSPrompt(false)}
                className="w-full py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Financial Audit Trail Modal */}
        {isAuditModalOpen && (
          <AuditLogModal
            isOpen={isAuditModalOpen}
            onClose={() => setIsAuditModalOpen(false)}
            showToast={showToast}
          />
        )}
      </div>
    </div>
  );
};
