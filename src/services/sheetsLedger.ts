/** Readable mirror of the local database in the signed-in user's Drive.
 * JSON snapshots remain the authoritative restore source. */
import { getAllPatientEntries, getAllPatientProfiles, getAllSettlements, getSettings, saveSettings } from '../db/indexedDB';
import type { PatientEntry, PatientProfile, Settlement } from '../types';

const LEDGER_NAME = 'Hisapp_Ledger';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TAB_ENTRIES = 'Patient Entries';
const TAB_SETTLEMENTS = 'Settlements';
const TAB_PATIENTS = 'Patients';
const TAB_SUMMARY = 'Summary';
const HEADER_ENTRIES = ['Serial', 'Date', 'Patient', 'Procedure', 'Total Bill', "Doctor's Share", 'Status', 'Settlement ID', 'Remarks'];
const HEADER_SETTLEMENTS = ['Settlement ID', 'Date', 'Period From', 'Period To', 'Visits', 'Period Share', 'Previous Due', 'Total Payable', 'Paid', 'Due Balance', 'Remarks'];
const HEADER_PATIENTS = ['Patient', 'Phone', 'Visits', 'Total Billed', 'Total Share', 'First Visit', 'Last Visit'];

export interface LedgerSyncResult {
  spreadsheetId: string;
  url: string;
  entries: number;
  settlements: number;
  patients: number;
}

function sheetsFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SHEETS_API}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
}

async function verifyCachedLedger(token: string, id: string): Promise<boolean> {
  try {
    const res = await sheetsFetch(token, `/${id}?fields=properties.title`);
    return res.ok && (await res.json())?.properties?.title === LEDGER_NAME;
  } catch {
    return false;
  }
}

export async function getOrCreateLedger(token: string): Promise<{ spreadsheetId: string; url: string }> {
  const settings = await getSettings();
  let spreadsheetId = settings.ledgerSpreadsheetId;
  if (!spreadsheetId || !(await verifyCachedLedger(token, spreadsheetId))) {
    const query = encodeURIComponent(`name = '${LEDGER_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`);
    const search = await fetch(`${DRIVE_API}/files?q=${query}&fields=files(id,name)&pageSize=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (search.ok) spreadsheetId = (await search.json()).files?.[0]?.id;
    if (!spreadsheetId || !(await verifyCachedLedger(token, spreadsheetId))) {
      const create = await sheetsFetch(token, '', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: { title: LEDGER_NAME },
          sheets: [TAB_ENTRIES, TAB_SETTLEMENTS, TAB_PATIENTS, TAB_SUMMARY].map((title, i) => ({
            properties: { sheetId: i, title, gridProperties: { frozenRowCount: 1 } },
          })),
        }),
      });
      if (!create.ok) {
        if (create.status === 403) throw new Error('SHEETS_API_DISABLED — enable the Google Sheets API on Firebase project hishapp1.');
        if (create.status === 401) throw new Error('SESSION_EXPIRED');
        throw new Error(`Failed to create ${LEDGER_NAME}: ${await create.text()}`);
      }
      spreadsheetId = (await create.json()).spreadsheetId as string;
      await applyLedgerFormatting(token, spreadsheetId!);
    }
    await saveSettings({ ledgerSpreadsheetId: spreadsheetId });
  }
  return { spreadsheetId: spreadsheetId!, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}

async function applyLedgerFormatting(token: string, id: string): Promise<void> {
  const requests = [
    ...[0, 1, 2].map(sheetId => ({ repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'LEFT' } },
      fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment',
    } })),
    ...[9, 11, 7, 2].map((endColumnIndex, sheetId) => ({ updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', endColumnIndex },
      properties: { pixelSize: sheetId === 3 ? 190 : sheetId === 1 ? 120 : 130 }, fields: 'pixelSize',
    } })),
    { repeatCell: { range: { sheetId: 3, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
  ];
  try {
    const res = await sheetsFetch(token, `/${id}:batchUpdate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }),
    });
    if (!res.ok) console.warn('Ledger formatting notice:', await res.text());
  } catch (err) { console.warn('Ledger formatting notice:', err); }
}

