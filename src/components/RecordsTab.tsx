import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Filter,
  Calendar,
  Edit3,
  Trash2,
  CheckCircle2,
  Clock,
  User,
  Users,
  Coins,
  FileText,
  X,
  Save,
  History,
  ShieldAlert,
  ChevronRight,
  Activity,
  Layers,
} from 'lucide-react';
import { ClinicSettings, PatientEntry, PatientProfile } from '../types';
import { deletePatientEntry, savePatientEntry, getAllPatientProfiles } from '../db/indexedDB';
import { PatientHistoryModal } from './PatientHistoryModal';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';
import { AuditLogModal } from './AuditLogModal';

interface RecordsTabProps {
  entries: PatientEntry[];
  settings: ClinicSettings;
  onEntryUpdated: (entry: PatientEntry) => void;
  onEntryDeleted: (entry: PatientEntry) => void;
  showToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const RecordsTab: React.FC<RecordsTabProps> = ({
  entries,
  settings,
  onEntryUpdated,
  onEntryDeleted,
  showToast,
}) => {
  const currency = settings.currencySymbol || '৳';
  const shareRate = settings.sharePercentage || 40;

  // View mode toggle: 'visits' (individual entries ledger) vs 'profiles' (patient dossiers list)
  const [viewMode, setViewMode] = useState<'visits' | 'profiles'>('visits');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Settled'>('All');
  const [editingEntry, setEditingEntry] = useState<PatientEntry | null>(null);

  // Stored profiles from database
  const [profiles, setProfiles] = useState<PatientProfile[]>([]);

  useEffect(() => {
    getAllPatientProfiles().then(setProfiles);
  }, [entries]);

  // Deletion confirmation modal state
  const [entryToDelete, setEntryToDelete] = useState<PatientEntry | null>(null);

  // Patient history modal state
  const [selectedPatientForHistory, setSelectedPatientForHistory] = useState<string | null>(null);

  // Audit log modal state
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);

