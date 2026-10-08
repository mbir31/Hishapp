import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  User,
  Activity,
  Coins,
  FileText,
  CheckCircle2,
  SlidersHorizontal,
  Settings2,
  Gift,
  Clock,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { AmountPreset, ClinicSettings, PatientEntry, PatientProfile } from '../types';
import {
  DEFAULT_AMOUNT_PRESETS,
  DEFAULT_PROCEDURES,
  getNextSerial,
  savePatientEntry,
  saveSettings,
  getAllPatientProfiles,
} from '../db/indexedDB';
import { ProcedureManagerModal } from './ProcedureManagerModal';
import { AmountPresetManagerModal } from './AmountPresetManagerModal';

interface EntryTabProps {
  settings: ClinicSettings;
  existingEntries?: PatientEntry[];
  onEntrySaved: (entry: PatientEntry) => void;
  onUpdateSettings?: (settings: ClinicSettings) => void;
  showToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const EntryTab: React.FC<EntryTabProps> = ({
  settings,
  existingEntries = [],
  onEntrySaved,
  onUpdateSettings,
  showToast,
}) => {
  const currency = settings.currencySymbol || '৳';
  const todayStr = new Date().toISOString().split('T')[0];

  // Procedure list from settings or defaults
  const procedureList =
    settings.procedures && settings.procedures.length > 0
      ? settings.procedures
      : DEFAULT_PROCEDURES;

  // Amount presets from settings or defaults
  const amountPresetList =
    settings.amountPresets && settings.amountPresets.length > 0
      ? settings.amountPresets
      : DEFAULT_AMOUNT_PRESETS;

  const [date, setDate] = useState<string>(todayStr);
  const [patientName, setPatientName] = useState<string>('');
  const [procedure, setProcedure] = useState<string>(() => procedureList[0] || 'Visit');
  const [customProcedure, setCustomProcedure] = useState<string>('');
  const [isCustomProcedure, setIsCustomProcedure] = useState<boolean>(false);
  const [receivedAmount, setReceivedAmount] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Suggestions state
  const [profiles, setProfiles] = useState<PatientProfile[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [selectedProfilePreview, setSelectedProfilePreview] = useState<PatientProfile | null>(null);
  const suggestionBoxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Modals state
  const [isProcedureModalOpen, setIsProcedureModalOpen] = useState<boolean>(false);
  const [isAmountModalOpen, setIsAmountModalOpen] = useState<boolean>(false);

  // Load profiles from IndexedDB
  useEffect(() => {
    let isMounted = true;
    getAllPatientProfiles().then((list) => {
      if (isMounted) setProfiles(list);
    });
    return () => {
      isMounted = false;
    };
  }, [existingEntries]);

  // Close suggestions dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionBoxRef.current &&
        !suggestionBoxRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Compute suggestions matching the current patientName query
  const matchingProfiles = React.useMemo(() => {
    const query = patientName.trim().toLowerCase();
    if (!query) return [];

    // First find matching profiles
    const matched = profiles.filter((p) =>
      p.name.toLowerCase().includes(query)
    );

    // Also look up any names from existing entries that might not be in profiles yet
    const profileNamesSet = new Set(profiles.map((p) => p.name.toLowerCase()));
    const extraMatches: PatientProfile[] = [];
    existingEntries.forEach((entry) => {
      const name = (entry.patientName || '').trim();
      const norm = name.toLowerCase();
      if (norm.includes(query) && !profileNamesSet.has(norm)) {
        profileNamesSet.add(norm);
        extraMatches.push({
          id: norm,
          name: name,
          totalVisits: 1,
          totalBilled: entry.receivedAmount,
          totalDoctorShare: entry.doctorShare,
          firstVisitDate: entry.date,
          lastVisitDate: entry.date,
          procedures: [entry.procedure],
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        });
      }
    });

    const combined = [...matched, ...extraMatches];
    // Sort matches: startsWith query first, then totalVisits desc
    combined.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(query);
      const bStarts = b.name.toLowerCase().startsWith(query);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return (b.totalVisits || 0) - (a.totalVisits || 0);
    });

    return combined.slice(0, 5); // top 5 suggestions
  }, [patientName, profiles, existingEntries]);

  const handleSelectSuggestion = (prof: PatientProfile) => {
    setPatientName(prof.name);
    setShowSuggestions(false);
    setSelectedProfilePreview(prof);

    // Optional quick auto-procedure suggestion if the patient commonly had one
    if (prof.procedures && prof.procedures.length > 0) {
      const lastProc = prof.procedures[prof.procedures.length - 1];
      if (procedureList.includes(lastProc)) {
        setProcedure(lastProc);
        setIsCustomProcedure(false);
      }
    }

    showToast(
      `Patient Profile Selected`,
      `${prof.name} has ${prof.totalVisits} previous visit${prof.totalVisits === 1 ? '' : 's'}.`,
      'info'
    );
  };

