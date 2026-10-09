import React, { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, Settings, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { ClinicSettings } from '../types';
import type { BackupStatus } from '../services/backupEngine';
import { InstallAppButton } from './InstallAppButton';

interface HeaderProps {
  settings: ClinicSettings;
  isOnline: boolean;
  backup: BackupStatus;
  onOpenSettings: () => void;
}

function BackupPill({ backup, isOnline }: { backup: BackupStatus; isOnline: boolean }) {
  const { phase, isConfigured } = backup;

  if (!isConfigured) {
    return (
      <div
        className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200"
        title="Cloud backup not configured — add your Firebase web config in src/config/firebase.ts"
      >
        <CloudOff className="w-3.5 h-3.5" />
        <span>Local Only</span>
      </div>
    );
  }

  if (phase === 'syncing') {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
        title="Backing up to your Google Drive..."
      >
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span className="hidden sm:inline">Backing Up...</span>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
        title={backup.error || 'Cloud backup issue — open Settings'}
      >
        <ShieldAlert className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Backup Issue</span>
      </div>
    );
  }

  if (phase === 'signed-out') {
    return (
      <button
        onClick={() => {}}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200/70 active:scale-95 transition-all"
        title="Sign in from Settings to enable Google Drive cloud backup"
      >
        <CloudOff className="w-3.5 h-3.5 text-slate-400" />
        <span className="hidden sm:inline">Backup Off</span>
      </button>
    );
  }

  // Signed in (idle / synced)
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        backup.pendingChanges
          ? 'bg-sky-500/10 text-sky-700 border-sky-400/30'
          : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
      }`}
      title={
        backup.pendingChanges
          ? 'Changes queued — backing up to your Google Drive shortly'
          : backup.lastBackupAt
          ? `Backed up to your Google Drive on ${new Date(backup.lastBackupAt).toLocaleString()}`
          : 'Signed in — your data is protected'
      }
    >
      <Cloud className={`w-3.5 h-3.5 ${backup.pendingChanges ? 'text-sky-600' : 'text-emerald-600'}`} />
      <span className="hidden sm:inline">
        {backup.pendingChanges ? 'Backup Queued' : backup.lastBackupAt ? 'Drive Backed Up' : 'Backup Ready'}
      </span>
    </div>
  );
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  isOnline,
  backup,
  onOpenSettings,
}) => {
  const avatar = backup.user?.photoURL || settings.doctorPhoto;
  const avatarAlt = backup.user?.name || settings.doctorName;
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatar]);

  return (
    <header className="sticky top-0 z-40 w-full px-2.5 pt-1 pb-1 pointer-events-none">
      {/* Header bar styled like the bottom navigation dock (same glass, rounded
          capsule, floating inset) at its original compact height */}
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 rounded-[22px] ios-glass-nav px-3 py-0.5 pointer-events-auto">
        {/* Left: Clinic Logo + Doctor / Clinic Info */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Logo container with subtle glass ring border */}
          <div className="relative shrink-0 w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-sky-500 to-emerald-400 p-[1.5px] shadow-sm shadow-indigo-500/20">
            <div className="w-full h-full rounded-[14px] bg-white/95 backdrop-blur-md flex items-center justify-center overflow-hidden p-0.5">
              {settings.clinicLogo ? (
                <img
                  src={settings.clinicLogo}
                  alt={settings.clinicName || 'Clinic Logo'}
                  className="w-full h-full object-contain rounded-[12px]"
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

          {/* Clinic & Doctor Name */}
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-wider uppercase text-indigo-600/90 truncate">
              {settings.clinicName || 'Dental Care Clinic'}
            </p>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight leading-tight truncate">
              {backup.user?.name || settings.doctorName || 'Dr. Dental Surgeon'}
            </h1>
          </div>
        </div>

        {/* Right: Install App, Backup Pill, Connection Pill, Account/Settings Button */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Dedicated one-click PWA install button */}
          <InstallAppButton />

          {/* Google Drive Cloud Backup Status */}
          <BackupPill backup={backup} isOnline={isOnline} />

          {/* Live Online/Offline Status Pill */}
          <div
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-md transition-colors ${
              isOnline
                ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-700 border-rose-500/20'
            }`}
            title={isOnline ? 'Network Online' : 'Offline Mode (Local-first IndexedDB Active)'}
          >
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-rose-600" />
            )}
            <span>{isOnline ? 'Online' : 'Offline'}</span>
          </div>

          {/* Settings / Account Avatar Button */}
          <button
            onClick={onOpenSettings}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full ios-glass border border-white/80 shadow-sm flex items-center justify-center text-slate-700 hover:text-indigo-600 hover:bg-white/90 active:scale-90 transition-all duration-150 overflow-hidden"
            aria-label="Settings and Profile"
          >
            {avatar && !avatarFailed ? (
              <img
                src={avatar}
                alt={avatarAlt}
                className="w-full h-full object-cover"
                onError={() => setAvatarFailed(true)}
              />
            ) : !avatarFailed && avatarAlt ? (
              <span className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-indigo-600 to-sky-500 text-white text-xs font-bold">
                {avatarAlt.charAt(0).toUpperCase()}
              </span>
            ) : (
              <Settings className="w-5 h-5 text-slate-600 hover:text-indigo-600" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