export async function buildLedgerRows(): Promise<{
  entryRows: (string | number)[][]; settlementRows: (string | number)[][];
  patientRows: (string | number)[][]; summaryRows: (string | number)[][];
  counts: { entries: number; settlements: number; patients: number };
}> {
  const [entries, settlements, profiles, settings] = await Promise.all([
    getAllPatientEntries(), getAllSettlements(), getAllPatientProfiles(), getSettings(),
  ]);
  const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.serial - b.serial || a.createdAt - b.createdAt);
  const sortedSettlements = [...settlements].sort((a, b) => a.settlementDate.localeCompare(b.settlementDate) || a.createdAt - b.createdAt);
  const sortedProfiles = [...profiles].sort((a, b) => a.name.localeCompare(b.name));
  const entryRows = sortedEntries.map((e: PatientEntry) => [e.serial, e.date, e.patientName || '', e.procedure || '', e.receivedAmount ?? 0, e.doctorShare ?? 0, e.settlementStatus || 'Pending', e.settlementId || '', e.remarks || '']);
  const settlementRows = sortedSettlements.map((s: Settlement) => [s.settlementId, s.settlementDate, s.periodFrom, s.periodTo, s.patientCount ?? 0, s.periodShare ?? 0, s.previousDue ?? 0, s.totalPayable ?? 0, s.amountReceived ?? 0, s.dueBalance ?? 0, s.remarks || '']);
  const patientRows = sortedProfiles.map((p: PatientProfile) => [p.name || '', p.phone || '', p.totalVisits ?? 0, p.totalBilled ?? 0, p.totalDoctorShare ?? 0, p.firstVisitDate || '', p.lastVisitDate || '']);
  const pending = sortedEntries.filter(e => e.settlementStatus !== 'Settled');
  const sum = (values: number[]) => values.reduce((acc, n) => acc + n, 0);
  const summaryRows = [
    ['Hisapp Ledger Summary', ''], ['Clinic', settings.clinicName || ''], ['Doctor', settings.doctorName || ''],
    ['Share Rate', `${settings.sharePercentage || 40}%`], ['', ''],
    ['Total Visits', sortedEntries.length], ['Total Billed', sum(sortedEntries.map(e => e.receivedAmount || 0))],
    ['Total Share Earned', sum(sortedEntries.map(e => e.doctorShare || 0))],
    ['Pending Visits', pending.length], ['Pending Share Amount', sum(pending.map(e => e.doctorShare || 0))],
    ['Settlements Done', sortedSettlements.length], ['Total Paid by Clinic', sum(sortedSettlements.map(s => s.amountReceived || 0))],
    ['Outstanding Due', sum(sortedSettlements.map(s => s.dueBalance || 0))], ['', ''],
    ['Last Updated', new Date().toLocaleString()],
  ];
  return { entryRows, settlementRows, patientRows, summaryRows,
    counts: { entries: entryRows.length, settlements: settlementRows.length, patients: patientRows.length } };
}

/** Fully rewrite the mirror on each backup; the JSON snapshot is the restore source. */
export async function syncSheetsLedger(token: string): Promise<LedgerSyncResult> {
  const { spreadsheetId, url } = await getOrCreateLedger(token);
  const { entryRows, settlementRows, patientRows, summaryRows, counts } = await buildLedgerRows();
  const clear = await sheetsFetch(token, `/${spreadsheetId}/values:batchClear`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ranges: [
      `'${TAB_ENTRIES}'!A1:I100000`, `'${TAB_SETTLEMENTS}'!A1:K100000`,
      `'${TAB_PATIENTS}'!A1:G100000`, `'${TAB_SUMMARY}'!A1:B100`,
    ] }),
  });
  if (!clear.ok) {
    if (clear.status === 401) throw new Error('SESSION_EXPIRED');
    throw new Error(`Failed to clear ledger sheet: ${await clear.text()}`);
  }
  const update = await sheetsFetch(token, `/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: [
      { range: `'${TAB_ENTRIES}'!A1`, values: [HEADER_ENTRIES, ...entryRows] },
      { range: `'${TAB_SETTLEMENTS}'!A1`, values: [HEADER_SETTLEMENTS, ...settlementRows] },
      { range: `'${TAB_PATIENTS}'!A1`, values: [HEADER_PATIENTS, ...patientRows] },
      { range: `'${TAB_SUMMARY}'!A1`, values: summaryRows },
    ] }),
  });
  if (!update.ok) {
    if (update.status === 401) throw new Error('SESSION_EXPIRED');
    throw new Error(`Failed to write ledger sheet: ${await update.text()}`);
  }
  return { spreadsheetId, url, ...counts };
}
