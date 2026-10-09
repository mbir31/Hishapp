import React, { useState, useMemo } from 'react';
import {
  Scale,
  Calendar,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  FileText,
  Clock,
  ArrowRight,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Receipt,
  Trash2,
  Download,
  Printer,
  Sparkles,
} from 'lucide-react';
import { ClinicSettings, PatientEntry, Settlement } from '../types';
import { deleteSettlement, executeSettlement } from '../db/indexedDB';
import { MonthlySummaryModal } from './MonthlySummaryModal';

interface SettlementTabProps {
  entries: PatientEntry[];
  settlements: Settlement[];
  settings: ClinicSettings;
  onSettlementCompleted: (settlement: Settlement) => void;
  onSettlementDeleted: (settlementId: string) => void;
  showToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const SettlementTab: React.FC<SettlementTabProps> = ({
  entries,
  settlements,
  settings,
  onSettlementCompleted,
  onSettlementDeleted,
  showToast,
}) => {
  const currency = settings.currencySymbol || '৳';
  const todayStr = new Date().toISOString().split('T')[0];

  // Default date range: from 14 days ago to today
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().split('T')[0];
  }, []);

  const [periodFrom, setPeriodFrom] = useState<string>(defaultFrom);
  const [periodTo, setPeriodTo] = useState<string>(todayStr);
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [isMonthlyModalOpen, setIsMonthlyModalOpen] = useState<boolean>(false);

  const shareRate = settings.sharePercentage || 40;

  // Latest settlement carry-forward balance
  const latestSettlement = settlements.length > 0 ? settlements[0] : null;
  const previousDue = latestSettlement ? latestSettlement.dueBalance : 0;

  // Total Outstanding Due (Overall)
  const allPendingEntries = useMemo(() => {
    return entries.filter((e) => e.settlementStatus === 'Pending');
  }, [entries]);

  const allPendingProceduresShare = useMemo(() => {
    return allPendingEntries.reduce((sum, e) => sum + e.doctorShare, 0);
  }, [allPendingEntries]);

  const totalOutstandingOwed = previousDue + allPendingProceduresShare;

  // Selected date-range calculations
  const eligibleEntriesInRange = useMemo(() => {
    return allPendingEntries.filter((e) => e.date >= periodFrom && e.date <= periodTo);
  }, [allPendingEntries, periodFrom, periodTo]);

  const periodShare = useMemo(() => {
    return eligibleEntriesInRange.reduce((sum, e) => sum + e.doctorShare, 0);
  }, [eligibleEntriesInRange]);

  const totalClaimable = periodShare + previousDue;
  const parsedReceived = Math.max(0, parseFloat(amountReceived) || 0);
  const dueBalancePreview = totalClaimable - parsedReceived;

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-BD').format(Math.round(num));
  };

  const handleApplyPreset = (type: 'all' | 'month' | '14days' | 'week') => {
    const today = new Date();
    const end = today.toISOString().split('T')[0];
    setPeriodTo(end);

    if (type === 'all') {
      // Find oldest pending entry or 60 days ago
      if (allPendingEntries.length > 0) {
        const oldest = allPendingEntries.reduce((prev, curr) =>
          curr.date < prev.date ? curr : prev
        );
        setPeriodFrom(oldest.date);
      } else {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        setPeriodFrom(d.toISOString().split('T')[0]);
      }
    } else if (type === 'month') {
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
        .toISOString()
        .split('T')[0];
      setPeriodFrom(firstOfMonth);
    } else if (type === '14days') {
      const d = new Date();
      d.setDate(d.getDate() - 14);
      setPeriodFrom(d.toISOString().split('T')[0]);
    } else if (type === 'week') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setPeriodFrom(d.toISOString().split('T')[0]);
    }
  };

  const handleFillFullClaimable = () => {
    setAmountReceived(String(Math.max(0, totalClaimable)));
  };

  const handleConfirmSettlement = async (e: React.FormEvent) => {
    e.preventDefault();

    if (eligibleEntriesInRange.length === 0 && previousDue === 0) {
      showToast(
        'Nothing to Settle',
        'There are no pending procedures in this date range and no previous arrears.',
        'warning'
      );
      return;
    }

    if (parsedReceived < 0) {
      showToast('Invalid Amount', 'Received amount cannot be negative', 'warning');
      return;
    }

    try {
      setIsSubmitting(true);
      const newSettlement = await executeSettlement({
        periodFrom,
        periodTo,
        amountReceived: parsedReceived,
        remarks: remarks.trim(),
      });

      onSettlementCompleted(newSettlement);
      setAmountReceived('');
      setRemarks('');

      showToast(
        `Settlement ${newSettlement.settlementId} Confirmed!`,
        `Settled ${newSettlement.patientCount} patients. Carried forward balance: ${currency} ${formatNumber(
          newSettlement.dueBalance
        )}.`,
        'success'
      );
    } catch (err: any) {
      console.error('Settlement error:', err);
      showToast('Settlement Failed', err?.message || 'Database transaction error', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSettlement = async (sId: string) => {
    if (
      !confirm(
        `Revert settlement ${sId}? All associated patient visits will return to 'Pending' status.`
      )
    ) {
      return;
    }

    try {
      await deleteSettlement(sId);
      onSettlementDeleted(sId);
      showToast('Settlement Reverted', `${sId} deleted and visits returned to Pending`, 'info');
    } catch (err: any) {
      showToast('Failed to revert', err?.message, 'error');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-24 animate-in fade-in duration-200">
      {/* 1. Outstanding Balance Card (Prominent Header) */}
      <div className="ios-glass-card rounded-3xl p-6 bg-gradient-to-br from-indigo-600/85 via-indigo-700/80 to-sky-700/85 text-white shadow-xl shadow-indigo-700/20 relative overflow-hidden backdrop-blur-2xl">
        <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-wider uppercase bg-white/15 px-3 py-1 rounded-full border border-white/20">
              Outstanding Clinical Ledger
            </span>
            <div className="flex items-center gap-1.5 text-xs bg-black/20 px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Carry-Forward Active</span>
            </div>
          </div>

          <div>
            <p className="text-xs text-indigo-100 font-medium">Total Unsettled Due Owed to You</p>
            <div className="text-3xl sm:text-4xl font-black tracking-tight mt-1">
              {currency} {formatNumber(totalOutstandingOwed)}
            </div>
          </div>

          {/* Arrears and Pending Visits decomposition */}
          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/20 text-xs">
            <div>
              <p className="text-indigo-200 text-[11px]">Previous Carry-Over Arrears</p>
              <p className="font-extrabold text-white text-base">
                {currency} {formatNumber(previousDue)}
              </p>
            </div>
            <div>
              <p className="text-indigo-200 text-[11px]">Pending Procedures ({shareRate}%)</p>
              <p className="font-extrabold text-white text-base">
                {currency} {formatNumber(allPendingProceduresShare)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Summary PDF Export Banner */}
      <div className="ios-glass-card rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-indigo-200/70 bg-gradient-to-r from-indigo-50/70 via-white/40 to-sky-50/70">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-indigo-600/30">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900 leading-tight">
              Monthly Settlement Statement
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Export official formatted PDF with 40% share, patient volume &amp; due balance
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsMonthlyModalOpen(true)}
          className="self-start sm:self-auto px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-indigo-600/20 transition-all shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>Export Monthly PDF</span>
        </button>
      </div>

      {/* Main Settlement Reconciler Form */}
      <form onSubmit={handleConfirmSettlement} className="ios-glass-card rounded-3xl p-5 sm:p-6 space-y-6">
        <div>
          <h3 className="text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Scale className="w-5 h-5 text-indigo-600" />
            <span>Reconcile Clinical Settlement Batch</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Select visit date range to calculate claimable compensation and record payment.
          </p>
        </div>

        {/* 2. Date Range Filter & Presets */}
        <div className="space-y-2.5 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/60">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-600" />
              <span>Settlement Period Range</span>
            </label>
            {/* Quick Filter Presets */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleApplyPreset('all')}
                className="px-2 py-0.5 text-[10px] font-semibold rounded-lg ios-glass-subtle border border-white/70 text-slate-700 hover:bg-white/80 transition"
              >
                All Pending
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('14days')}
                className="px-2 py-0.5 text-[10px] font-semibold rounded-lg ios-glass-subtle border border-white/70 text-slate-700 hover:bg-white/80 transition"
              >
                Last 14d
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('month')}
                className="px-2 py-0.5 text-[10px] font-semibold rounded-lg ios-glass-subtle border border-white/70 text-slate-700 hover:bg-white/80 transition"
              >
                This Month
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase">From</span>
              <input
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-white/70 border border-white/70 text-xs font-medium text-slate-800 focus:border-indigo-500 outline-none"
                required
              />
            </div>
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase">To</span>
              <input
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-white/70 border border-white/70 text-xs font-medium text-slate-800 focus:border-indigo-500 outline-none"
                required
              />
            </div>
          </div>
        </div>

        {/* 3. Calculated Settlement Summary for Selected Range */}
        <div className="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600">Pending Patients in Period:</span>
            <span className="font-bold text-slate-900">{eligibleEntriesInRange.length} visits</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600">Doctor's {shareRate}% Share for Period:</span>
            <span className="font-bold text-indigo-600">
              {currency} {formatNumber(periodShare)}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600">Previous Arrears Carried Over:</span>
            <span className="font-bold text-amber-700">
              {currency} {formatNumber(previousDue)}
            </span>
          </div>

          <div className="pt-2 border-t border-indigo-200/60 flex items-center justify-between text-sm">
            <span className="font-extrabold text-slate-900">Total Claimable Amount:</span>
            <span className="font-black text-indigo-700 text-base">
              {currency} {formatNumber(totalClaimable)}
            </span>
          </div>
        </div>

        {/* 4. Settlement Payment Input & Live Balance Preview */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-indigo-600" />
              <span>Amount Received from Clinic ({currency})</span>
            </label>
            <button
              type="button"
              onClick={handleFillFullClaimable}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition underline underline-offset-2"
            >
              Fill Full ({currency} {formatNumber(totalClaimable)})
            </button>
          </div>

          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-base">
              {currency}
            </span>
            <input
              type="number"
              placeholder="0"
              value={amountReceived}
              onChange={(e) => setAmountReceived(e.target.value)}
              className="w-full pl-9 pr-3.5 py-3 rounded-2xl bg-white/70 border border-white/70 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-slate-900 text-xl font-bold tracking-tight transition outline-none"
              min="0"
              step="any"
              required
            />
          </div>

          {/* LIVE BALANCE PREVIEW (REMAINING DUE / ADVANCE ADJUSTED) */}
          <div
            className={`p-4 rounded-2xl border transition-all ${
              dueBalancePreview > 0
                ? 'bg-amber-50/60 border-amber-200 text-amber-900'
                : dueBalancePreview < 0
                ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                : 'bg-emerald-50/40 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-80">
                  {dueBalancePreview > 0
                    ? 'Remaining Due (Carried Forward to Next Batch)'
                    : dueBalancePreview < 0
                    ? 'Advance Paid by Clinic (Credit)'
                    : 'Exact Settlement (Zero Due)'}
                </span>
                <div className="text-xl font-black mt-0.5">
                  {currency} {formatNumber(Math.abs(dueBalancePreview))}
                </div>
              </div>

              <div className="text-right text-xs">
                {dueBalancePreview > 0 ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-200/80 font-bold text-amber-800">
                    Underpaid
                  </span>
                ) : dueBalancePreview < 0 ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-200/80 font-bold text-emerald-800">
                    Overpaid
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-200/80 font-bold text-emerald-800">
                    Cleared
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Settlement Notes / Remarks */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>Settlement Notes</span>
              <span className="text-[10px] font-normal text-slate-400">
                (e.g., Cheque number, bank transfer, remainder date)
              </span>
            </label>
            <input
              type="text"
              placeholder="e.g. Paid via Bank transfer #TXN9928, balance ৳1,000 next Thursday"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-2xl bg-white/70 border border-white/70 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-slate-800 text-xs sm:text-sm font-medium transition outline-none"
            />
          </div>
        </div>

        {/* 5. Action Button: Confirm Settlement */}
        <button
          type="submit"
          disabled={isSubmitting || (eligibleEntriesInRange.length === 0 && previousDue === 0)}
          className="w-full py-3.5 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-bold text-sm sm:text-base shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CheckCircle2 className="w-5 h-5" />
          <span>{isSubmitting ? 'Finalizing Batch...' : 'Confirm Settlement'}</span>
        </button>
      </form>

      {/* 6. Settlement History Accordion */}
      <div className="ios-glass-card rounded-3xl p-5">
        <button
          type="button"
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between text-left group"
        >
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Settlement History Log ({settlements.length})
            </h3>
          </div>
          {showHistory ? (
            <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-slate-700" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-700" />
          )}
        </button>

        {showHistory && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            {settlements.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">
                No settlements finalized yet.
              </div>
            ) : (
              settlements.map((s) => (
                <div
                  key={s.settlementId}
                  className="ios-glass-card p-3.5 rounded-2xl space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                        {s.settlementId}
                      </span>
                      <span className="text-[11px] text-slate-400 ml-2">
                        {s.settlementDate} ({s.patientCount} patients)
                      </span>
                    </div>

                    <button
                      onClick={() => handleDeleteSettlement(s.settlementId)}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                      title="Revert settlement"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[11px] pt-1">
                    <div>
                      <span className="text-slate-400 block">Total Payable</span>
                      <span className="font-bold text-slate-800">
                        {currency} {formatNumber(s.totalPayable)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Received</span>
                      <span className="font-bold text-emerald-600">
                        {currency} {formatNumber(s.amountReceived)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Carried Forward Due</span>
                      <span
                        className={`font-black ${
                          s.dueBalance > 0 ? 'text-amber-600' : 'text-slate-700'
                        }`}
                      >
                        {currency} {formatNumber(s.dueBalance)}
                      </span>
                    </div>
                  </div>

                  {s.remarks && (
                    <p className="text-[10px] text-slate-500 italic bg-slate-50/80 p-1.5 rounded-lg">
                      Note: {s.remarks}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Monthly Summary Formatted PDF Modal */}
      {isMonthlyModalOpen && (
        <MonthlySummaryModal
          isOpen={isMonthlyModalOpen}
          onClose={() => setIsMonthlyModalOpen(false)}
          entries={entries}
          settlements={settlements}
          settings={settings}
          showToast={showToast}
        />
      )}
    </div>
  );
};
