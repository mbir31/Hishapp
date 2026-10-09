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
  Edit3,
  Save,
  X,
  ListChecks,
  AlertTriangle,
} from 'lucide-react';
import { AmountPreset, ClinicSettings, PatientEntry, PatientProfile } from '../types';
import {
  DEFAULT_AMOUNT_PRESETS,
  DEFAULT_PROCEDURES,
  getNextSerial,
  normalizePatientName,
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
  onEntryUpdated?: (entry: PatientEntry) => void;
  onUpdateSettings?: (settings: ClinicSettings) => void;
  showToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const EntryTab: React.FC<EntryTabProps> = ({
  settings,
  existingEntries = [],
  onEntrySaved,
  onEntryUpdated,
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

  // Edit entry state (for the Today's Entries card)
  const [editingEntry, setEditingEntry] = useState<PatientEntry | null>(null);

  // Duplicate-entry guard: existing entry for the same patient on the selected date
  const [duplicateWarning, setDuplicateWarning] = useState<PatientEntry | null>(null);

  // Clear the duplicate warning whenever the patient name or visit date changes
  useEffect(() => {
    setDuplicateWarning(null);
  }, [patientName, date]);

  // Today's entries shown serially on the bottom card
  const todaysEntries = React.useMemo(() => {
    return existingEntries
      .filter((entry) => entry.date === todayStr)
      .sort((a, b) => a.serial - b.serial);
  }, [existingEntries, todayStr]);

  const todaysTotal = React.useMemo(
    () => todaysEntries.reduce((sum, entry) => sum + (entry.receivedAmount || 0), 0),
    [todaysEntries]
  );

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

    // Duplicate-entry guard: warn if this patient already has an entry on the selected date.
    // If the warning is already showing for this exact entry, the user tapped "Save Anyway".
    const normalizedName = normalizePatientName(patientName.trim());
    const duplicate = existingEntries.find(
      (entry) =>
        entry.date === date && normalizePatientName(entry.patientName) === normalizedName
    );
    if (duplicate && duplicateWarning?.id !== duplicate.id) {
      setDuplicateWarning(duplicate);
      showToast(
        'Possible Duplicate Entry',
        `${patientName.trim()} already has an entry on ${date} (#${duplicate.serial} — ${duplicate.procedure}). Confirm below to save anyway.`,
        'warning'
      );
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

  // Save an edit made from the Today's Entries card
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;

    if (!editingEntry.patientName.trim()) {
      showToast('Patient Name Required', 'Please enter patient name or clinic ID', 'warning');
      return;
    }

    try {
      const receivedAmount = Math.max(0, parseFloat(String(editingEntry.receivedAmount)) || 0);
      const doctorShare = Math.round(receivedAmount * (shareRate / 100));

      const updated: PatientEntry = {
        ...editingEntry,
        patientName: editingEntry.patientName.trim(),
        receivedAmount,
        doctorShare,
        updatedAt: Date.now(),
      };

      await savePatientEntry(updated);
      onEntryUpdated?.(updated);
      setEditingEntry(null);
      showToast('Record Updated', `Successfully updated ${updated.patientName}`, 'success');
    } catch (err: any) {
      showToast('Failed to Update', err?.message || 'Database error occurred', 'error');
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
                      ? 'btn-gradient border-transparent text-white'
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
              className="w-full px-3 py-1.5 rounded-xl bg-white/70 border border-white/70 focus:border-indigo-500 text-slate-800 text-xs font-medium transition outline-none"
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

            <div className="relative glow-field">
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
                className="glow-input w-full px-3 py-2 rounded-xl border border-white/80 focus:border-indigo-400/80 text-slate-900 text-[13px] font-semibold outline-none placeholder:text-slate-400 placeholder:font-medium"
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
              className="w-full px-3 py-1.5 rounded-xl bg-white/70 border border-indigo-300/70 focus:border-indigo-500 text-slate-800 text-xs font-medium transition outline-none"
              required
            />
          ) : (
            <div className="space-y-1.5">
              <select
                value={procedure}
                onChange={(e) => setProcedure(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-white/70 border border-white/70 focus:border-indigo-500 text-slate-800 text-xs font-medium transition outline-none"
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
                          ? 'btn-gradient text-white'
                          : 'bg-white/70 text-slate-600 border border-white/70 hover:bg-white/90'
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

          <div className="relative glow-field">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 z-[3] text-indigo-500/80 font-bold text-sm pointer-events-none">
              {currency}
            </span>
            <input
              type="number"
              placeholder="0"
              value={receivedAmount}
              onChange={(e) => setReceivedAmount(e.target.value)}
              className="glow-input w-full pl-8 pr-3 py-2 rounded-xl border border-white/80 focus:border-indigo-400/80 text-slate-900 text-base font-bold tracking-tight outline-none"
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
                        ? 'btn-gradient btn-gradient--emerald border-transparent text-white'
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
            className="w-full px-3 py-1.5 rounded-xl bg-white/70 border border-white/70 focus:border-indigo-500 text-slate-800 text-xs font-medium transition outline-none placeholder:text-slate-400"
          />
        </div>

        {/* Row 4.5: Duplicate Entry Warning Banner (confirm to save anyway) */}
        {duplicateWarning && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2 animate-in fade-in">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed">
                <p className="font-bold text-amber-900">Possible duplicate entry</p>
                <p className="text-amber-800">
                  <strong>{duplicateWarning.patientName}</strong> already has an entry on{' '}
                  <strong>{duplicateWarning.date}</strong> — #{duplicateWarning.serial} ·{' '}
                  {duplicateWarning.procedure} · {currency}{' '}
                  {formatNumber(duplicateWarning.receivedAmount)}.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDuplicateWarning(null)}
                className="flex-1 py-1.5 rounded-lg ios-glass-subtle border border-amber-300/70 text-amber-900 text-[11px] font-semibold hover:bg-white/80 transition"
              >
                Go Back &amp; Edit
              </button>
              <button
                type="submit"
                className="btn-gradient btn-gradient--amber flex-1 py-1.5 rounded-lg text-white text-[11px] font-bold"
              >
                Save Anyway
              </button>
            </div>
          </div>
        )}

        {/* Row 5: Action Button: Tactile Spring Save Record */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-gradient w-full py-2.5 px-4 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
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

      {/* Today's Entries Card - serial list of entries already made today */}
      <div className="ios-glass-card rounded-2xl p-3.5 sm:p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs sm:text-sm font-bold text-slate-700 flex items-center gap-1.5">
            <ListChecks className="w-4 h-4 text-indigo-600" />
            <span>Today's Entries</span>
            <span className="px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-[10px] font-bold">
              {todaysEntries.length}
            </span>
          </h3>
          {todaysEntries.length > 0 && (
            <span className="text-[10px] text-slate-400 font-semibold">
              Collected: <strong className="text-indigo-600">{currency} {formatNumber(todaysTotal)}</strong>
            </span>
          )}
        </div>

        {todaysEntries.length === 0 ? (
          <p className="text-[11px] text-slate-400 text-center py-3">
            No entries recorded yet today. Saved visits will appear here.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {todaysEntries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2.5 py-2">
                {/* Serial number */}
                <span className="text-[11px] font-mono font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                  #{entry.serial}
                </span>

                {/* Patient name with inline edit button + procedure */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {entry.patientName}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingEntry(entry)}
                      className="p-0.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition shrink-0 active:scale-95"
                      title={`Edit record of ${entry.patientName}`}
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-[10.5px] text-slate-500 truncate">
                    {entry.procedure}
                    {entry.remarks ? ` • ${entry.remarks}` : ''}
                  </p>
                </div>

                {/* Amounts */}
                <div className="text-right shrink-0">
                  <div className="text-xs font-black text-indigo-600">
                    {currency} {formatNumber(entry.receivedAmount)}
                  </div>
                  <div className="text-[9.5px] text-slate-400">
                    Share {currency} {formatNumber(entry.doctorShare)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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

      {/* Edit Entry Modal (from Today's Entries card) */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="ios-glass bg-white/95 rounded-3xl p-5 sm:p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Edit Record #{editingEntry.serial}
              </h3>
              <button
                onClick={() => setEditingEntry(null)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Patient Name</label>
                <input
                  type="text"
                  value={editingEntry.patientName}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, patientName: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-xs font-semibold outline-none"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Dental Procedure</label>
                <input
                  type="text"
                  value={editingEntry.procedure}
                  onChange={(e) => setEditingEntry({ ...editingEntry, procedure: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-xs outline-none"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Date</label>
                <input
                  type="date"
                  value={editingEntry.date}
                  onChange={(e) => setEditingEntry({ ...editingEntry, date: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-xs outline-none"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Received Amount ({currency})
                </label>
                <input
                  type="number"
                  value={editingEntry.receivedAmount}
                  onChange={(e) =>
                    setEditingEntry({
                      ...editingEntry,
                      receivedAmount: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm font-bold outline-none"
                  min="0"
                  step="any"
                  required
                />
                <span className="text-[10px] text-indigo-600 font-semibold block mt-1">
                  Doctor {shareRate}% Share:{' '}
                  {currency}{' '}
                  {formatNumber(Math.round((editingEntry.receivedAmount || 0) * (shareRate / 100)))}
                </span>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Remarks</label>
                <input
                  type="text"
                  value={editingEntry.remarks}
                  onChange={(e) => setEditingEntry({ ...editingEntry, remarks: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-gradient px-4 py-2 rounded-xl text-white font-bold flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Update Record</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
