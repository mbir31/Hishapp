import React, { useRef, useState, useEffect } from 'react';
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
  Loader2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  KeyRound,
  Smartphone,
  Lock,
  Fingerprint,
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
import { todayDateKey } from '../utils/dateUtils';
import {
  isBiometricAvailable,
  isBiometricEnrolledFor,
  removeBiometricEnrollment,
} from '../services/biometricAuth';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ClinicSettings;
  backup: BackupStatus;
  onSaveSettings: (settings: ClinicSettings) => void;
  onVaultLogin: (phone: string, pin: string) => Promise<any>;
  onVaultBiometricLogin: (phone: string) => Promise<any>;
  onVaultEnableBiometric: () => Promise<boolean>;
  onVaultResetPinBiometric: (phone: string, newPin: string) => Promise<void>;
  onVaultSignOut: () => Promise<void>;
  onVaultChangePin: (oldPin: string, newPin: string) => Promise<void>;
  onBackupNow: () => Promise<any>;
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
  onVaultLogin,
  onVaultBiometricLogin,
  onVaultEnableBiometric,
  onVaultResetPinBiometric,
  onVaultSignOut,
  onVaultChangePin,
  onBackupNow,
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

  // Vault login state
  const [phoneInput, setPhoneInput] = useState<string>('');
  const [pinInput, setPinInput] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [rememberPhone, setRememberPhone] = useState<boolean>(() => {
    try {
      return localStorage.getItem('hisapp_remember_phone') !== 'false';
    } catch {
      return true;
    }
  });

  // Biometric state
  const [hasBiometricSupport, setHasBiometricSupport] = useState<boolean>(false);
  const [isBiometricEnrolled, setIsBiometricEnrolled] = useState<boolean>(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState<boolean>(false);

  // Change PIN state
  const [showChangePin, setShowChangePin] = useState<boolean>(false);
  const [oldPinInput, setOldPinInput] = useState<string>('');
  const [newPinInput, setNewPinInput] = useState<string>('');
  const [confirmPinInput, setConfirmPinInput] = useState<string>('');
  const [isSavingPin, setIsSavingPin] = useState<boolean>(false);

  // File import state (restore from JSON / CSV backup files)
  const [importConfirm, setImportConfirm] = useState<ImportResult | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  // Load saved phone if remembered
  useEffect(() => {
    isBiometricAvailable().then(setHasBiometricSupport);
    try {
      const savedPhone = localStorage.getItem('hisapp_saved_phone');
      if (savedPhone) {
        setPhoneInput(savedPhone);
      }
    } catch {
      // ignore storage error
    }
  }, []);

  // Sync biometric enrollment status for current target phone
  useEffect(() => {
    const target = backup.user?.phoneNumber || phoneInput.replace(/\D/g, '');
    setIsBiometricEnrolled(isBiometricEnrolledFor(target));
  }, [backup.user, phoneInput]);

  // Sync state when settings prop updates
  useEffect(() => {
    setClinicName(settings.clinicName || DEFAULT_CLINIC_NAME);
    setClinicLogo(settings.clinicLogo || DEFAULT_CLINIC_LOGO);
    setDoctorName(settings.doctorName);
    setCurrencySymbol(settings.currencySymbol || '৳');
    setSharePercentage(settings.sharePercentage || 40);
  }, [settings]);

  if (!isOpen) return null;

  const handleVaultLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = phoneInput.replace(/\D/g, '').trim();
    if (cleanPhone.length !== 11) {
      showToast('ভুল মোবাইল নম্বর', 'অনুগ্রহ করে ১১ ডিজিটের মোবাইল নম্বর দিন (যেমন: 017XXXXXXXX)', 'warning');
      return;
    }
    const cleanPin = pinInput.trim();
    if (cleanPin.length !== 4) {
      showToast('ভুল পিন নম্বর', 'পিন অবশ্যই ৪ ডিজিটের হতে হবে (যেমন: 1234)', 'warning');
      return;
    }

    setIsLoggingIn(true);
    try {
      const session = await onVaultLogin(cleanPhone, cleanPin);

      // Handle remember phone preference
      if (rememberPhone) {
        localStorage.setItem('hisapp_saved_phone', cleanPhone);
        localStorage.setItem('hisapp_remember_phone', 'true');
      } else {
        localStorage.removeItem('hisapp_saved_phone');
        localStorage.setItem('hisapp_remember_phone', 'false');
      }

      showToast(
        session.isNew ? 'নতুন ক্লাউড ভল্ট তৈরি হয়েছে!' : 'ক্লাউড ভল্ট আনলক হয়েছে!',
        `মোবাইল নম্বর: ${cleanPhone}`,
        'success'
      );
      setPinInput('');
    } catch (err: any) {
      showToast('ভল্ট এরর', err?.message || 'লগইন ব্যর্থ হয়েছে', 'error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleBiometricLogin = async () => {
    const cleanPhone = (phoneInput || backup.user?.phoneNumber || '').replace(/\D/g, '').trim();
    if (cleanPhone.length !== 11) {
      showToast('মোবাইল নম্বর প্রয়োজন', 'বায়োমেট্রিক লগইনের জন্য ১১ ডিজিটের নম্বর দিন', 'warning');
      return;
    }

    setIsBiometricLoading(true);
    try {
      await onVaultBiometricLogin(cleanPhone);
      if (rememberPhone) {
        localStorage.setItem('hisapp_saved_phone', cleanPhone);
      }
      showToast('বায়োমেট্রিক লগইন সফল!', `ভল্ট আইডি: ${cleanPhone}`, 'success');
      setPinInput('');
    } catch (err: any) {
      showToast('বায়োমেট্রিক সমস্যা', err?.message || 'যাচাই ব্যর্থ হয়েছে', 'error');
    } finally {
      setIsBiometricLoading(false);
    }
  };

  const handleToggleBiometric = async () => {
    if (!backup.user) return;
    setIsBiometricLoading(true);
    try {
      if (isBiometricEnrolled) {
        removeBiometricEnrollment(backup.user.phoneNumber);
        setIsBiometricEnrolled(false);
        showToast('বায়োমেট্রিক বন্ধ করা হয়েছে', 'এই ডিভাইসের ফিঙ্গারপ্রিন্ট সংযোগ বিচ্ছিন্ন হয়েছে', 'info');
      } else {
        await onVaultEnableBiometric();
        setIsBiometricEnrolled(true);
        showToast('বায়োমেট্রিক সক্রিয় হয়েছে!', 'এখন থেকে ফিঙ্গারপ্রিন্ট বা ফেস আইডি দিয়ে এক ক্লিকে লগইন করা যাবে', 'success');
      }
    } catch (err: any) {
      showToast('বায়োমেট্রিক ত্রুটি', err?.message || 'সেটআপ ব্যর্থ হয়েছে', 'error');
    } finally {
      setIsBiometricLoading(false);
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (oldPinInput.trim().length !== 4) {
      showToast('ভুল বর্তমান পিন', 'বর্তমান পিন ৪ ডিজিটের হতে হবে', 'warning');
      return;
    }
    if (newPinInput.trim().length !== 4) {
      showToast('ভুল নতুন পিন', 'নতুন পিন ৪ ডিজিটের হতে হবে', 'warning');
      return;
    }
    if (newPinInput.trim() !== confirmPinInput.trim()) {
      showToast('পিন মিলেনি', 'নতুন পিন এবং নিশ্চিতকরণ পিন একই হতে হবে', 'warning');
      return;
    }

    setIsSavingPin(true);
    try {
      await onVaultChangePin(oldPinInput.trim(), newPinInput.trim());
      showToast('পিন সফলভাবে পরিবর্তন হয়েছে!', 'আপনার নতুন ৪ ডিজিটের পিন সংরক্ষিত হয়েছে', 'success');
      setShowChangePin(false);
      setOldPinInput('');
      setNewPinInput('');
      setConfirmPinInput('');
    } catch (err: any) {
      showToast('পিন পরিবর্তন ব্যর্থ', err?.message || 'অনুগ্রহ করে সঠিক বর্তমান পিন দিন', 'error');
    } finally {
      setIsSavingPin(false);
    }
  };

  const handleBiometricPinReset = async () => {
    if (!backup.user) return;
    if (newPinInput.trim().length !== 4) {
      showToast('নতুন পিন দিন', 'নতুন পিন অবশ্যই ৪ ডিজিটের হতে হবে', 'warning');
      return;
    }
    if (newPinInput.trim() !== confirmPinInput.trim()) {
      showToast('পিন মিলেনি', 'নতুন পিন এবং নিশ্চিতকরণ পিন একই হতে হবে', 'warning');
      return;
    }

    setIsSavingPin(true);
    try {
      await onVaultResetPinBiometric(backup.user.phoneNumber, newPinInput.trim());
      showToast('পিন পরিবর্তিত হয়েছে!', 'বায়োমেট্রিক যাচাইয়ের মাধ্যমে নতুন ৪-ডিজিট পিন সংরক্ষিত হয়েছে', 'success');
      setShowChangePin(false);
      setOldPinInput('');
      setNewPinInput('');
      setConfirmPinInput('');
    } catch (err: any) {
      showToast('পিন রিসেট ব্যর্থ', err?.message || 'বায়োমেট্রিক যাচাই হয়নি', 'error');
    } finally {
      setIsSavingPin(false);
    }
  };

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
      downloadFile(
        json,
        `Hisapp_Data_Backup_${todayDateKey()}.json`,
        'application/json;charset=utf-8;'
      );
      showToast('JSON Backup Ready', 'Complete database exported safely to your device', 'success');
    } catch (err: any) {
      showToast('Export failed', err?.message, 'error');
    }
  };

  const handleExportCSV = async () => {
    try {
      const { patientEntriesCSV, settlementsCSV } = await exportAllDataCSV();
      downloadFile(
        patientEntriesCSV,
        `Hisapp_Patient_Entries_${todayDateKey()}.csv`,
        'text/csv;charset=utf-8;'
      );
      setTimeout(() => {
        downloadFile(
          settlementsCSV,
          `Hisapp_Settlements_${todayDateKey()}.csv`,
          'text/csv;charset=utf-8;'
        );
      }, 400);
      showToast('CSV Exports Ready', 'Patient entries and settlements downloaded', 'success');
    } catch (err: any) {
      showToast('Export failed', err?.message, 'error');
    }
  };

  const handleImportFiles = async (
    files: FileList | null,
    format: 'json' | 'csv'
  ) => {
    if (!files || files.length === 0) return;
    try {
      let result: ImportResult;
      if (format === 'json') {
        const file = files[0];
        const text = await file.text();
        result = parseJSONBackup(text, file.name);
      } else {
        const loadedFiles = await Promise.all(
          Array.from(files).map(async (f) => ({
            name: f.name,
            text: await f.text(),
          }))
        );
        result = parseCSVFiles(loadedFiles);
      }
      setImportConfirm(result);
    } catch (err: any) {
      showToast('Import Failed', err?.message || 'Could not parse the selected file(s)', 'error');
    } finally {
      if (jsonFileRef.current) jsonFileRef.current.value = '';
      if (csvFileRef.current) csvFileRef.current.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!importConfirm) return;
    setIsImporting(true);
    try {
      try {
        const safetyBackup = await exportAllDataJSON();
        downloadFile(
          safetyBackup,
          `Hisapp_Safety_Before_Import_${todayDateKey()}.json`,
          'application/json;charset=utf-8;'
        );
      } catch (safetyErr) {
        console.warn('Could not generate safety backup before import:', safetyErr);
      }

      await restoreAllData({
        patientEntries: importConfirm.patientEntries,
        settlements: importConfirm.settlements,
      });
      await syncAllPatientProfiles();
      await logAudit({
        action: 'DATA_IMPORTED',
        targetId: 'system',
        targetType: 'patient_entry',
        details: `Imported ${importConfirm.patientEntries.length} visits and ${importConfirm.settlements.length} settlements from ${importConfirm.source}`,
      });

      showToast(
        'Import Successful',
        `Restored ${importConfirm.patientEntries.length} visits and ${importConfirm.settlements.length} settlements`,
        'success'
      );
      setImportConfirm(null);
      onDataImported?.();
      onClose();
    } catch (err: any) {
      showToast('Import Failed', err?.message || 'Could not restore data', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const isSyncing = backup.phase === 'syncing';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-5 sm:p-6 shadow-2xl space-y-6 border border-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Clinic Settings</h3>
              <p className="text-xs text-slate-500">Cloud Data Vault &amp; Branding Profile</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 active:scale-95 transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section: Cloud Data Vault (Firestore central database) */}
        <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100/80 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Cloud Data Vault (Firestore)
                </h4>
                <p className="text-[10px] text-slate-500">১১ ডিজিটের মোবাইল নম্বর ও ৪ ডিজিটের গোপন PIN</p>
              </div>
            </div>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                isSyncing
                  ? 'bg-indigo-100 text-indigo-800'
                  : backup.phase === 'error'
                  ? 'bg-rose-100 text-rose-800'
                  : backup.user
                  ? backup.pendingChanges
                    ? 'bg-sky-100 text-sky-800'
                    : 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {isSyncing
                ? 'Syncing…'
                : backup.phase === 'error'
                ? 'Sync Error'
                : backup.user
                ? backup.pendingChanges
                  ? 'Changes Pending'
                  : 'Vault Connected'
                : 'Not Logged In'}
            </span>
          </div>

          {!backup.user ? (
            /* Login / Vault Registration Form */
            <form onSubmit={handleVaultLogin} className="space-y-3 pt-1">
              <p className="text-xs text-slate-600 leading-relaxed">
                আপনার ১১ ডিজিটের মোবাইল নম্বর এবং ৪ ডিজিটের গোপন PIN দিয়ে লগইন করুন। প্রথমবার দিলে সেই নম্বরের জন্য স্বয়ংক্রিয়ভাবে একটি নিরাপদ <strong>Cloud Data Vault</strong> তৈরি হবে।
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1 mb-1">
                    <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
                    মোবাইল নম্বর (১১ ডিজিট)
                  </label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="01XXXXXXXXX"
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 focus:border-indigo-500 text-xs font-semibold text-slate-900 outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1 mb-1">
                    <Lock className="w-3.5 h-3.5 text-indigo-600" />
                    গোপন PIN (৪ ডিজিট)
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 focus:border-indigo-500 text-xs font-semibold text-slate-900 outline-none tracking-widest"
                    required
                  />
                </div>
              </div>

              {/* Remember Mobile Number Checkbox */}
              <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-slate-700 font-medium">
                <input
                  type="checkbox"
                  checked={rememberPhone}
                  onChange={(e) => setRememberPhone(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 accent-indigo-600"
                />
                <span>মোবাইল নম্বর মনে রাখুন (Remember mobile number on this device)</span>
              </label>

              {backup.error && (
                <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-1.5">
                  {backup.error}
                </p>
              )}

              <div className="flex flex-col gap-2 pt-0.5">
                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="btn-gradient w-full py-2.5 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-60 shadow-sm"
                >
                  {isLoggingIn ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>ভল্ট খোলা হচ্ছে...</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="w-3.5 h-3.5" />
                      <span>লগইন / নতুন ভল্ট তৈরি করুন</span>
                    </>
                  )}
                </button>

                {/* Biometric One-Tap Login Button (if enrolled for this phone on device) */}
                {hasBiometricSupport && isBiometricEnrolled && (
                  <button
                    type="button"
                    onClick={handleBiometricLogin}
                    disabled={isBiometricLoading}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition active:scale-95 disabled:opacity-60"
                  >
                    {isBiometricLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Fingerprint className="w-4 h-4" />
                    )}
                    <span>বায়োমেট্রিক দিয়ে এক ক্লিকে লগইন (Fingerprint / Face ID)</span>
                  </button>
                )}
              </div>
            </form>
          ) : (
            /* Active Vault Info & Actions */
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-white/90 border border-indigo-100 shadow-2xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      ভল্ট আইডি: {backup.user.phoneNumber}
                    </p>
                    <p className="text-[10.5px] text-slate-500 truncate flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {backup.lastBackupAt
                        ? `সর্বশেষ সিঙ্ক: ${new Date(backup.lastBackupAt).toLocaleTimeString()}`
                        : 'এখনো ক্লাউডে সিঙ্ক হয়নি'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onVaultSignOut()}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold flex items-center gap-1 active:scale-95 transition shrink-0"
                >
                  <LogOut className="w-3 h-3" />
                  Sign Out
                </button>
              </div>

              {/* Biometric Integration Card */}
              {hasBiometricSupport && (
                <div className="p-3 rounded-xl bg-white border border-slate-200 flex items-center justify-between gap-2 shadow-2xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`p-2 rounded-xl shrink-0 ${isBiometricEnrolled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                      <Fingerprint className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">ডিভাইস বায়োমেট্রিক আনলক</p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {isBiometricEnrolled
                          ? 'ফিঙ্গারপ্রিন্ট / ফেস আইডি সক্রিয় আছে'
                          : 'PIN ছাড়াই দ্রুত আনলকের জন্য সক্রিয় করুন'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleBiometric}
                    disabled={isBiometricLoading}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold active:scale-95 transition shrink-0 ${
                      isBiometricEnrolled
                        ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                        : 'btn-gradient btn-gradient--emerald text-white'
                    }`}
                  >
                    {isBiometricLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isBiometricEnrolled ? (
                      'বন্ধ করুন'
                    ) : (
                      'চালু করুন'
                    )}
                  </button>
                </div>
              )}

              {backup.error && (
                <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-1.5">
                  {backup.error}
                </p>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => onBackupNow()}
                  disabled={isSyncing}
                  className="btn-gradient btn-gradient--sky px-3 py-2 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60"
                >
                  <CloudUpload className={`w-3.5 h-3.5 ${isSyncing ? 'animate-pulse' : ''}`} />
                  <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowChangePin(!showChangePin)}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition"
                >
                  <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{showChangePin ? 'পিন পরিবর্তন বাতিল' : 'পিন পরিবর্তন (Change PIN)'}</span>
                </button>

                {backup.pendingChanges && (
                  <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-2.5 py-1 rounded-full">
                    {backup.pendingCount} পরিবর্তন ক্লাউডে পাঠানোর অপেক্ষায়
                  </span>
                )}
              </div>

              {/* Change PIN Expandable Panel */}
              {showChangePin && (
                <form
                  onSubmit={handleChangePin}
                  className="p-3.5 rounded-xl bg-white border border-indigo-200 space-y-3 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
                      গোপন PIN পরিবর্তন করুন
                    </h5>
                    {isBiometricEnrolled && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        বায়োমেট্রিক প্রস্তুত
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 block mb-0.5">
                        বর্তমান PIN
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        value={oldPinInput}
                        onChange={(e) => setOldPinInput(e.target.value.replace(/\D/g, ''))}
                        placeholder={isBiometricEnrolled ? 'ঐচ্ছিক (বায়োমেট্রিক ছাড়া)' : '••••'}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs text-center font-bold outline-none focus:border-indigo-500"
                        required={!isBiometricEnrolled}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 block mb-0.5">
                        নতুন PIN (৪ ডিজিট)
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        value={newPinInput}
                        onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs text-center font-bold outline-none focus:border-indigo-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 block mb-0.5">
                        নিশ্চিত নতুন PIN
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        value={confirmPinInput}
                        onChange={(e) => setConfirmPinInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs text-center font-bold outline-none focus:border-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowChangePin(false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      বাতিল
                    </button>

                    {/* Biometric PIN Reset button if biometrics is enrolled */}
                    {isBiometricEnrolled && (
                      <button
                        type="button"
                        onClick={handleBiometricPinReset}
                        disabled={isSavingPin}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60 shadow-xs active:scale-95 transition"
                        title="বর্তমান পিন ছাড়াই ফিঙ্গারপ্রিন্ট দিয়ে নতুন পিন সেট করুন"
                      >
                        <Fingerprint className="w-3.5 h-3.5" />
                        <span>বায়োমেট্রিক দিয়ে পিন বদলান</span>
                      </button>
                    )}

                    <button
                      type="submit"
                      disabled={isSavingPin}
                      className="btn-gradient px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-60"
                    >
                      {isSavingPin ? 'সংরক্ষণ হচ্ছে...' : 'বর্তমান PIN দিয়ে সেভ করুন'}
                    </button>
                  </div>
                </form>
              )}

              {/* Automatic Sync Switch */}
              <label className="flex items-center justify-between p-2.5 rounded-xl bg-white/80 border border-white shadow-2xs cursor-pointer">
                <div>
                  <p className="text-xs font-bold text-slate-900">স্বয়ংক্রিয় ক্লাউড সিঙ্ক (Auto-Sync)</p>
                  <p className="text-[11px] text-slate-500">
                    প্রতিটি পরিবর্তন স্বয়ংক্রিয়ভাবে ক্লাউড ভল্ট এবং সকল ডিভাইসে লাইভ সিঙ্ক হবে।
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
            </div>
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
                placeholder="Doctor name (e.g. Dr. MBR)"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 outline-none focus:border-indigo-500 font-semibold"
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
            className="btn-gradient w-full py-2.5 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
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

          {/* Import Confirmation Panel */}
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
                  className="btn-gradient btn-gradient--rose flex-1 py-2 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-70"
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
              className="btn-gradient px-3 py-1.5 rounded-xl text-white text-xs font-bold"
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
                className="btn-gradient w-full py-2 rounded-xl text-white text-xs font-bold"
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