  // Real-time calculation based on customizable sharePercentage
  const shareRate = settings.sharePercentage || 40;
  const clinicRate = Math.max(0, 100 - shareRate);
  const parsedAmount = Math.max(0, parseFloat(receivedAmount) || 0);
  const doctorShare = Math.round(parsedAmount * (shareRate / 100));
  const clinicShare = Math.round(parsedAmount * (clinicRate / 100));

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-BD').format(num);
  };

  const handleSelectProcedureChip = (proc: string) => {
    setIsCustomProcedure(false);
    setProcedure(proc);
  };

  const handleSetQuickDate = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    setDate(d.toISOString().split('T')[0]);
  };

  // Preset click handler: handles 0 amount (No Payment / Free Campaign) or positive numbers
  const handleSelectAmountPreset = (preset: AmountPreset) => {
    if (preset.amount === 0) {
      setReceivedAmount('0');
      if (!remarks.trim()) {
        setRemarks(preset.label);
      }
      showToast(
        `${preset.label} Selected`,
        `Fee recorded as ${currency} 0 (Doctor share: ${currency} 0)`,
        'info'
      );
    } else {
      const curr = parseFloat(receivedAmount) || 0;
      if (curr === 0) {
        setReceivedAmount(String(preset.amount));
      } else {
        setReceivedAmount(String(curr + preset.amount));
      }
    }
  };

  const handleSaveProcedures = async (newProcs: string[]) => {
    const updated = await saveSettings({ procedures: newProcs });
    onUpdateSettings?.(updated);
    if (!newProcs.includes(procedure)) {
      setProcedure(newProcs[0] || 'Visit');
    }
  };

  const handleSaveAmountPresets = async (newPresets: AmountPreset[]) => {
    const updated = await saveSettings({ amountPresets: newPresets });
    onUpdateSettings?.(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!patientName.trim()) {
      showToast('Patient Name Required', 'Please enter patient name or clinic ID', 'warning');
      return;
    }

    if (receivedAmount.trim() === '' || isNaN(parsedAmount) || parsedAmount < 0) {
      showToast('Amount Required', 'Please enter fee amount or select No Payment / Free Campaign', 'warning');
      return;
    }

    const effectiveProcedure = isCustomProcedure ? customProcedure.trim() : procedure;
    if (!effectiveProcedure) {
      showToast('Procedure Required', 'Please select or type the dental treatment performed', 'warning');
      return;
    }

    try {
      setIsSubmitting(true);
      const nextSerial = await getNextSerial();
      const newEntry: PatientEntry = {
        id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        serial: nextSerial,
        date: date,
        patientName: patientName.trim(),
        procedure: effectiveProcedure,
        receivedAmount: parsedAmount,
        doctorShare: doctorShare,
        settlementStatus: 'Pending',
        settlementId: null,
        remarks: remarks.trim(),
        synced: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await savePatientEntry(newEntry);
      onEntrySaved(newEntry);

      showToast(
        'Visit Recorded Successfully!',
        parsedAmount === 0
          ? `Free/Zero fee visit (${effectiveProcedure}) logged in ledger.`
          : `Your ${shareRate}% share (${currency} ${formatNumber(doctorShare)}) added to unsettled ledger.`,
        'success'
      );

      // Reset form fields for rapid next entry while keeping date
      setPatientName('');
      setSelectedProfilePreview(null);
      setShowSuggestions(false);
      setReceivedAmount('');
      setRemarks('');
      if (isCustomProcedure) {
        setIsCustomProcedure(false);
      }
    } catch (err: any) {
      console.error('Failed to save entry:', err);
      showToast('Failed to Save', err?.message || 'Database error occurred', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-2 pb-16 animate-in fade-in duration-200">
      {/* Single-Liner Header */}
      <div className="px-1">
        <h2 className="text-xs sm:text-sm font-bold text-slate-700 tracking-tight">
          New Entry : Payment per patient
        </h2>
      </div>

      {/* Main Frosted Entry Card - Ultra-Compact Layout */}
      <form onSubmit={handleSubmit} className="ios-glass-card rounded-2xl p-3.5 sm:p-4 space-y-2.5">
        {/* Row 1: 2-Column Grid for Date & Patient Name */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Visit Date */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-indigo-600" />
                <span>Visit Date</span>
              </label>
              <div className="flex items-center gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => handleSetQuickDate(0)}
                  className={`px-1.5 py-0.5 rounded-md border font-medium transition ${
                    date === todayStr
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => handleSetQuickDate(1)}
                  className="px-1.5 py-0.5 rounded-md border bg-white text-slate-600 border-slate-200 hover:bg-slate-50 font-medium transition"
                >
                  Y'day
                </button>
              </div>
            </div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl bg-white/90 border border-slate-200 focus:border-indigo-500 text-slate-800 text-xs font-medium transition outline-none"
              required
            />
          </div>

          {/* Patient Name / ID */}
          <div className="space-y-1 relative">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                <User className="w-3 h-3 text-indigo-600" />
                <span>Patient Name / ID</span>
              </label>
              {selectedProfilePreview && (
                <span className="text-[10px] text-indigo-600 font-semibold flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5 text-indigo-500" />
                  <span>Existing Profile ({selectedProfilePreview.totalVisits} visit{selectedProfilePreview.totalVisits === 1 ? '' : 's'})</span>
                </span>
              )}
            </div>

            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                placeholder="Type name (e.g. John Doe / P-1042)..."
                value={patientName}
                onChange={(e) => {
                  setPatientName(e.target.value);
                  setShowSuggestions(true);
                  if (selectedProfilePreview && selectedProfilePreview.name.toLowerCase() !== e.target.value.toLowerCase()) {
                    setSelectedProfilePreview(null);
                  }
                }}
                onFocus={() => {
                  if (patientName.trim()) {
                    setShowSuggestions(true);
                  }
                }}
                className="w-full px-3 py-1.5 rounded-xl bg-white/90 border border-slate-200 focus:border-indigo-500 text-slate-800 text-xs font-medium transition outline-none placeholder:text-slate-400"
                required
                autoFocus
                autoComplete="off"
              />
              {patientName && (
                <button
                  type="button"
                  onClick={() => {
                    setPatientName('');
                    setSelectedProfilePreview(null);
                    setShowSuggestions(false);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[10px] px-1"
                >
                  Clear
                </button>
              )}

              {/* Instant Match Suggestions Popup Menu */}
              {showSuggestions && matchingProfiles.length > 0 && (
                <div
                  ref={suggestionBoxRef}
                  className="absolute left-0 right-0 top-full mt-1.5 z-40 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-indigo-100 p-1.5 space-y-1 animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between border-b border-slate-100">
                    <span>Matching Profiles</span>
                    <span className="text-indigo-600">Select to Autofill</span>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {matchingProfiles.map((prof) => (
                      <button
                        key={prof.id}
                        type="button"
                        onClick={() => handleSelectSuggestion(prof)}
                        className="w-full text-left p-2 rounded-xl hover:bg-indigo-50/80 active:bg-indigo-100 transition flex items-center justify-between group"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-700 transition truncate">
                              {prof.name}
                            </span>
                            <span className="px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-[9.5px] font-bold shrink-0">
                              {prof.totalVisits} {prof.totalVisits === 1 ? 'Visit' : 'Visits'}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              Last: {prof.lastVisitDate}
                            </span>
                            {prof.procedures && prof.procedures.length > 0 && (
                              <span className="text-slate-500 truncate max-w-[140px]">
                                • {prof.procedures.slice(-2).join(', ')}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 pl-2 text-right">
                          <div className="text-[11px] font-bold text-indigo-600">
                            {currency} {formatNumber(prof.totalDoctorShare)}
                          </div>
                          <span className="text-[9px] text-slate-400">earned</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: Customizable Dental Procedure Selection */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
              <Activity className="w-3 h-3 text-indigo-600" />
              <span>Dental Procedure</span>
            </label>
            <div className="flex items-center gap-1.5 text-[10.5px]">
              <button
                type="button"
                onClick={() => setIsProcedureModalOpen(true)}
                className="font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-1 transition"
                title="Customize procedure options"
              >
                <SlidersHorizontal className="w-2.5 h-2.5 text-indigo-600" />
                <span>Presets</span>
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={() => setIsCustomProcedure(!isCustomProcedure)}
                className="font-semibold text-indigo-600 hover:text-indigo-800 transition"
              >
                {isCustomProcedure ? 'List' : '+ Custom'}
              </button>
            </div>
          </div>

          {isCustomProcedure ? (
            <input
              type="text"
              placeholder="Enter custom treatment name..."
              value={customProcedure}
              onChange={(e) => setCustomProcedure(e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl bg-white/90 border border-indigo-300 focus:border-indigo-500 text-slate-800 text-xs font-medium transition outline-none"
              required
            />
          ) : (
            <div className="space-y-1.5">
              <select
                value={procedure}
                onChange={(e) => setProcedure(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-white/90 border border-slate-200 focus:border-indigo-500 text-slate-800 text-xs font-medium transition outline-none"
              >
                {procedureList.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>

              {/* Fast Procedure Chips (Ultra-Compact) */}
              <div className="flex flex-wrap gap-1">
                {procedureList.map((chip) => {
                  const isSelected = procedure === chip;

                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleSelectProcedureChip(chip)}
                      className={`px-2 py-0.5 rounded-lg text-[10.5px] font-medium transition active:scale-95 ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-white/80 text-slate-600 border border-slate-200/80 hover:bg-slate-100'
                      }`}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Row 3: Received Amount & Presets */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
              <Coins className="w-3 h-3 text-indigo-600" />
              <span>Received Amount ({currency})</span>
            </label>
            <button
              type="button"
              onClick={() => setIsAmountModalOpen(true)}
              className="text-[10.5px] font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-1 transition"
              title="Add or edit amount buttons"
            >
              <Settings2 className="w-2.5 h-2.5 text-indigo-600" />
              <span>Presets</span>
            </button>
          </div>

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
              {currency}
            </span>
            <input
              type="number"
              placeholder="0"
              value={receivedAmount}
              onChange={(e) => setReceivedAmount(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white/90 border border-slate-200 focus:border-indigo-500 text-slate-900 text-base font-bold tracking-tight transition outline-none"
              min="0"
              step="any"
              required
            />
          </div>

          {/* Quick Amount Presets Row (Ultra-Compact) */}
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {amountPresetList.map((preset) => {
              const isZero = preset.amount === 0;
              const isSelected = isZero && receivedAmount === '0';

              if (isZero) {
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectAmountPreset(preset)}
                    className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold flex items-center gap-1 border active:scale-95 transition ${
                      isSelected
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    }`}
                  >
                    <Gift className="w-2.5 h-2.5" />
                    <span>{preset.label} (৳0)</span>
                  </button>
                );
              }

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectAmountPreset(preset)}
                  className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10.5px] font-semibold border border-slate-200/60 active:scale-95 transition"
                >
                  +{preset.amount}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 4: Remarks / Notes */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
            <FileText className="w-3 h-3 text-indigo-600" />
            <span>Remarks / Clinical Notes</span>
            <span className="text-[10px] font-normal text-slate-400">(Optional)</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Upper 2nd molar, No Payment / Free Campaign note"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="w-full px-3 py-1.5 rounded-xl bg-white/90 border border-slate-200 focus:border-indigo-500 text-slate-800 text-xs font-medium transition outline-none placeholder:text-slate-400"
          />
        </div>

        {/* Row 5: Action Button: Tactile Spring Save Record */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-700 hover:to-sky-700 active:scale-[0.98] text-white font-bold text-sm shadow-md shadow-indigo-500/25 flex items-center justify-center gap-1.5 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{isSubmitting ? 'Saving to Ledger...' : `Save Record (${shareRate}% Share)`}</span>
        </button>

        {/* Row 6: DOCTOR'S SHARE CALCULATION BADGE (COMPACT, BELOW SAVE BUTTON) */}
        <div className="p-2.5 sm:p-3 rounded-xl bg-gradient-to-r from-indigo-50/80 via-sky-50/50 to-emerald-50/70 border border-indigo-100/90 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[9.5px] font-bold tracking-wider uppercase text-indigo-600 block">
              Doctor's Share ({shareRate}%)
            </span>
            <div className="text-base sm:text-lg font-black text-indigo-700 tracking-tight leading-tight">
              {currency} {formatNumber(doctorShare)}
            </div>
          </div>

          <div className="text-right pl-3 border-l border-indigo-100">
            <span className="text-[9.5px] font-bold uppercase text-slate-400 block">
              Clinic Retention ({clinicRate}%)
            </span>
            <div className="text-xs sm:text-sm font-bold text-slate-600 leading-tight">
              {currency} {formatNumber(clinicShare)}
            </div>
          </div>
        </div>
      </form>

      {/* Procedure Customization Modal */}
      {isProcedureModalOpen && (
        <ProcedureManagerModal
          isOpen={isProcedureModalOpen}
          onClose={() => setIsProcedureModalOpen(false)}
          procedures={procedureList}
          onSaveProcedures={handleSaveProcedures}
          showToast={showToast}
        />
      )}

      {/* Amount Presets Customization Modal */}
      {isAmountModalOpen && (
        <AmountPresetManagerModal
          isOpen={isAmountModalOpen}
          onClose={() => setIsAmountModalOpen(false)}
          currencySymbol={currency}
          amountPresets={amountPresetList}
          onSavePresets={handleSaveAmountPresets}
          showToast={showToast}
        />
      )}
    </div>
  );
};
