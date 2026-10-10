import React, { useEffect, useState } from 'react';
import { Cloud, CloudOff, LogIn, RefreshCw, Settings, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { ClinicSettings } from '../types';
import type { BackupStatus } from '../services/backupEngine';
import { InstallAppButton } from './InstallAppButton';

interface HeaderProps {
  settings: ClinicSettings;
  isOnline: boolean;
  backup: BackupStatus;
  onOpenSettings: () => void;
  /** One-tap cloud vault sync */
  onSyncNow: () => void;
}

function formatRelativeTime(ts: number | null): string {
  if (!ts) return 'Never';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function BackupPill({
  backup,
  isOnline,
  onSyncNow,
}: {
  backup: BackupStatus;
  isOnline: boolean;
  onSyncNow: () => void;
}) {
  const { phase, isConfigured } = backup;
  const pillBase =
    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all active:scale-95';

  if (!isConfigured) {
    return (
      <button
        type="button"
        onClick={onSyncNow}
        className={`${pillBase} hidden sm:flex bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200/70 cursor-pointer`}
        title="Firebase config needed"
        aria-label="Sync cloud data"
      >
        <CloudOff className="w-3.5 h-3.5" />
        <span>Local Only</span>
      </button>
    );
  }

  if (phase === 'syncing') {
    return (
      <button
        type="button"
        onClick={onSyncNow}
        disabled
        className={`${pillBase} bg-indigo-50 text-indigo-700 border border-indigo-200 disabled:opacity-80 cursor-default`}
        title="Syncing records with Cloud Firestore..."
      >
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span className="hidden sm:inline">Syncing...</span>
      </button>
    );
  }

  if (phase === 'error') {
    return (
      <button
        type="button"
        onClick={onSyncNow}
        className={`${pillBase} bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 cursor-pointer`}
        title={`${backup.error || 'Cloud sync error'} — tap to retry`}
      >
        <ShieldAlert className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Sync Issue</span>
      </button>
    );
  }

  if (phase === 'signed-out') {
    return (
      <button
        type="button"
        onClick={onSyncNow}
        className={`${pillBase} bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200/70 cursor-pointer`}
        title={isOnline ? 'Tap to open Cloud Vault login' : 'Working offline in local storage'}
        aria-label="Cloud vault off"
      >
        <CloudOff className="w-3.5 h-3.5 text-slate-400" />
        <span className="hidden sm:inline">Vault Off</span>
      </button>
    );
  }

  // Signed into vault (idle / synced)
  return (
    <button
      type="button"
      onClick={onSyncNow}
      className={`${pillBase} border cursor-pointer hover:brightness-95 ${
        backup.pendingChanges
          ? 'bg-sky-500/10 text-sky-700 border-sky-400/30 hover:bg-sky-500/20'
          : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 hover:bg-emerald-500/20'
      }`}
      title={
        backup.pendingChanges
          ? `${backup.pendingCount} change(s) waiting to sync — tap to sync now`
          : backup.lastBackupAt
          ? `Synced to Cloud Firestore on ${new Date(backup.lastBackupAt).toLocaleTimeString()} — tap to sync again`
          : 'Vault connected — tap to sync'
      }
    >
      <Cloud className={`w-3.5 h-3.5 ${backup.pendingChanges ? 'text-sky-600' : 'text-emerald-600'}`} />
      <span className="hidden sm:inline">
        {backup.pendingChanges ? 'Sync Queued' : 'Vault Synced'}
      </span>
    </button>
  );
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  isOnline,
  backup,
  onOpenSettings,
  onSyncNow,
}) => {
  const [, setNow] = useState<number>(Date.now());

  // Tick every second so "4s ago", "5s ago" updates smoothly
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const displayName = settings.doctorName?.trim() || (backup.user ? `Dr. (${backup.user.phoneNumber.slice(-4)})` : '');

  return (
    <header className="sticky top-0 z-40 w-full px-2.5 pt-1 pb-1 pointer-events-none">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 rounded-[22px] ios-glass-nav px-3 py-0.5 pointer-events-auto">
        {/* Left: Clinic Logo + Doctor / Clinic Info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full logo-ring p-[1.5px] shadow-sm shadow-indigo-500/20">
            <div className="w-full h-full rounded-full bg-white/95 backdrop-blur-md flex items-center justify-center overflow-hidden p-0.5">
              {settings.clinicLogo ? (
                <img
                  src={settings.clinicLogo}
                  alt={settings.clinicName || 'Clinic Logo'}
                  className="w-full h-full object-contain rounded-full"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="w-6 h-6 text-indigo-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2C8.5 2 6 4.5 6 8c0 3 1.2 5.5 2.5 9.5C9.5 20.5 10.5 22 12 22s2.5-1.5 3.5-4.5C16.8 13.5 18 11 18 8c0-3.5-2.5-6-6-6z" />
                  <path d="M10 8h4" />
                  <path d="M12 6v4" />
                </svg>
              )}
            </div>
          </div>

          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-wider uppercase text-indigo-600/90 truncate">
              {settings.clinicName || 'Dental Care Clinic'}
            </p>
            {displayName ? (
              <h1
                className="text-base sm:text-lg font-bold text-slate-900 tracking-tight leading-tight truncate"
                title={displayName}
              >
                {displayName}
              </h1>
            ) : (
              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 -ml-2 rounded-full text-[11px] font-bold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 active:scale-95 transition"
                title="Open Settings to add Doctor Name"
              >
                <LogIn className="w-3 h-3" />
                <span>Add Doctor Name</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Install App, Backup Pill, Last Sync Text, Online Pill, Settings Button */}
        <div className="flex items-center gap-2 shrink-0">
          <InstallAppButton />

          {/* Live Online/Offline Status Pill */}
          <div
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-md transition-colors ${
              isOnline
                ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-700 border-rose-500/20'
            }`}
            title={isOnline ? 'Network Online' : 'Offline Mode (Local Storage Active)'}
          >
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-rose-600" />
            )}
            <span>{isOnline ? 'Online' : 'Offline'}</span>
          </div>

          {/* Cloud Firestore Vault Status */}
          <BackupPill backup={backup} isOnline={isOnline} onSyncNow={onSyncNow} />

          {/* Last Sync Indicator (Positioned between Cloud Sync and Settings Button) */}
          <div
            className="flex flex-col items-center justify-center px-1 py-0.5 leading-tight shrink-0 select-none text-center"
            title={backup.lastBackupAt ? `Latest cloud backup: ${new Date(backup.lastBackupAt).toLocaleString()}` : 'No cloud backup yet'}
          >
            <span className="text-[8.5px] font-bold uppercase tracking-wider text-slate-400">
              Last Sync
            </span>
            <span className="text-[10px] font-extrabold text-indigo-600 mt-0.5 font-mono">
              {formatRelativeTime(backup.lastBackupAt)}
            </span>
          </div>

          {/* Settings / Vault Button */}
          <div className="relative shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full logo-ring p-[1.5px] shadow-sm shadow-indigo-500/20">
            <button
              onClick={onOpenSettings}
              className="w-full h-full rounded-full bg-white/95 backdrop-blur-md flex items-center justify-center overflow-hidden p-0.5 text-slate-700 hover:text-indigo-600 active:scale-90 transition-all duration-150"
              aria-label="Settings and Profile"
            >
              {backup.user ? (
                <span
                  className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-indigo-600 to-sky-500 text-white text-[11px] font-bold rounded-full"
                  title={`Vault: ${backup.user.phoneNumber}`}
                >
                  {backup.user.phoneNumber.slice(-2)}
                </span>
              ) : (
                <Settings className="w-5 h-5 text-slate-600" />
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
