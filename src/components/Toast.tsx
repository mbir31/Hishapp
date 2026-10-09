import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { ToastMessage } from '../types';

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 left-4 sm:left-auto sm:w-96 z-50 flex flex-col gap-2.5 pointer-events-none">
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';
        const isWarning = toast.type === 'warning';

        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 p-4 rounded-2xl bg-white/90 backdrop-blur-xl border border-white/60 shadow-xl shadow-slate-900/10 transition-all duration-300 animate-in fade-in slide-in-from-top-4"
          >
            <div className="shrink-0 mt-0.5">
              {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
              {isError && <AlertCircle className="w-5 h-5 text-rose-600" />}
              {isWarning && <AlertCircle className="w-5 h-5 text-amber-600" />}
              {!isSuccess && !isError && !isWarning && <Info className="w-5 h-5 text-indigo-600" />}
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-slate-800 leading-tight">{toast.title}</h4>
              {toast.description && (
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{toast.description}</p>
              )}
            </div>

            {toast.action && (
              <button
                onClick={() => {
                  onDismiss(toast.id);
                  toast.action?.onClick();
                }}
                className="btn-gradient shrink-0 self-center px-2.5 py-1 rounded-lg text-white text-[11px] font-bold"
              >
                {toast.action.label}
              </button>
            )}

            <button
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100/50 transition"
              aria-label="Close notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
