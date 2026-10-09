import React, { useMemo, useState } from 'react';
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
  BarChart3,
  Medal,
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

    // Top patients this month, ranked by doctor share
    const patientMap = new Map<string, { name: string; visits: number; share: number; gross: number }>();
    monthEntries.forEach((e) => {
      const key = (e.patientName || '').trim().toLowerCase();
      if (!key) return;
      const cur = patientMap.get(key) || { name: e.patientName.trim(), visits: 0, share: 0, gross: 0 };
      cur.visits += 1;
      cur.share += e.doctorShare;
      cur.gross += e.receivedAmount;
      patientMap.set(key, cur);
    });
    const topPatients = Array.from(patientMap.values())
      .sort((a, b) => b.share - a.share)
      .slice(0, 5);

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
      topPatients,
      recentEntries: entries.slice(0, 5),
    };
  }, [entries, settlements]);

  // ── Earnings trend (7 / 30 day) ──────────────────────────────────
  const [trendDays, setTrendDays] = useState<7 | 30>(7);

  // Same UTC-based date convention used when entries are saved
  const fmtDate = (d: Date) => d.toISOString().split('T')[0];

  const dailySeries = useMemo(() => {
    const series: { date: string; label: string; share: number; gross: number; count: number }[] = [];
    const today = new Date();
    for (let i = trendDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = fmtDate(d);
      const dayEntries = entries.filter((e) => e.date === dateStr);
      series.push({
        date: dateStr,
        label:
          trendDays === 7
            ? d.toLocaleDateString('en-BD', { weekday: 'short' })
            : d.toLocaleDateString('en-BD', { day: 'numeric', month: 'short' }),
        share: dayEntries.reduce((sum, e) => sum + e.doctorShare, 0),
        gross: dayEntries.reduce((sum, e) => sum + e.receivedAmount, 0),
        count: dayEntries.length,
      });
    }
    return series;
  }, [entries, trendDays]);

  const trendTotals = useMemo(() => {
    const share = dailySeries.reduce((sum, d) => sum + d.share, 0);
    const gross = dailySeries.reduce((sum, d) => sum + d.gross, 0);
    const count = dailySeries.reduce((sum, d) => sum + d.count, 0);
    const best = dailySeries.reduce(
      (bestDay, d) => (d.share > bestDay.share ? d : bestDay),
      dailySeries[0]
    );
    return { share, gross, count, best };
  }, [dailySeries]);

  // SVG chart geometry (pure SVG, no chart library)
  const chartW = dailySeries.length * 20 + 12;
  const chartTop = 16;
  const chartBottom = 118;
  const chartHeight = chartBottom - chartTop;
  const maxShare = Math.max(1, ...dailySeries.map((d) => d.share));
  const maxCount = Math.max(1, ...dailySeries.map((d) => d.count));

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

          <div className="ios-glass-subtle flex items-center gap-3 px-4 py-3 rounded-2xl shrink-0">
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

      {/* Earnings Trend Chart (7/30 day) + Top Patients of the Month */}
      <div className="ios-glass-card rounded-3xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          {/* Left: Trend chart */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-indigo-600" />
                  Earnings Trend
                </h3>
                <p className="text-xs text-slate-500">
                  Doctor {sharePercent}% share per day
                </p>
              </div>
              {/* 7 / 30 day toggle */}
              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-xl shrink-0">
                {([7, 30] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setTrendDays(d)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition active:scale-95 ${
                      trendDays === d
                        ? 'bg-white/85 text-indigo-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {d}D
                  </button>
                ))}
              </div>
            </div>

            {/* Period summary chips */}
            <div className="flex items-center gap-3 text-[10.5px] text-slate-500 mt-2.5 mb-1 flex-wrap">
              <span>
                <strong className="text-slate-800">{trendTotals.count}</strong> visits
              </span>
              <span>
                <strong className="text-indigo-600">
                  {currency} {formatNumber(trendTotals.share)}
                </strong>{' '}
                share
              </span>
              <span className="hidden sm:inline">
                Best day: <strong className="text-slate-800">{trendTotals.best.label}</strong>
              </span>
            </div>

            {trendTotals.share === 0 && trendTotals.count === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                No visits recorded in this period yet.
              </div>
            ) : (
              <svg
                viewBox={`0 0 ${chartW} 136`}
                className="w-full h-44"
                role="img"
                aria-label={`Daily earnings trend for the last ${trendDays} days`}
              >
                <defs>
                  <linearGradient id="trendBarFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#a5b4fc" />
                  </linearGradient>
                </defs>

                {/* Gridlines */}
                {[0, 0.5, 1].map((ratio) => (
                  <line
                    key={ratio}
                    x1="4"
                    x2={chartW - 4}
                    y1={chartBottom - ratio * chartHeight}
                    y2={chartBottom - ratio * chartHeight}
                    stroke="#e2e8f0"
                    strokeWidth="1"
                    strokeDasharray={ratio === 1 ? '0' : '4 4'}
                  />
                ))}

                {/* Max value label */}
                <text x="4" y="11" fontSize="9" fill="#94a3b8" fontWeight="bold">
                  {currency} {formatNumber(maxShare)}
                </text>

                {/* Patient-count sparkline */}
                {maxCount > 0 && (
                  <polyline
                    points={dailySeries
                      .map((d, i) => {
                        const cx = 6 + i * 20 + 10;
                        const cy =
                          d.count > 0
                            ? chartBottom - (d.count / maxCount) * chartHeight
                            : chartBottom;
                        return `${cx},${cy}`;
                      })
                      .join(' ')}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {trendDays === 7 &&
                  dailySeries.map((d, i) => {
                    const cx = 6 + i * 20 + 10;
                    const cy =
                      d.count > 0 ? chartBottom - (d.count / maxCount) * chartHeight : chartBottom;
                    return d.count > 0 ? (
                      <circle key={`dot-${i}`} cx={cx} cy={cy} r="2.2" fill="#10b981" />
                    ) : null;
                  })}

                {/* Earnings bars with native hover tooltips */}
                {dailySeries.map((d, i) => {
                  const barH =
                    d.share > 0 ? Math.max(2, (d.share / maxShare) * chartHeight) : 0;
                  const isToday = i === dailySeries.length - 1;
                  return (
                    <g key={d.date}>
                      <title>
                        {`${d.date} — ${currency} ${formatNumber(d.share)} share · ${d.count} patient${d.count === 1 ? '' : 's'} · gross ${currency} ${formatNumber(d.gross)}`}
                      </title>
                      <rect
                        x={6 + i * 20 + 5}
                        y={chartBottom - barH}
                        width="10"
                        height={barH}
                        rx="3"
                        fill={isToday ? '#4f46e5' : 'url(#trendBarFill)'}
                        opacity={d.share > 0 ? 1 : 0.25}
                      />
                    </g>
                  );
                })}

                {/* X-axis day labels (thinned out for the 30-day view) */}
                {dailySeries.map((d, i) => {
                  const showLabel = trendDays === 7 || i % 5 === 0 || i === dailySeries.length - 1;
                  if (!showLabel) return null;
                  return (
                    <text
                      key={`lbl-${d.date}`}
                      x={6 + i * 20 + 10}
                      y="132"
                      fontSize="8.5"
                      fill="#94a3b8"
                      textAnchor="middle"
                    >
                      {d.label}
                    </text>
                  );
                })}
              </svg>
            )}

            {/* Legend */}
            <div className="flex items-center gap-4 mt-1 text-[10px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
                Doctor share ({currency})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 rounded-full bg-emerald-500" />
                Patients per day
              </span>
            </div>
          </div>

          {/* Right: Top patients this month */}
          <div className="sm:w-56 shrink-0 sm:border-l sm:border-slate-100 sm:pl-5">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Medal className="w-4 h-4 text-amber-500" />
              Top Patients
            </h3>
            <p className="text-xs text-slate-500 mb-2.5">This month by {sharePercent}% share</p>

            {metrics.topPatients.length === 0 ? (
              <p className="text-xs text-slate-400 py-4">No patients recorded this month yet.</p>
            ) : (
              <div className="space-y-2.5">
                {metrics.topPatients.map((p, idx) => (
                  <div key={p.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${
                          idx === 0
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate">{p.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {p.visits} visit{p.visits === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-indigo-600 shrink-0">
                      {currency} {formatNumber(p.share)}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
                onClick={() => onNavigateTab('records')}
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
                      className="ios-glass-card-interactive p-3 rounded-2xl flex items-center justify-between gap-3"
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
