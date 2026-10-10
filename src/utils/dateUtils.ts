/**
 * HISAPP — DATE HELPERS FOR THE VISIT-DATE PICKER
 * ─────────────────────────────────────────────────────────────────
 * The entry form steps through dates with the arrow buttons beside the
 * date picker, so the maths has to stay in LOCAL time. `toISOString()`
 * converts to UTC and can silently shift the day back by one for doctors
 * east of Greenwich (Bangladesh is UTC+6), which would record a visit on
 * the wrong date. Everything here works on `YYYY-MM-DD` strings only.
 */

/** Local-time `YYYY-MM-DD` key for a Date (never UTC-shifted). */
export function formatDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today's date as a local `YYYY-MM-DD` key. */
export function todayDateKey(now: Date = new Date()): string {
  return formatDateKey(now);
}

/**
 * Parses a `YYYY-MM-DD` key into a local Date, or null when the string is
 * not a real calendar date (e.g. `2026-02-31`, `abc`, `''`).
 */
export function parseDateKey(key: string | null | undefined): Date | null {
  if (typeof key !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  // Reject rolled-over dates such as 2026-02-31 → 2026-03-03.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/**
 * Shifts a `YYYY-MM-DD` key by a number of days (positive = future,
 * negative = past). Returns null when the input is not a valid date so the
 * caller can leave the field untouched instead of writing a broken value.
 */
export function shiftDateKey(key: string | null | undefined, days: number): string | null {
  const parsed = parseDateKey(key);
  if (!parsed) return null;
  const offset = Number.isFinite(days) ? Math.trunc(days) : 0;
  parsed.setDate(parsed.getDate() + offset);
  return formatDateKey(parsed);
}

/** Previous day, or null for an unparsable input. */
export function previousDateKey(key: string | null | undefined): string | null {
  return shiftDateKey(key, -1);
}

/** Next day, or null for an unparsable input. */
export function nextDateKey(key: string | null | undefined): string | null {
  return shiftDateKey(key, 1);
}

/** Full English weekday for a date key (never dependent on browser locale). */
export function weekdayNameDateKey(key: string | null | undefined): string {
  const parsed = parseDateKey(key);
  if (!parsed) return '';
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    parsed.getDay()
  ];
}

/** User-facing `DD-MM-YYYY` label; storage remains the ISO `YYYY-MM-DD` key. */
export function displayDateKey(key: string | null | undefined): string {
  const parsed = parseDateKey(key);
  if (!parsed) return '';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${String(parsed.getFullYear()).padStart(4, '0')}`;
}

/** Human-readable label for a date key, e.g. `Fri, 10 Oct 2026`. */
export function describeDateKey(key: string | null | undefined): string {
  const parsed = parseDateKey(key);
  if (!parsed) return '';
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
