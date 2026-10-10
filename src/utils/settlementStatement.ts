/**
 * HISAPP — SETTLEMENT STATEMENT CONTENT
 * ─────────────────────────────────────────────────────────────────
 * Builds the exact text of a settlement statement (the JPG image that can
 * be sent to the clinic owner). Everything here is pure: no canvas, no DOM
 * — the renderer in `settlementImageExport.ts` only decides where these
 * strings are painted, so the wording can be unit-tested in Node.
 */
import { ClinicSettings, Settlement } from '../types';
import { displayDateKey, weekdayNameDateKey } from './dateUtils';

export type StatementEmphasis = 'normal' | 'highlight' | 'total' | 'due';

export interface StatementRow {
  label: string;
  value: string;
  emphasis: StatementEmphasis;
}

export interface StatementMetaField {
  label: string;
  value: string;
}

export interface SettlementStatement {
  documentTitle: string;
  settlementId: string;
  clinicName: string;
  doctorName: string;
  currencySymbol: string;
  sharePercent: number;
  settlementDate: string;
  periodFrom: string;
  periodTo: string;
  patientCount: number;
  meta: StatementMetaField[];
  rows: StatementRow[];
  /** Formal certification paragraph (wrapped by the renderer). */
  statement: string;
  /** Bangla rendering of the certification, printed under the English text. */
  statementBangla: string;
  remarks: string;
  signatureLeft: string;
  signatureRight: string;
  generatedOn: string;
  footer: string;
}

const FALLBACK_CLINIC_NAME = 'Dental Clinic';

