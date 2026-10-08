import React, { useState } from 'react';
import {
  X,
  Cloud,
  Download,
  Upload,
  User,
  Building2,
  DollarSign,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Smartphone,
  Save,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { ClinicSettings } from '../types';
import { SyncStatus } from '../services/googleSheets';
import {
  exportAllDataCSV,
  exportAllDataJSON,
  saveSettings,
} from '../db/indexedDB';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { AuditLogModal } from './AuditLogModal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ClinicSettings;
  syncStatus: SyncStatus;
  onSaveSettings: (settings: ClinicSettings) => void;
  onGoogleSignIn: (clientId?: string) => Promise<void>;
  onTriggerSync: () => void;
  onTriggerSnapshot?: () => Promise<void>;
  showToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  syncStatus,
  onSaveSettings,
  onGoogleSignIn,
  onTriggerSync,
  onTriggerSnapshot,
  showToast,
}) => {
  const [clinicName, setClinicName] = useState<string>(settings.clinicName || 'Yashfin Dental Care');
  const [clinicLogo, setClinicLogo] = useState<string>(settings.clinicLogo || '/dlogo.png');
  const [doctorName, setDoctorName] = useState<string>(settings.doctorName);
  const [currencySymbol, setCurrencySymbol] = useState<string>(settings.currencySymbol || '৳');
  const [sharePercentage, setSharePercentage] = useState<number>(settings.sharePercentage || 40);
  const [googleClientId, setGoogleClientId] = useState<string>(settings.googleClientId || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [isTakingSnapshot, setIsTakingSnapshot] = useState<boolean>(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState<boolean>(false);

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  // Sync state when settings prop updates
  React.useEffect(() => {
    setClinicName(settings.clinicName || 'Yashfin Dental Care');
    setClinicLogo(settings.clinicLogo || '/dlogo.png');
    setDoctorName(settings.doctorName);
    setCurrencySymbol(settings.currencySymbol || '৳');
    setSharePercentage(settings.sharePercentage || 40);
    setGoogleClientId(settings.googleClientId || '');
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
    setClinicLogo('/dlogo.png');
    showToast('Reset to Default', 'Yashfin Dental Care logo restored', 'info');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      const effectiveShare = Math.max(1, Math.min(100, Number(sharePercentage) || 40));
      const updated = await saveSettings({
        clinicName: clinicName.trim() || 'Yashfin Dental Care',
        clinicLogo: clinicLogo.trim() || '/dlogo.png',
        doctorName: doctorName.trim(),
        currencySymbol: currencySymbol.trim() || '৳',
        sharePercentage: effectiveShare,
        googleClientId: googleClientId.trim(),
      });
      onSaveSettings(updated);
      showToast('Settings Saved', 'Clinic profile, share rate, and logo updated', 'success');
    } catch (err: any) {
      showToast('Failed to save', err?.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGoogleConnect = async () => {
    try {
      setIsSigningIn(true);
      await onGoogleSignIn(googleClientId.trim());
      showToast('Google Account Connected', 'Ready to synchronize with Google Drive and Sheets', 'success');
    } catch (err: any) {
      showToast('Google Connection Issue', err?.message || 'Check OAuth credentials or popup blocker', 'error');
    } finally {
      setIsSigningIn(false);
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

  const handleManualSnapshot = async () => {
    if (!onTriggerSnapshot) return;
    try {
      setIsTakingSnapshot(true);
      await onTriggerSnapshot();
    } finally {
      setIsTakingSnapshot(false);
    }
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
              <h3 className="text-base font-bold text-slate-900">Clinic &amp; Sync Settings</h3>
              <p className="text-xs text-slate-500">Google Drive, offline backups &amp; profile</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section 1: Google Drive & Sheets Integration */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50/70 via-sky-50/50 to-white border border-indigo-100 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-sky-600" />
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Google Workspace Cloud Sync
              </h4>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                syncStatus.isConnected
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {syncStatus.isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Automatically synchronizes records to your personal Google Spreadsheet{' '}
            <code className="text-[11px] font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 text-indigo-600">
              Dental_Income_Tracker
            </code>{' '}
            with dedicated <span className="font-semibold">Patient_Entries</span> and{' '}
            <span className="font-semibold">Settlements</span> sheets.
          </p>

          {syncStatus.user && (
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/80 border border-white shadow-2xs">
              {syncStatus.user.picture && (
                <img
                  src={syncStatus.user.picture}
                  alt={syncStatus.user.name}
                  className="w-8 h-8 rounded-full"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 truncate">{syncStatus.user.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{syncStatus.user.email}</p>
              </div>
            </div>
          )}

          {/* Google Client ID override */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
              <span>Google OAuth 2.0 Client ID (Optional custom)</span>
              <span className="text-[10px] font-normal text-slate-400">console.cloud.google.com</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 123456789-xxxx.apps.googleusercontent.com"
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleGoogleConnect}
              disabled={isSigningIn}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-semibold shadow-2xs flex items-center gap-2 active:scale-95 transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
              </svg>
              <span>{isSigningIn ? 'Connecting...' : syncStatus.isConnected ? 'Switch Google Account' : 'Sign in with Google'}</span>
            </button>

            {syncStatus.isConnected && (
              <button
                onClick={onTriggerSync}
                disabled={syncStatus.isSyncing}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncStatus.isSyncing ? 'animate-spin' : ''}`} />
                <span>{syncStatus.isSyncing ? 'Syncing...' : 'Sync Now'}</span>
              </button>
            )}

            {syncStatus.spreadsheetUrl && (
              <a
                href={syncStatus.spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1 hover:bg-emerald-100 transition"
              >
                <span>Open in Sheets</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Section 2: Clinic & Doctor Profile */}
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
                Reset to Default (Yashfin)
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
                placeholder="Yashfin Dental Care"
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
                placeholder="Dr. MBR"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 outline-none focus:border-indigo-500 font-semibold"
                required
              />
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

        {/* Section 3: Cloud Snapshot, Audit Trail & Emergency Backups */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Cloud Snapshots &amp; Data Safety
          </h4>

          {/* Dedicated Google Drive Snapshot in Hisapp_Backups/ */}
          <div className="p-3.5 rounded-2xl bg-indigo-50/60 border border-indigo-100 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-900">
                  Weekly Drive Auto-Snapshot
                </span>
              </div>
              <span className="text-[10px] font-semibold text-indigo-700 bg-white px-2 py-0.5 rounded-full border border-indigo-200">
                Folder: Hisapp_Backups/
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Automated snapshot archives your entire clinical database (patients, settlements, and audit logs) to your private Google Drive every 7 days.
            </p>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-slate-400">
                {settings.lastDriveSnapshotTimestamp
                  ? `Last Snapshot: ${new Date(settings.lastDriveSnapshotTimestamp).toLocaleString()}`
                  : 'Status: Weekly schedule ready'}
              </span>
              <button
                type="button"
                onClick={handleManualSnapshot}
                disabled={isTakingSnapshot}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold active:scale-95 transition flex items-center gap-1.5 disabled:opacity-60 shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTakingSnapshot ? 'animate-spin' : ''}`} />
                <span>{isTakingSnapshot ? 'Saving Snapshot...' : 'Backup to Drive Now'}</span>
              </button>
            </div>
          </div>

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
        </div>

        {/* Section 4: Progressive Web App Install */}
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
