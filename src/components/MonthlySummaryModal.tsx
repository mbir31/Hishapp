import React, { useState, useMemo } from 'react';
import {
  FileText,
  Download,
  Printer,
  X,
  Calendar,
  Users,
  Coins,
  Scale,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  Building2,
} from 'lucide-react';
import { ClinicSettings, PatientEntry, Settlement } from '../types';
import { exportMonthlySummaryPDF, generateMonthlySummaryData } from '../utils/pdfExport';

interface MonthlySummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: PatientEntry[];
  settlements: Settlement[];
  settings: ClinicSettings;
  showToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const MonthlySummaryModal: React.FC<MonthlySummaryModalProps> = ({
  isOpen,
  onClose,
  entries,
  settlements,
  settings,
  showToast,
}) => {
  const currency = settings.currencySymbol || '৳';
  const shareRate = settings.sharePercentage || 40;
  const formatNumber = (num: number) => new Intl.NumberFormat('en-BD').format(Math.round(num));

  // Determine list of available months from entries and settlements, default to current month
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    const currentMonth = new Date().toISOString().substring(0, 7);
    monthSet.add(currentMonth);

    entries.forEach((e) => {
      if (e.date && e.date.length >= 7) {
        monthSet.add(e.date.substring(0, 7));
      }
    });

    settlements.forEach((s) => {
      if (s.settlementDate && s.settlementDate.length >= 7) {
        monthSet.add(s.settlementDate.substring(0, 7));
      }
    });

    return Array.from(monthSet).sort().reverse();
  }, [entries, settlements]);

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    return availableMonths[0] || new Date().toISOString().substring(0, 7);
  });

  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Latest settlement carry-forward debt before this month
  const latestSettlement = settlements.length > 0 ? settlements[0] : null;
  const previousDue = latestSettlement ? latestSettlement.dueBalance : 0;

  // Compute monthly data
  const summaryData = useMemo(() => {
    return generateMonthlySummaryData(selectedMonth, entries, settlements, previousDue);
  }, [selectedMonth, entries, settlements, previousDue]);

  if (!isOpen) return null;

  const handleDownloadPDF = () => {
    try {
      setIsExporting(true);
      exportMonthlySummaryPDF(summaryData, settings);
      showToast(
        'PDF Exported Successfully!',
        `Saved Dental_Settlement_Summary_${summaryData.monthStr}.pdf`,
        'success'
      );
    } catch (err: any) {
      console.error('PDF Export error:', err);
      showToast('Export Error', err?.message || 'Failed to generate PDF', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in overflow-y-auto">
      <div className="ios-glass bg-white/95 rounded-3xl p-5 sm:p-6 w-full max-w-2xl shadow-2xl space-y-5 my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                Monthly Clinical Settlement Summary
              </h3>
              <p className="text-xs text-slate-500">
                Official statement &amp; formatted PDF report
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Month Selector Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70 shrink-0">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-indigo-600" />
            <span className="text-xs font-bold text-slate-700">Select Month:</span>
          </div>

          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-800 focus:border-indigo-500 outline-none"
          >
            {availableMonths.map((m) => {
              const [y, mo] = m.split('-').map(Number);
              const label = new Date(y, mo - 1, 1).toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              });
              return (
                <option key={m} value={m}>
                  {label} ({m})
                </option>
              );
            })}
          </select>
        </div>

        {/* Scrollable Report Preview */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Executive KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* KPI 1: Doctor 40% Share */}
            <div className="p-3.5 rounded-2xl bg-indigo-50/70 border border-indigo-100">
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                Doctor's Share ({shareRate}%)
              </span>
              <div className="text-lg font-black text-indigo-900 mt-1">
                {currency} {formatNumber(summaryData.totalDoctorShare)}
              </div>
              <span className="text-[10px] text-indigo-600/80">From {currency} {formatNumber(summaryData.totalGross)}</span>
            </div>

            {/* KPI 2: Patients Treated */}
            <div className="p-3.5 rounded-2xl bg-sky-50/70 border border-sky-100">
              <span className="text-[10px] font-bold text-sky-600 uppercase tracking-wider block">
                Patients Treated
              </span>
              <div className="text-lg font-black text-sky-900 mt-1">
                {summaryData.patientCount} <span className="text-xs font-semibold">Visits</span>
              </div>
              <span className="text-[10px] text-sky-600/80">In {summaryData.monthName}</span>
            </div>

            {/* KPI 3: Clinic Received */}
            <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-100">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                Cleared by Clinic
              </span>
              <div className="text-lg font-black text-emerald-900 mt-1">
                {currency} {formatNumber(summaryData.amountReceivedByClinic)}
              </div>
              <span className="text-[10px] text-emerald-600/80">Disbursed Payout</span>
            </div>

            {/* KPI 4: Outstanding Balance */}
            <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200">
              <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">
                Outstanding Due
              </span>
              <div className="text-lg font-black text-amber-900 mt-1">
                {currency} {formatNumber(summaryData.outstandingBalance)}
              </div>
              <span className="text-[10px] text-amber-700/80">Carry-forward due</span>
            </div>
          </div>

          {/* Report Metadata Strip */}
          <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 text-xs text-slate-600 space-y-1.5 shadow-2xs">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-700">Clinic:</span>
              <div className="flex items-center gap-1.5">
                {settings.clinicLogo && (
                  <img
                    src={settings.clinicLogo}
                    alt={settings.clinicName || 'Clinic Logo'}
                    className="w-4 h-4 object-contain rounded"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                    }}
                  />
                )}
                <span className="font-bold text-slate-900">{settings.clinicName}</span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-700">Attending Surgeon:</span>
              <span className="font-bold text-slate-900">{settings.doctorName || '—'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-700">Reporting Range:</span>
              <span className="text-slate-800">{summaryData.periodStart} to {summaryData.periodEnd}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-700">Prior Carry-In Arrears:</span>
              <span className="text-amber-700 font-semibold">{currency} {formatNumber(summaryData.previousDue)}</span>
            </div>
          </div>

          {/* Procedure Distribution Table Preview */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Procedure Earnings Breakdown
            </h4>

            {summaryData.procedureBreakdown.length === 0 ? (
              <div className="p-4 text-center text-slate-400 text-xs bg-slate-50 rounded-xl">
                No patient procedures recorded in {summaryData.monthName}.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100/80 text-slate-700 text-[11px] font-bold">
                    <tr>
                      <th className="py-2 px-3">Treatment</th>
                      <th className="py-2 px-3 text-center">Visits</th>
                      <th className="py-2 px-3 text-right">Gross Bill</th>
                      <th className="py-2 px-3 text-right">Doctor {shareRate}%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summaryData.procedureBreakdown.map((p) => (
                      <tr key={p.name} className="hover:bg-slate-50/50">
                        <td className="py-2 px-3 font-semibold text-slate-800">{p.name}</td>
                        <td className="py-2 px-3 text-center text-slate-600">{p.count}</td>
                        <td className="py-2 px-3 text-right text-slate-600">
                          {currency} {formatNumber(p.gross)}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-indigo-600">
                          {currency} {formatNumber(p.doctorShare)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handlePrint}
            className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            <span>Print Report</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPDF}
            disabled={isExporting}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-700 hover:to-sky-700 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-indigo-600/25 transition active:scale-95 disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            <span>{isExporting ? 'Generating PDF...' : 'Download Formatted PDF'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
