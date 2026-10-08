/**
 * HISAPP — FILE IMPORT UTILITIES
 * ─────────────────────────────────────────────────────────────────
 * Parses backup files produced by the app's own exporters so data can be
 * restored on a new device or after a wipe:
 *
 *   • JSON backup  — full restore (patientEntries + settlements + settings)
 *                    as produced by `exportAllDataJSON()`.
 *   • CSV files    — Patient_Entries CSV (required) + Settlements CSV
 *                    (optional), as produced by `exportAllDataCSV()`.
 *                    Files are auto-detected by their header row.
 *
 * Every row is validated and coerced into the app's TypeScript shapes;
 * invalid rows are skipped and reported via `skippedRows`.
 */
import { ClinicSettings, PatientEntry, Settlement } from '../types';

export interface ImportResult {
  patientEntries: PatientEntry[];
  settlements: Settlement[];
  settings?: Partial<ClinicSettings>;
  skippedRows: number;
  source: string;
}

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toText = (value: unknown, fallback = ''): string => {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
};

const genId = (prefix: string, index: number): string =>
  `${prefix}-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`;

/** Coerce an arbitrary object into a valid PatientEntry, or null if unusable */
function coerceEntry(raw: any, index: number): PatientEntry | null {
  if (!raw || typeof raw !== 'object') return null;

  const patientName = toText(raw.patientName ?? raw.patient ?? raw['Patient Name / ID']);
  if (!patientName) return null;

  const date = toText(raw.date) || new Date().toISOString().split('T')[0];
  const receivedAmount = Math.max(0, toNumber(raw.receivedAmount ?? raw.amount ?? raw['Received Amount']));
  const doctorShare = Math.max(
    0,
    toNumber(raw.doctorShare ?? raw['Doctor Share (40%)'], Math.round(receivedAmount * 0.4))
  );

  return {
    id: toText(raw.id) || genId('entry-import', index),
    serial: Math.max(1, Math.round(toNumber(raw.serial, index + 1))),
    date,
    patientName,
    procedure: toText(raw.procedure) || 'Visit',
    receivedAmount,
    doctorShare,
    settlementStatus: raw.settlementStatus === 'Settled' ? 'Settled' : 'Pending',
    settlementId: toText(raw.settlementId ?? raw['Settlement ID']) || null,
    remarks: toText(raw.remarks),
    createdAt: toNumber(raw.createdAt, Date.now()),
    updatedAt: toNumber(raw.updatedAt, Date.now()),
  };
}

/** Coerce an arbitrary object into a valid Settlement, or null if unusable */
function coerceSettlement(raw: any, index: number): Settlement | null {
  if (!raw || typeof raw !== 'object') return null;

  const settlementId = toText(raw.settlementId ?? raw['Settlement ID']);
  if (!settlementId) return null;

  const settlementDate = toText(raw.settlementDate ?? raw['Settlement Date']);
  if (!settlementDate) return null;

  return {
    settlementId,
    settlementDate,
    periodFrom: toText(raw.periodFrom ?? raw['Period From'], settlementDate),
    periodTo: toText(raw.periodTo ?? raw['Period To'], settlementDate),
    patientCount: Math.max(0, Math.round(toNumber(raw.patientCount ?? raw['Visits']))) || 0,
    periodShare: Math.max(0, toNumber(raw.periodShare ?? raw['Period Share'])),
    previousDue: Math.max(0, toNumber(raw.previousDue ?? raw['Previous Due'])),
    totalPayable: Math.max(0, toNumber(raw.totalPayable ?? raw['Total Payable'])),
    amountReceived: Math.max(0, toNumber(raw.amountReceived ?? raw['Paid'] ?? raw['Amount Received'])),
    dueBalance: toNumber(raw.dueBalance ?? raw['Due Balance'] ?? raw['Due / Balance']),
    remarks: toText(raw.remarks),
    patientIds: Array.isArray(raw.patientIds) ? raw.patientIds.map(String) : [],
    createdAt: toNumber(raw.createdAt, Date.now()),
  };
}

// ── JSON backup import ─────────────────────────────────────────────

/**
 * Parse a JSON backup produced by `exportAllDataJSON()`.
 * Expected shape: { version, exportDate, settings, patientEntries, settlements }
 */
