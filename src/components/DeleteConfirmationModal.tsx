import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { PatientEntry } from '../types';
import { displayDateKey, weekdayNameDateKey } from '../utils/dateUtils';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: PatientEntry | null;
  onConfirmDelete: () => Promise<void>;
  currencySymbol: string;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  onClose,
  entry,
  onConfirmDelete,
  currencySymbol,
}) => {
  const [isDeleting, setIsDeleting] = React.useState(false);

  if (!isOpen || !entry) return null;

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await onConfirmDelete();
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
      <div className="ios-glass bg-white/95 rounded-3xl p-5 sm:p-6 w-full max-w-sm shadow-2xl space-y-4 my-auto">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-rose-600">
            <div className="w-9 h-9 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Confirm Deletion</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          Are you sure you want to permanently delete this patient record? This will adjust your
          financial totals and unsettled ledger.
        </p>

        {/* Entry Detail Card */}
        <div className="p-3.5 rounded-2xl bg-rose-50/50 border border-rose-100/80 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-slate-500 font-semibold">Patient:</span>
            <span className="font-bold text-slate-900">{entry.patientName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 font-semibold">Procedure:</span>
            <span className="font-semibold text-slate-800">{entry.procedure}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 font-semibold">Date:</span>
            <span className="text-slate-700">
              {weekdayNameDateKey(entry.date)} {displayDateKey(entry.date)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 font-semibold">Billed Amount:</span>
            <span className="font-bold text-slate-900">{currencySymbol} {entry.receivedAmount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 font-semibold">Status:</span>
            <span className={`font-bold ${entry.settlementStatus === 'Settled' ? 'text-emerald-700' : 'text-amber-700'}`}>
              {entry.settlementStatus}
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className="pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="btn-gradient btn-gradient--rose px-4 py-2.5 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" />
            <span>{isDeleting ? 'Deleting...' : 'Yes, Delete Record'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
