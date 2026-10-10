import React from 'react';
import { X, Calendar, User, Clock, CheckCircle2, AlertCircle, FileText, Activity } from 'lucide-react';
import { PatientEntry } from '../types';
import { displayDateKey, weekdayNameDateKey } from '../utils/dateUtils';

interface PatientHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientName: string;
  allPatientEntries: PatientEntry[];
  currencySymbol: string;
  sharePercentage: number;
}

export const PatientHistoryModal: React.FC<PatientHistoryModalProps> = ({
  isOpen,
  onClose,
  patientName,
  allPatientEntries,
  currencySymbol,
  sharePercentage,
}) => {
  if (!isOpen) return null;

  // Filter and sort all records matching this patient name chronologically (newest first)
  const historyEntries = allPatientEntries
    .filter(
      (e) =>
        e.patientName &&
        e.patientName.trim().toLowerCase() === patientName.trim().toLowerCase()
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.serial - a.serial);

  const totalVisits = historyEntries.length;
  const totalGross = historyEntries.reduce((sum, e) => sum + e.receivedAmount, 0);
  const totalDoctorShare = historyEntries.reduce((sum, e) => sum + e.doctorShare, 0);
  const formatNumber = (num: number) => new Intl.NumberFormat('en-BD').format(Math.round(num));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in overflow-y-auto">
      <div className="ios-glass bg-white/95 rounded-3xl p-5 sm:p-6 w-full max-w-lg shadow-2xl space-y-4 my-auto max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                  {patientName}
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                  {totalVisits} {totalVisits === 1 ? 'Visit' : 'Visits'}
                </span>
              </div>
              <p className="text-xs text-slate-500">Chronological patient treatment history</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Lifetime Financial Summary for this patient */}
        <div className="grid grid-cols-2 gap-2.5 p-3 rounded-2xl bg-indigo-50/70 border border-indigo-100 shrink-0 text-xs">
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase">
              Total Billed
            </span>
            <div className="text-base font-black text-slate-900 mt-0.5">
              {currencySymbol} {formatNumber(totalGross)}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-bold text-indigo-600 uppercase">
              Doctor's Share ({sharePercentage}%)
            </span>
            <div className="text-base font-black text-indigo-600 mt-0.5">
              {currencySymbol} {formatNumber(totalDoctorShare)}
            </div>
          </div>
        </div>

        {/* Timeline of Visits */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {historyEntries.map((entry, index) => {
            const isSettled = entry.settlementStatus === 'Settled';

            return (
              <div
                key={entry.id}
                className="relative pl-5 before:absolute before:left-2 before:top-3 before:bottom-0 before:w-0.5 before:bg-indigo-100 last:before:hidden"
              >
                {/* Timeline Dot */}
                <div className="absolute left-0.5 top-2 w-3.5 h-3.5 rounded-full bg-indigo-600 border-2 border-white shadow-xs" />

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900">
                        {weekdayNameDateKey(entry.date)} {displayDateKey(entry.date)}
                      </span>
                      <span className="text-[10px] text-slate-400">#{entry.serial}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isSettled
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {isSettled
                        ? `Settled (${entry.settlementId || 'Done'})`
                        : 'Pending Due'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-indigo-600" />
                      <span className="text-xs font-bold text-slate-800">{entry.procedure}</span>
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-black text-indigo-600">
                        {currencySymbol} {formatNumber(entry.doctorShare)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Bill: {currencySymbol} {formatNumber(entry.receivedAmount)}
                      </div>
                    </div>
                  </div>

                  {entry.remarks && (
                    <div className="pt-1.5 border-t border-slate-200/60 text-[11px] text-slate-600 flex items-start gap-1">
                      <FileText className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
                      <span>{entry.remarks}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition"
          >
            Close History
          </button>
        </div>
      </div>
    </div>
  );
};