export function parseJSONBackup(text: string, source = 'JSON backup'): ImportResult {
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The selected JSON file is not a Hisapp backup.');
  }

  const rawEntries: any[] = Array.isArray(payload.patientEntries) ? payload.patientEntries : [];
  const rawSettlements: any[] = Array.isArray(payload.settlements) ? payload.settlements : [];

  let skipped = 0;
  const patientEntries: PatientEntry[] = [];
  rawEntries.forEach((raw, i) => {
    const entry = coerceEntry(raw, i);
    if (entry) patientEntries.push(entry);
    else skipped += 1;
  });

  const settlements: Settlement[] = [];
  rawSettlements.forEach((raw, i) => {
    const settlement = coerceSettlement(raw, i);
    if (settlement) settlements.push(settlement);
    else skipped += 1;
  });

  const settings =
    payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)
      ? (payload.settings as Partial<ClinicSettings>)
      : undefined;

  return { patientEntries, settlements, settings, skippedRows: skipped, source };
}

// ── CSV parsing ────────────────────────────────────────────────────

/** Minimal RFC-4180-style CSV parser (handles quoted fields, escaped quotes, newlines) */
export function parseCSV(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Map a header row to column indexes, matched case-insensitively */
function headerIndexMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => map.set(h.trim().toLowerCase(), i));
  return map;
}

const cell = (row: string[], map: Map<string, number>, name: string): string => {
  const idx = map.get(name.toLowerCase());
  return idx !== undefined ? (row[idx] ?? '').trim() : '';
};

// ── CSV backup import ──────────────────────────────────────────────

/**
 * Parse the app's exported CSV files. Each file is auto-detected by its
 * header row: "Serial" → Patient Entries, "Settlement ID" → Settlements.
 * The Patient Entries CSV is required; the Settlements CSV is optional.
 */
export function parseCSVFiles(files: { name: string; text: string }[]): ImportResult {
  let patientEntries: PatientEntry[] = [];
  let settlements: Settlement[] = [];
  let skippedRows = 0;
  const sources: string[] = [];

  for (const file of files) {
    const rows = parseCSV(file.text);
    if (rows.length < 2) {
      throw new Error(`"${file.name}" has no data rows.`);
    }

    const headers = rows[0];
    const firstHeader = (headers[0] || '').trim().toLowerCase();
    const dataRows = rows.slice(1);

    if (firstHeader === 'serial') {
      // Patient_Entries CSV
      const map = headerIndexMap(headers);
      const parsed: PatientEntry[] = [];
      dataRows.forEach((row, i) => {
        const entry = coerceEntry(
          {
            serial: cell(row, map, 'Serial'),
            date: cell(row, map, 'Date'),
            patientName: cell(row, map, 'Patient Name / ID'),
            procedure: cell(row, map, 'Procedure'),
            receivedAmount: cell(row, map, 'Received Amount'),
            doctorShare: cell(row, map, 'Doctor Share (40%)'),
            settlementStatus: cell(row, map, 'Settlement Status'),
            settlementId: cell(row, map, 'Settlement ID'),
            remarks: cell(row, map, 'Remarks'),
          },
          i
        );
        if (entry) parsed.push(entry);
        else skippedRows += 1;
      });
      patientEntries = parsed;
      sources.push(file.name);
    } else if (firstHeader === 'settlement id') {
      // Settlements CSV
      const map = headerIndexMap(headers);
      const parsed: Settlement[] = [];
      dataRows.forEach((row, i) => {
        const settlement = coerceSettlement(
          {
            settlementId: cell(row, map, 'Settlement ID'),
            settlementDate: cell(row, map, 'Settlement Date'),
            periodFrom: cell(row, map, 'Period From'),
            periodTo: cell(row, map, 'Period To'),
            totalPayable: cell(row, map, 'Total Payable'),
            amountReceived: cell(row, map, 'Paid') || cell(row, map, 'Amount Received'),
            dueBalance: cell(row, map, 'Due / Balance') || cell(row, map, 'Due Balance'),
            remarks: cell(row, map, 'Remarks'),
          },
          i
        );
        if (settlement) parsed.push(settlement);
        else skippedRows += 1;
      });
      settlements = parsed;
      sources.push(file.name);
    } else {
      throw new Error(
        `"${file.name}" is not a Hisapp CSV export (unrecognized header: "${headers[0] || ''}").`
      );
    }
  }

  if (patientEntries.length === 0 && settlements.length === 0) {
    throw new Error('No valid patient entries or settlements found in the selected CSV file(s).');
  }

  return {
    patientEntries,
    settlements,
    skippedRows,
    source: sources.join(', ') || 'CSV files',
  };
}
