import React, { useMemo } from 'react';
import {
  TrendingUp,
  Calendar,
  AlertCircle,
  Users,
  ArrowUpRight,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  Clock,
  PlusCircle,
  Scale,
} from 'lucide-react';
import { ClinicSettings, PatientEntry, Settlement, TabType } from '../types';

interface DashboardTabProps {
  entries: PatientEntry[];
  settlements: Settlement[];
  settings: ClinicSettings;
  onNavigateTab: (tab: TabType) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  entries,
  settlements,
  settings,
  onNavigateTab,
}) => {
  const currency = settings.currencySymbol || '৳';

  // Metrics computation
  const metrics = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthPrefix = todayStr.substring(0, 7); // YYYY-MM

    // Today metrics
    const todayEntries = entries.filter((e) => e.date === todayStr);
    const todayEarnings = todayEntries.reduce((sum, e) => sum + e.doctorShare, 0);
    const todayGrossRevenue = todayEntries.reduce((sum, e) => sum + e.receivedAmount, 0);
    const todayPatientCount = todayEntries.length;

    // Current Month metrics
    const monthEntries = entries.filter((e) => e.date.startsWith(currentMonthPrefix));
    const monthEarnings = monthEntries.reduce((sum, e) => sum + e.doctorShare, 0);
    const monthGrossRevenue = monthEntries.reduce((sum, e) => sum + e.receivedAmount, 0);
    const monthPatientCount = monthEntries.length;

    // Latest settlement for carry-forward balance
    const latestSettlement = settlements.length > 0 ? settlements[0] : null;
    const previousCarryForwardDue = latestSettlement ? latestSettlement.dueBalance : 0;

    // Pending entries (all time un-settled)
    const pendingEntries = entries.filter((e) => e.settlementStatus === 'Pending');
    const pendingProceduresShare = pendingEntries.reduce((sum, e) => sum + e.doctorShare, 0);

    // Total Unsettled Due = Previous carry-forward + pending procedures doctor share
    const totalUnsettledDue = previousCarryForwardDue + pendingProceduresShare;

    // Procedure distribution breakdown
    const procedureMap = new Map<string, { count: number; totalGross: number; doctorShare: number }>();
    monthEntries.forEach((e) => {
      const proc = e.procedure?.trim() || 'General Procedure';
      const existing = procedureMap.get(proc) || { count: 0, totalGross: 0, doctorShare: 0 };
      procedureMap.set(proc, {
        count: existing.count + 1,
        totalGross: existing.totalGross + e.receivedAmount,
        doctorShare: existing.doctorShare + e.doctorShare,
      });
    });

    const proceduresSorted = Array.from(procedureMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.doctorShare - a.doctorShare);

    const maxProcShare = proceduresSorted.length > 0 ? proceduresSorted[0].doctorShare : 1;

    return {
      todayEarnings,
      todayGrossRevenue,
      todayPatientCount,
      monthEarnings,
      monthGrossRevenue,
      monthPatientCount,
      previousCarryForwardDue,
      pendingProceduresShare,
      totalUnsettledDue,
      pendingCount: pendingEntries.length,
      proceduresSorted,
      maxProcShare,
      recentEntries: entries.slice(0, 5),
    };
  }, [entries, settlements]);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-BD').format(Math.round(num));
  };

  const sharePercent = settings.sharePercentage || 40;

  return (
    <div className="space-y-5 pb-24 animate-in fade-in duration-300">
      {/* 4 Frosted-Glass Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Today's Earnings */}
        <div className="ios-glass-card rounded-3xl p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Today's Earnings ({sharePercent}%)</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              {currency} {formatNumber(metrics.todayEarnings)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              from {currency} {formatNumber(metrics.todayGrossRevenue)} billed
            </p>
          </div>
        </div>

        {/* Card 2: Current Month Earnings */}
        <div className="ios-glass-card rounded-3xl p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">This Month ({sharePercent}%)</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-black text-indigo-600 tracking-tight">
              {currency} {formatNumber(metrics.monthEarnings)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Gross: {currency} {formatNumber(metrics.monthGrossRevenue)}
            </p>
          </div>
        </div>

        {/* Card 3: Total Unsettled Due (Carry-forward + pending) */}
        <div className="ios-glass-card rounded-3xl p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden group border-amber-300/40 bg-amber-50/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800">Total Unsettled Due</span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-black text-amber-900 tracking-tight">
              {currency} {formatNumber(metrics.totalUnsettledDue)}
            </div>
            <p className="text-[11px] text-amber-700/80 mt-0.5 font-medium">
              {metrics.pendingCount} pending visits
            </p>
          </div>
        </div>

        {/* Card 4: Patient Volume */}
        <div className="ios-glass-card rounded-3xl p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Patient Volume</span>
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              {metrics.monthPatientCount} <span className="text-xs font-medium text-slate-500">this month</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Today: <strong className="text-slate-800 font-semibold">{metrics.todayPatientCount}</strong> visits
            </p>
          </div>
        </div>
      </div>

      {/* Outstanding Due Detailed Breakdown Glass Card */}
      <div className="ios-glass-card rounded-3xl p-5 border border-amber-200/60 bg-gradient-to-r from-amber-50/30 via-white/60 to-indigo-50/30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Unsettled Carry-Forward Ledger
              </h3>
            </div>
            <p className="text-xs text-slate-600">
              The clinic currently owes you a total of{' '}
              <strong className="text-amber-900 font-bold">
                {currency} {formatNumber(metrics.totalUnsettledDue)}
              </strong>
              . This combines unsettled clinical visits and previous carry-over debt.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-white/70 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/80 shadow-sm shrink-0">
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold text-slate-400">Previous Arrears</p>
              <p className="text-xs font-bold text-slate-700">
                {currency} {formatNumber(metrics.previousCarryForwardDue)}
              </p>
            </div>
            <span className="text-slate-300 font-light text-xl">+</span>
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold text-slate-400">Current Unsettled</p>
              <p className="text-xs font-bold text-indigo-600">
                {currency} {formatNumber(metrics.pendingProceduresShare)}
              </p>
            </div>
            <span className="text-slate-300 font-light text-xl">=</span>
            <div className="text-right pl-1">
              <p className="text-[10px] uppercase font-extrabold text-amber-600">Net Due</p>
              <p className="text-sm font-black text-amber-900">
                {currency} {formatNumber(metrics.totalUnsettledDue)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Procedure Breakdown & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Procedure Distribution */}
        <div className="ios-glass-card rounded-3xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Procedure Breakdown (This Month)</h3>
              <p className="text-xs text-slate-500">Distribution of {sharePercent}% clinical earnings</p>
            </div>
            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
              {metrics.proceduresSorted.length} Types
            </span>
          </div>

          {metrics.proceduresSorted.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              No clinical procedures recorded this month yet.
            </div>
          ) : (
            <div className="space-y-3">
              {metrics.proceduresSorted.map((proc) => {
                const percentage = Math.round((proc.doctorShare / (metrics.monthEarnings || 1)) * 100);
                const widthPercent = Math.min(
                  100,
                  Math.round((proc.doctorShare / (metrics.maxProcShare || 1)) * 100)
                );

                return (
                  <div key={proc.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-slate-800 truncate">{proc.name}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">({proc.count} visits)</span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-bold text-indigo-600">
                          {currency} {formatNumber(proc.doctorShare)}
                        </span>
                        <span className="text-[10px] text-slate-400 ml-1">({percentage}%)</span>
                      </div>
                    </div>
                    {/* Visual Progress bar */}
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-indigo-500 to-sky-400 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(6, widthPercent)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Clinical Visits Stream */}
        <div className="ios-glass-card rounded-3xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Recent Patient Records</h3>
                <p className="text-xs text-slate-500">Latest entries & settlement flags</p>
              </div>
              <button
                onClick={() => onNavigateTab('history')}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 active:scale-95 transition"
              >
                <span>View All</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {metrics.recentEntries.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No patient entries found. Tap "New Entry" to add one!
              </div>
            ) : (
              <div className="space-y-2.5">
                {metrics.recentEntries.map((entry) => {
                  const isSettled = entry.settlementStatus === 'Settled';
                  return (
                    <div
                      key={entry.id}
                      className="p-3 rounded-2xl bg-white/60 hover:bg-white/90 border border-white/80 shadow-xs flex items-center justify-between gap-3 transition"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-slate-900 truncate">
                            {entry.patientName}
                          </h4>
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                              isSettled
                                ? 'bg-emerald-100/80 text-emerald-700'
                                : 'bg-amber-100/80 text-amber-700'
                            }`}
                          >
                            {isSettled ? 'Settled' : 'Pending'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {entry.procedure} • {entry.date}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-xs font-extrabold text-indigo-600">
                          {currency} {formatNumber(entry.doctorShare)}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          Bill: {currency} {formatNumber(entry.receivedAmount)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100/80 flex items-center justify-between text-xs text-slate-500">
            <span>Formula: Doctor Share = Bill × {(sharePercent / 100).toFixed(2)}</span>
            <span className="font-semibold text-indigo-600">{sharePercent}% Share Applied</span>
          </div>
        </div>
      </div>
    </div>
  );
};