  // Compute total visits count per patient name (case-insensitive) across all records
  const patientCountMap = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((e) => {
      const nameKey = (e.patientName || '').trim().toLowerCase();
      if (nameKey) {
        map.set(nameKey, (map.get(nameKey) || 0) + 1);
      }
    });
    return map;
  }, [entries]);

  // Dynamic profiles list combining indexed profiles + any entries not yet indexed
  const dynamicProfiles = useMemo(() => {
    const profileMap = new Map<string, PatientProfile>();

    // Seed from indexed profiles
    profiles.forEach((p) => {
      profileMap.set(p.name.trim().toLowerCase(), { ...p });
    });

    // Recompute accurately from current entries
    entries.forEach((e) => {
      const key = (e.patientName || '').trim().toLowerCase();
      if (!key) return;

      if (!profileMap.has(key)) {
        profileMap.set(key, {
          id: key,
          name: e.patientName.trim(),
          totalVisits: 1,
          totalBilled: e.receivedAmount,
          totalDoctorShare: e.doctorShare,
          firstVisitDate: e.date,
          lastVisitDate: e.date,
          procedures: [e.procedure],
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        });
      } else {
        const existing = profileMap.get(key)!;
        // Count from scratch if needed or use entry details
      }
    });

    // Recalculate true stats directly from entries for maximum consistency
    const grouped = new Map<string, PatientEntry[]>();
    entries.forEach((e) => {
      const key = (e.patientName || '').trim().toLowerCase();
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(e);
    });

    const result: PatientProfile[] = [];
    grouped.forEach((patientEntries, key) => {
      const sorted = [...patientEntries].sort((a, b) => b.date.localeCompare(a.date));
      const firstDate = sorted[sorted.length - 1].date;
      const lastDate = sorted[0].date;
      const totalBilled = patientEntries.reduce((sum, item) => sum + (item.receivedAmount || 0), 0);
      const totalDoctorShare = patientEntries.reduce((sum, item) => sum + (item.doctorShare || 0), 0);
      const procList = Array.from(new Set(patientEntries.map((p) => p.procedure).filter(Boolean)));
      const displayName = sorted[0].patientName || key;

      result.push({
        id: key,
        name: displayName,
        totalVisits: patientEntries.length,
        totalBilled,
        totalDoctorShare,
        firstVisitDate: firstDate,
        lastVisitDate: lastDate,
        procedures: procList,
        createdAt: sorted[sorted.length - 1].createdAt,
        updatedAt: sorted[0].updatedAt,
      });
    });

    // Sort by last visit descending, then visits desc
    result.sort((a, b) => b.lastVisitDate.localeCompare(a.lastVisitDate) || b.totalVisits - a.totalVisits);
    return result;
  }, [profiles, entries]);

  // Filtered profiles for profiles view
  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return dynamicProfiles;
    const q = searchQuery.toLowerCase();
    return dynamicProfiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.procedures.some((pr) => pr.toLowerCase().includes(q))
    );
  }, [dynamicProfiles, searchQuery]);

  // Filtered entries for visits view
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Status filter
      if (statusFilter !== 'All' && entry.settlementStatus !== statusFilter) {
        return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchName = entry.patientName?.toLowerCase().includes(query);
        const matchProc = entry.procedure?.toLowerCase().includes(query);
        const matchRemarks = entry.remarks?.toLowerCase().includes(query);
        const matchBatch = entry.settlementId?.toLowerCase().includes(query);
        const matchDate = entry.date?.includes(query);
        if (!matchName && !matchProc && !matchRemarks && !matchBatch && !matchDate) {
          return false;
        }
      }

      return true;
    });
  }, [entries, statusFilter, searchQuery]);

  // Aggregate stats of filtered entries
  const stats = useMemo(() => {
    const totalVisits = filteredEntries.length;
    const totalGross = filteredEntries.reduce((sum, e) => sum + e.receivedAmount, 0);
    const totalDoctorShare = filteredEntries.reduce((sum, e) => sum + e.doctorShare, 0);
    return { totalVisits, totalGross, totalDoctorShare };
  }, [filteredEntries]);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-BD').format(Math.round(num));
  };

  const handleConfirmDelete = async () => {
    if (!entryToDelete) return;

    try {
      await deletePatientEntry(entryToDelete.id);
      // Pass the full entry up so the app can offer an Undo action
      onEntryDeleted(entryToDelete);
      setEntryToDelete(null);
    } catch (err: any) {
      showToast('Error', err?.message || 'Failed to delete record', 'error');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;

    try {
      const receivedAmount = Math.max(0, parseFloat(String(editingEntry.receivedAmount)) || 0);
      const doctorShare = Math.round(receivedAmount * (shareRate / 100));

      const updated: PatientEntry = {
        ...editingEntry,
        receivedAmount,
        doctorShare,
        updatedAt: Date.now(),
      };

      await savePatientEntry(updated);
      onEntryUpdated(updated);
      setEditingEntry(null);
      showToast('Record Updated', `Successfully updated ${updated.patientName}`, 'success');
    } catch (err: any) {
      showToast('Failed to Update', err?.message, 'error');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-24 animate-in fade-in duration-200">
      {/* Search Bar & Filter Header */}
      <div className="ios-glass-card rounded-3xl p-4 sm:p-5 space-y-3">
        {/* View Mode Switcher: Visits Ledger vs Patient Profiles */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 flex-wrap gap-2">
          <div className="ios-glass-subtle flex items-center gap-1 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => setViewMode('visits')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95 ${
                viewMode === 'visits'
                  ? 'bg-white/85 text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-indigo-600" />
              <span>Visits Ledger ({filteredEntries.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('profiles')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95 ${
                viewMode === 'profiles'
                  ? 'bg-white/85 text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              <span>Patient Profiles ({filteredProfiles.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsAuditModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
              title="View Financial & Clinical Audit Trail"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Audit Trail</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={
                viewMode === 'profiles'
                  ? 'Search patient profile, past treatments...'
                  : 'Search patient, procedure, notes, or batch ID...'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2.5 rounded-2xl bg-white/70 border border-white/70 text-slate-800 text-xs font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter Tabs (visible only in visits ledger view) */}
          {viewMode === 'visits' && (
            <div className="flex items-center gap-1.5 self-start sm:self-auto shrink-0 flex-wrap">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-2xl">
                {(['All', 'Pending', 'Settled'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setStatusFilter(filter)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition active:scale-95 ${
                      statusFilter === filter
                        ? 'bg-white/85 text-indigo-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Filter Summary Stats Strip */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
          <span>
            {viewMode === 'profiles' ? (
              <>
                Showing <strong className="text-slate-800">{filteredProfiles.length}</strong> active patient profiles
              </>
            ) : (
              <>
                Showing <strong className="text-slate-800">{stats.totalVisits}</strong> visits
              </>
            )}
          </span>
          <div className="flex items-center gap-3">
            <span>
              Doctor {shareRate}% Share:{' '}
              <strong className="text-indigo-600 font-bold">
                {currency} {formatNumber(stats.totalDoctorShare)}
              </strong>
            </span>
            <span className="hidden sm:inline">
              Gross: {currency} {formatNumber(stats.totalGross)}
            </span>
          </div>
        </div>
      </div>

      {/* Mode 1: Patient Profiles Dossiers List */}
      {viewMode === 'profiles' && (
        <div className="space-y-2.5">
          {filteredProfiles.length === 0 ? (
            <div className="ios-glass-card rounded-3xl p-10 text-center space-y-2">
              <Users className="w-8 h-8 text-slate-400 mx-auto opacity-50" />
              <p className="text-slate-600 text-sm font-semibold">No patient profiles match your search.</p>
              <p className="text-slate-400 text-xs">
                Patient profiles are automatically generated whenever you record visits in the Entry tab.
              </p>
            </div>
          ) : (
            filteredProfiles.map((prof) => (
              <div
                key={prof.id}
                onClick={() => setSelectedPatientForHistory(prof.name)}
                className="ios-glass-card-interactive rounded-2xl p-4 cursor-pointer group border border-white/70"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-50 group-hover:bg-indigo-600 group-hover:text-white border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 transition-colors">
                      <User className="w-5 h-5" />
                    </div>

                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition truncate">
                          {prof.name}
                        </h4>
                        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                          {prof.totalVisits} {prof.totalVisits === 1 ? 'Visit' : 'Visits'}
                        </span>
                      </div>

                      {/* Procedures Badge List */}
                      {prof.procedures && prof.procedures.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {prof.procedures.slice(0, 4).map((pr, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium"
                            >
                              {pr}
                            </span>
                          ))}
                          {prof.procedures.length > 4 && (
                            <span className="text-[10px] text-slate-400 font-medium">
                              +{prof.procedures.length - 4} more
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-3 text-[10.5px] text-slate-400 pt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          Last: {prof.lastVisitDate}
                        </span>
                        {prof.firstVisitDate !== prof.lastVisitDate && (
                          <span>First: {prof.firstVisitDate}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Financials & Open History Arrow */}
                  <div className="shrink-0 text-right flex items-center gap-3">
                    <div>
                      <div className="text-sm font-black text-indigo-600">
                        {currency} {formatNumber(prof.totalDoctorShare)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Total: {currency} {formatNumber(prof.totalBilled)}
                      </div>
                    </div>

                    <div className="p-1.5 rounded-xl bg-slate-100 group-hover:bg-indigo-50 group-hover:text-indigo-600 text-slate-400 transition">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Mode 2: Patient Entries List */}
      {viewMode === 'visits' && (
      <div className="space-y-2.5">
        {filteredEntries.length === 0 ? (
          <div className="ios-glass-card rounded-3xl p-10 text-center space-y-2">
            <p className="text-slate-500 text-sm font-medium">No records match your filters.</p>
            <p className="text-slate-400 text-xs">
              Try adjusting the search query or status filter.
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const isSettled = entry.settlementStatus === 'Settled';
            const nameKey = (entry.patientName || '').trim().toLowerCase();
            const totalPatientVisits = patientCountMap.get(nameKey) || 1;

            return (
              <div
                key={entry.id}
                className="ios-glass-card-interactive rounded-2xl p-4 group"
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: Patient Info & Auto History Link */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                        #{entry.serial}
                      </span>

                      {/* Clickable Patient Name opens history */}
                      <button
                        type="button"
                        onClick={() => setSelectedPatientForHistory(entry.patientName)}
                        className="text-sm font-bold text-slate-900 hover:text-indigo-600 transition truncate text-left group-hover:underline"
                        title="Click to view full visit history for this patient"
                      >
                        {entry.patientName}
                      </button>

                      {/* Patient History Badge (shows visit count gathered automatically) */}
                      <button
                        type="button"
                        onClick={() => setSelectedPatientForHistory(entry.patientName)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 transition ${
                          totalPatientVisits > 1
                            ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        title="View all visits for this patient"
                      >
                        <History className="w-3 h-3 text-indigo-600" />
                        <span>
                          {totalPatientVisits > 1
                            ? `${totalPatientVisits} Visits History`
                            : 'History'}
                        </span>
                      </button>

                      {/* Settlement Pill */}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isSettled
                            ? 'bg-emerald-100/90 text-emerald-800 border border-emerald-200/60'
                            : 'bg-amber-100/90 text-amber-800 border border-amber-200/60'
                        }`}
                      >
                        {isSettled ? `Settled (${entry.settlementId})` : 'Pending Settlement'}
                      </span>
                    </div>

                    <p className="text-xs font-medium text-slate-700">
                      {entry.procedure}
                    </p>

                    <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {entry.date}
                      </span>
                      {entry.remarks && (
                        <span className="text-slate-500 italic truncate max-w-xs">
                          "{entry.remarks}"
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Amounts & Quick Actions */}
                  <div className="shrink-0 text-right space-y-1.5">
                    <div>
                      <div className="text-sm font-black text-indigo-600">
                        {currency} {formatNumber(entry.doctorShare)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Bill: {currency} {formatNumber(entry.receivedAmount)} ({shareRate}%)
                      </div>
                    </div>

                    {/* Edit / Delete / History Buttons */}
                    <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100 transition">
                      <button
                        onClick={() => setSelectedPatientForHistory(entry.patientName)}
                        className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        title="Patient Visit Timeline"
                      >
                        <History className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingEntry(entry)}
                        className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        title="Edit record"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setEntryToDelete(entry)}
                        className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                        title="Delete record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      )}

      {/* Edit Entry Modal */}
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
                  required
                />
                <span className="text-[10px] text-indigo-600 font-semibold block mt-1">
                  Doctor {shareRate}% Share:{' '}
                  {currency} {formatNumber(Math.round((editingEntry.receivedAmount || 0) * (shareRate / 100)))}
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

      {/* Delete Confirmation Modal */}
      {entryToDelete && (
        <DeleteConfirmationModal
          isOpen={Boolean(entryToDelete)}
          onClose={() => setEntryToDelete(null)}
          entry={entryToDelete}
          onConfirmDelete={handleConfirmDelete}
          currencySymbol={currency}
        />
      )}

      {/* Patient History Timeline Dossier Modal */}
      {selectedPatientForHistory && (
        <PatientHistoryModal
          isOpen={Boolean(selectedPatientForHistory)}
          onClose={() => setSelectedPatientForHistory(null)}
          patientName={selectedPatientForHistory}
          allPatientEntries={entries}
          currencySymbol={currency}
          sharePercentage={shareRate}
        />
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
  );
};
