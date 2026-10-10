import React, { useEffect, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { nextDateKey, previousDateKey, todayDateKey, displayDateKey, weekdayNameDateKey } from '../utils/dateUtils';

interface DateSelectorProps {
  /** ISO calendar date (`YYYY-MM-DD`). */
  value: string;
  onChange: (date: string) => void;
  ariaLabel?: string;
  className?: string;
}

export const DateSelector: React.FC<DateSelectorProps> = ({
  value,
  onChange,
  ariaLabel = 'Select date',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(value);

  useEffect(() => {
    if (isOpen) setDraftDate(value);
  }, [isOpen, value]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const stepDate = (direction: -1 | 1) => {
    const next = direction < 0 ? previousDateKey(value) : nextDateKey(value);
    if (next) onChange(next);
  };

  const applyShortcut = (date: string) => {
    setDraftDate(date);
    onChange(date);
    setIsOpen(false);
  };

  const confirmDate = () => {
    if (!displayDateKey(draftDate)) return;
    onChange(draftDate);
    setIsOpen(false);
  };

  const yesterday = previousDateKey(todayDateKey()) ?? todayDateKey();
  const weekday = weekdayNameDateKey(value);
  const formattedDate = displayDateKey(value);

  return (
    <>
      <div
        className={`ios-glass-card flex w-full max-w-sm items-center gap-1.5 rounded-2xl border border-white/80 p-1.5 shadow-lg shadow-slate-900/10 backdrop-blur-xl ${className}`}
      >
        <button
          type="button"
          onClick={() => stepDate(-1)}
          aria-label="Previous day"
          title="Previous day"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/55 text-indigo-600 transition hover:bg-white/90 active:scale-90"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label={`${ariaLabel}: ${weekday}, ${formattedDate}. Open calendar.`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          className="group flex min-w-0 flex-1 items-center justify-center gap-2.5 rounded-xl px-1.5 py-1 text-center transition hover:bg-white/35 active:scale-[0.99]"
        >
          <Calendar className="h-5 w-5 shrink-0 text-blue-600 transition-transform duration-200 group-hover:scale-110" aria-hidden="true" />
          <span className="flex min-w-0 flex-col items-center leading-tight">
            <span className="text-[10px] font-extrabold tracking-[0.14em] text-blue-700">
              {weekday.toUpperCase()}
            </span>
            <span className="whitespace-nowrap text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">
              {formattedDate}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => stepDate(1)}
          aria-label="Next day"
          title="Next day"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/55 text-indigo-600 transition hover:bg-white/90 active:scale-90"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-md animate-in fade-in duration-150"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="date-selector-title"
            className="ios-glass my-auto w-full max-w-sm space-y-5 rounded-3xl border border-white/80 bg-white/90 p-5 shadow-2xl sm:p-6"
          >
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600">
                  <Calendar className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2 id="date-selector-title" className="text-base font-extrabold text-slate-900">
                  Select Date
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close calendar"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/75 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 active:scale-90"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div className="rounded-2xl border border-blue-200/80 bg-blue-500/10 px-4 py-3 text-center">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-blue-700">
                {weekdayNameDateKey(draftDate).toUpperCase() || 'SELECT A DATE'}
              </p>
              <p className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">
                {displayDateKey(draftDate) || '—'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => applyShortcut(todayDateKey())}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 active:scale-[0.98]"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => applyShortcut(yesterday)}
                className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-200 active:scale-[0.98]"
              >
                Yesterday
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="custom-date-input" className="block text-[11px] font-extrabold text-slate-600">
                Pick Custom Date
              </label>
              <input
                id="custom-date-input"
                type="date"
                value={draftDate}
                onChange={(event) => setDraftDate(event.target.value)}
                className="w-full rounded-2xl border border-white/80 bg-white/75 px-3 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={confirmDate}
                disabled={!displayDateKey(draftDate)}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-emerald-700/15 transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-xl border border-slate-200 bg-slate-100 px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-200 active:scale-[0.98]"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
};
