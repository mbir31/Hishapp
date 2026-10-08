import React from 'react';
import { Settings } from 'lucide-react';
import { ClinicSettings } from '../types';

interface HeaderProps {
  settings: ClinicSettings;
  isOnline: boolean;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  isOnline,
  onOpenSettings,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full ios-glass-header px-4 py-3 sm:px-6">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
        {/* Left: Clinic Logo + Doctor / Clinic Info */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Logo container with subtle glass ring border */}
          <div className="relative shrink-0 w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 via-sky-500 to-emerald-400 p-[1.5px] shadow-sm shadow-indigo-500/20">
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
              {settings.doctorName || 'Dr. Dental Surgeon'}
            </h1>
          </div>
        </div>

        {/* Right: Live Connection Pill, Settings Button */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Live Online/Offline Status Pill */}
          <div
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-md transition-colors ${
              isOnline
                ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-700 border-rose-500/20'
            }`}
            title={isOnline ? 'Network Online' : 'Offline Mode (Local-first IndexedDB Active)'}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span>{isOnline ? 'Online' : 'Offline'}</span>
          </div>

          {/* Settings / Profile Avatar Button */}
          <button
            onClick={onOpenSettings}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full ios-glass border border-white/80 shadow-sm flex items-center justify-center text-slate-700 hover:text-indigo-600 hover:bg-white/90 active:scale-90 transition-all duration-150 overflow-hidden"
            aria-label="Settings and Profile"
          >
            {settings.doctorPhoto ? (
              <img
                src={settings.doctorPhoto}
                alt={settings.doctorName}
                className="w-full h-full object-cover"
              />
            ) : (
              <Settings className="w-5 h-5 text-slate-600 hover:text-indigo-600" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