/** Amounts are always shown rounded, in Bangladeshi digit grouping. */
export function formatStatementAmount(currencySymbol: string, amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${currencySymbol} ${new Intl.NumberFormat('en-BD').format(Math.round(safe))}`;
}

/** `Friday 09-10-2026` — or the raw key when it cannot be parsed. */
function readableDate(key: string): string {
  const weekday = weekdayNameDateKey(key);
  const formatted = displayDateKey(key);
  return weekday && formatted ? `${weekday} ${formatted}` : key || '—';
}

export interface BuildStatementOptions {
  /** Overrides the generation timestamp (used by tests for stable output). */
  now?: Date;
  /** Overrides the currency symbol, e.g. when the device cannot render ৳. */
  currencySymbol?: string;
  /** Set false to omit the Bangla paragraph (no Bengali font on device). */
  includeBangla?: boolean;
}

/**
 * Turns a stored settlement plus the clinic settings into the full text of
 * the statement image.
 */
export function buildSettlementStatement(
  settlement: Settlement,
  settings: ClinicSettings,
  options: BuildStatementOptions = {}
): SettlementStatement {
  const currency = options.currencySymbol ?? (settings.currencySymbol || '৳');
  const includeBangla = options.includeBangla ?? true;
  const sharePercent = settings.sharePercentage || 40;
  const clinicName = (settings.clinicName || '').trim() || FALLBACK_CLINIC_NAME;
  const doctorName = (settings.doctorName || '').trim() || '—';
  const fmt = (amount: number) => formatStatementAmount(currency, amount);
  const now = options.now ?? new Date();

  const periodShare = settlement.periodShare || 0;
  const previousDue = settlement.previousDue || 0;
  const totalPayable = settlement.totalPayable || periodShare + previousDue;
  const amountReceived = settlement.amountReceived || 0;
  const dueBalance =
    typeof settlement.dueBalance === 'number' ? settlement.dueBalance : totalPayable - amountReceived;
  const patientCount = settlement.patientCount || 0;

  const rows: StatementRow[] = [
    {
      label: `Doctor's Professional Share (${sharePercent}%)`,
      value: fmt(periodShare),
      emphasis: 'highlight',
    },
    {
      label: 'Previous Carry-over Due',
      value: fmt(previousDue),
      emphasis: 'normal',
    },
    {
      label: 'Total Payable to Doctor',
      value: fmt(totalPayable),
      emphasis: 'total',
    },
    {
      label: 'Amount Received from Clinic',
      value: fmt(amountReceived),
      emphasis: 'normal',
    },
    {
      label: 'Due Carried Forward',
      value: fmt(dueBalance),
      emphasis: 'due',
    },
  ];

  const settlementWording =
    dueBalance > 0
      ? `leaving a balance of ${fmt(dueBalance)}, which shall be carried forward to the next settlement cycle`
      : dueBalance < 0
      ? `with an advance of ${fmt(Math.abs(dueBalance))} paid by the clinic and adjustable in the next settlement cycle`
      : 'and the account stands fully cleared with no outstanding due';

  const statement =
    `This is to certify that the above statement has been prepared for the professional ` +
    `services rendered by the undersigned dental surgeon at ${clinicName} during the period ` +
    `${readableDate(settlement.periodFrom)} to ${readableDate(settlement.periodTo)}, covering ` +
    `${patientCount} patient visit${patientCount === 1 ? '' : 's'}. The agreed professional share ` +
    `of ${sharePercent}% of the collected bill amounts to ${fmt(periodShare)}. Against the total ` +
    `payable amount of ${fmt(totalPayable)}, ${fmt(amountReceived)} has been received from the ` +
    `clinic, ${settlementWording}. This statement is generated electronically from the clinical ` +
    `ledger maintained in Hisapp and is issued without manual alteration.`;

  const statementBangla =
    `উপরের বিবরণীটি ${clinicName}-এ চিকিৎসাকালীন ${readableDate(settlement.periodFrom)} থেকে ` +
    `${readableDate(settlement.periodTo)} পর্যন্ত ${patientCount} জন রোগীর চিকিৎসার ভিত্তিতে প্রস্তুত করা হয়েছে। ` +
    `চুক্তি অনুযায়ী ${sharePercent}% হিস্যা অনুসারে ডাক্তারের প্রাপ্য ${fmt(totalPayable)}, যার মধ্যে ` +
    `${fmt(amountReceived)} পরিশোধ করা হয়েছে। এই বিবরণী Hisapp অ্যাপের লেজার থেকে স্বয়ংক্রিয়ভাবে তৈরি।`;

  return {
    documentTitle: 'CLINICAL SETTLEMENT STATEMENT',
    settlementId: settlement.settlementId || '—',
    clinicName,
    doctorName,
    currencySymbol: currency,
    sharePercent,
    settlementDate: settlement.settlementDate || '',
    periodFrom: settlement.periodFrom || '',
    periodTo: settlement.periodTo || '',
    patientCount,
    meta: [
      { label: 'Clinic', value: clinicName },
      { label: 'Settlement Reference', value: settlement.settlementId || '—' },
      { label: 'Attending Surgeon', value: doctorName },
      { label: 'Settlement Date', value: readableDate(settlement.settlementDate) },
      {
        label: 'Service Period',
        value: `${readableDate(settlement.periodFrom)} — ${readableDate(settlement.periodTo)}`,
      },
      {
        label: 'Patient Visits Settled',
        value: `${patientCount} visit${patientCount === 1 ? '' : 's'}`,
      },
    ],
    rows,
    statement,
    statementBangla: includeBangla ? statementBangla : '',
    remarks: (settlement.remarks || '').trim(),
    signatureLeft: 'Signature of Doctor',
    signatureRight: 'Signature of Clinic Authority',
    generatedOn: now.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    footer: 'Generated electronically by Hisapp · hishapp1.web.app',
  };
}

/** File name used for the exported image, e.g. `Hisapp_Settlement_ST-20261010-01.jpg`. */
export function settlementImageFileName(settlement: Settlement): string {
  const reference = (settlement.settlementId || 'settlement').replace(/[^A-Za-z0-9-_]+/g, '_');
  return `Hisapp_Settlement_${reference}.jpg`;
}
