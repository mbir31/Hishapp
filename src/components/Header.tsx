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
  /** One-tap live sync plus a Google Drive recovery snapshot when authorized. */
  onSyncNow: () => void;
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
        title="Cloud sync is not configured — tapping will show setup guidance"
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
        title="Syncing your cloud records and saving a backup..."
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
        title={`${backup.error || 'Cloud backup issue'} — tap to sync again`}
      >
        <ShieldAlert className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Backup Issue</span>
      </button>
    );
  }

  if (phase === 'signed-out') {
    return (
      <button
        type="button"
        onClick={onSyncNow}
        className={`${pillBase} bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200/70 cursor-pointer`}
        title={isOnline ? 'Tap to sync cloud data now' : 'Reconnect to the internet before syncing'}
        aria-label="Sync cloud data"
      >
        <CloudOff className="w-3.5 h-3.5 text-slate-400" />
        <span className="hidden sm:inline">Backup Off</span>
      </button>
    );
  }

  // Signed in (idle / synced) — tap any time to force a cloud sync now
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
          ? 'Changes queued — tap to back up to your Google Drive now'
          : backup.lastBackupAt
          ? `Backed up to your Google Drive on ${new Date(backup.lastBackupAt).toLocaleString()} — tap to sync again`
          : 'Signed in — tap to back up to Google Drive now'
      }
    >
      <Cloud className={`w-3.5 h-3.5 ${backup.pendingChanges ? 'text-sky-600' : 'text-emerald-600'}`} />
      <span className="hidden sm:inline">
        {backup.pendingChanges ? 'Backup Queued' : backup.lastBackupAt ? 'Drive Backed Up' : 'Backup Ready'}
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
  // The account avatar is ONLY the signed-in Gmail account's photo. When no
  // account is signed in no profile photo is shown at all — even if an older
  // build cached one in the local settings database (that residue is also
  // scrubbed on load in backupEngine).
  const avatar = backup.user?.photoURL || '';
  // The header always shows the Doctor Name saved in Settings. The signed-in
  // Gmail account name is only a fallback for when that field is still empty.
  const displayName = settings.doctorName?.trim() || backup.user?.name?.trim() || '';
  const avatarAlt = backup.user?.name?.trim() || displayName;
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
          {/* Circular logo container (matches the round account avatar) with
              an animated gradient ring border */}
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

          {/* Clinic name on top, Doctor Name (from Settings) right below it */}
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
                title="Open Settings to add the Doctor Name (or sign in with Google)"
              >
                <LogIn className="w-3 h-3" />
                <span>Add Doctor Name</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Install App, Backup Pill, Connection Pill, Account/Settings Button */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Dedicated one-click PWA install button */}
          <InstallAppButton />

          {/* Google Drive Cloud Backup Status — tap to sync now */}
          <BackupPill backup={backup} isOnline={isOnline} onSyncNow={onSyncNow} />

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

          {/* Settings / Account Avatar Button — wrapped in the exact same
              animated logo-ring frame as the clinic logo on the left */}
          <div className="relative shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full logo-ring p-[1.5px] shadow-sm shadow-indigo-500/20">
            <button
              onClick={onOpenSettings}
              className="w-full h-full rounded-full bg-white/95 backdrop-blur-md flex items-center justify-center overflow-hidden p-0.5 text-slate-700 hover:text-indigo-600 active:scale-90 transition-all duration-150"
              aria-label="Settings and Profile"
            >
              {backup.user && avatar && !avatarFailed ? (
                <img
                  src={avatar}
                  alt={avatarAlt}
                  className="w-full h-full object-cover rounded-full"
                  onError={() => setAvatarFailed(true)}
                />
              ) : backup.user && !avatarFailed && avatarAlt ? (
                <span className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-indigo-600 to-sky-500 text-white text-xs font-bold rounded-full">
                  {avatarAlt.charAt(0).toUpperCase()}
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
