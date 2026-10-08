import { PatientEntry, Settlement } from '../types';
import { getAllPatientEntries, getAllSettlements, getSettings, savePatientEntry, saveSettlement } from '../db/indexedDB';

/**
 * ============================================================================
 * GOOGLE WORKSPACE & GOOGLE IDENTITY SERVICES CONFIGURATION
 * ============================================================================
 * Instructions for Dental Surgeons / Administrators:
 * 1. Visit Google Cloud Console: https://console.cloud.google.com/
 * 2. Create a Project (e.g. "Dental-Income-Tracker") and enable:
 *    - Google Drive API
 *    - Google Sheets API
 * 3. Under "APIs & Services" > "Credentials", create an "OAuth 2.0 Client ID"
 *    - Application Type: Web application
 *    - Authorized JavaScript origins: Add your app domain URL
 * 4. Paste your Client ID below or configure it directly in the app's Settings modal.
 * ============================================================================
 */
export const GOOGLE_CLIENT_ID = '793990427738-67b27r1u1miuscmcu7rtlf593mlh9klk.apps.googleusercontent.com';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export interface GoogleUserProfile {
  name: string;
  email: string;
  picture: string;
}

export interface SyncStatus {
  isConnected: boolean;
  isSyncing: boolean;
  lastSynced: number | null;
  spreadsheetId: string | null;
  spreadsheetUrl: string | null;
  user: GoogleUserProfile | null;
  error: string | null;
  pendingCount: number;
}

// In-memory token cache (never stored in localStorage for security)
let cachedAccessToken: string | null = null;
let tokenClient: any = null;

/**
 * Initializes GIS Token Client
 */
export function initGoogleAuth(
  clientId: string,
  onSuccess: (token: string) => void,
  onError: (err: any) => void
): boolean {
  if (typeof window === 'undefined' || !(window as any).google?.accounts?.oauth2) {
    return false;
  }

  try {
    tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId || GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (response: any) => {
        if (response.error) {
          onError(response);
          return;
        }
        cachedAccessToken = response.access_token;
        onSuccess(response.access_token);
      },
    });
    return true;
  } catch (error) {
    console.error('Failed to init Google Token Client:', error);
    onError(error);
    return false;
  }
}

/**
 * Request Access Token via Popup
 */
export async function requestGoogleSignIn(customClientId?: string): Promise<string> {
  const settings = await getSettings();
  const effectiveClientId = customClientId || settings.googleClientId || GOOGLE_CLIENT_ID;

  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !(window as any).google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services SDK is still loading. Please check your internet connection and try again.'));
      return;
    }

    tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: effectiveClientId,
      scope: SCOPES,
      callback: (response: any) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error || 'Authentication canceled or failed.'));
          return;
        }
        cachedAccessToken = response.access_token;
        resolve(response.access_token);
      },
    });

    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

/**
 * Fetch Google User Profile
 */
export async function fetchGoogleUserProfile(accessToken: string): Promise<GoogleUserProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error('Failed to fetch Google profile details');
  }
  const data = await res.json();
  return {
    name: data.name || 'Doctor',
    email: data.email || '',
    picture: data.picture || '',
  };
}

/**
 * Get or Create the Google Spreadsheet "Dental_Income_Tracker"
 */
export async function getOrCreateSpreadsheet(accessToken: string): Promise<{ spreadsheetId: string; url: string }> {
  const settings = await getSettings();

  // If we already saved a spreadsheetId, check if it's accessible
  if (settings.spreadsheetId) {
    try {
      const verifyRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}?fields=spreadsheetId`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (verifyRes.ok) {
        return {
          spreadsheetId: settings.spreadsheetId,
          url: `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit`,
        };
      }
    } catch {
      // If inaccessible, fall through to search or create
    }
  }

  // 1. Search Google Drive for an existing spreadsheet named "Dental_Income_Tracker"
  const searchQuery = encodeURIComponent(
    "name = 'Dental_Income_Tracker' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false"
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${searchQuery}&fields=files(id,name)&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      const foundId = searchData.files[0].id;
      return {
        spreadsheetId: foundId,
        url: `https://docs.google.com/spreadsheets/d/${foundId}/edit`,
      };
    }
  }

  // 2. Create the spreadsheet with two sheets: Patient_Entries and Settlements
  const createPayload = {
    properties: {
      title: 'Dental_Income_Tracker',
    },
    sheets: [
      {
        properties: {
          title: 'Patient_Entries',
          gridProperties: { rowCount: 2000, columnCount: 12, frozenRowCount: 1 },
        },
      },
      {
        properties: {
          title: 'Settlements',
          gridProperties: { rowCount: 500, columnCount: 10, frozenRowCount: 1 },
        },
      },
    ],
  };

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createPayload),
  });

  if (!createRes.ok) {
    const errorBody = await createRes.text();
    throw new Error(`Failed to create spreadsheet: ${errorBody}`);
  }

  const createdData = await createRes.json();
  const spreadsheetId = createdData.spreadsheetId;

  // 3. Populate header rows and formatting
  const headerPayload = {
    valueInputOption: 'USER_ENTERED',
    data: [
      {
        range: 'Patient_Entries!A1:I1',
        values: [
          [
            'Serial',
            'Date',
            'Patient Name / ID',
            'Procedure',
            'Received Amount',
            'Doctor Share (40%)',
            'Settlement Status',
            'Settlement ID',
            'Remarks',
          ],
        ],
      },
      {
        range: 'Settlements!A1:H1',
        values: [
          [
            'Settlement ID',
            'Settlement Date',
            'Period From',
            'Period To',
            'Total Payable',
            'Amount Received',
            'Due / Balance',
            'Remarks',
          ],
        ],
      },
    ],
  };

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(headerPayload),
  });

  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

/**
 * Synchronize local IndexedDB data to Google Sheets
 */
export async function syncLocalDataToGoogleSheet(
  accessToken: string,
  spreadsheetId: string
): Promise<{ syncedPatients: number; syncedSettlements: number }> {
  const patientEntries = await getAllPatientEntries();
  const settlements = await getAllSettlements();

  // Prepare Patient_Entries payload (rows A2:I)
  const patientRows = patientEntries.map((e) => [
    e.serial,
    e.date,
    e.patientName || '',
    e.procedure || '',
    e.receivedAmount,
    e.doctorShare,
    e.settlementStatus,
    e.settlementId || '',
    e.remarks || '',
  ]);

  // Prepare Settlements payload (rows A2:H)
  const settlementRows = settlements.map((s) => [
    s.settlementId,
    s.settlementDate,
    s.periodFrom,
    s.periodTo,
    s.totalPayable,
    s.amountReceived,
    s.dueBalance,
    s.remarks || '',
  ]);

  // Clear existing data rows then overwrite to ensure clean mirror
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Patient_Entries!A2:I10000:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Settlements!A2:H10000:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const updatePayload = {
    valueInputOption: 'USER_ENTERED',
    data: [
      {
        range: `Patient_Entries!A2:I${patientRows.length + 1}`,
        values: patientRows,
      },
      {
        range: `Settlements!A2:H${settlementRows.length + 1}`,
        values: settlementRows,
      },
    ],
  };

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
    }
  );

  if (!updateRes.ok) {
    const err = await updateRes.text();
    throw new Error(`Failed to update sheet data: ${err}`);
  }

  // Mark items as synced in IndexedDB
  for (const entry of patientEntries) {
    if (!entry.synced) {
      entry.synced = true;
      await savePatientEntry(entry);
    }
  }

  for (const settlement of settlements) {
    if (!settlement.synced) {
      settlement.synced = true;
      await saveSettlement(settlement);
    }
  }

  return {
    syncedPatients: patientEntries.length,
    syncedSettlements: settlements.length,
  };
}

export function getCachedToken(): string | null {
  return cachedAccessToken;
}

export function clearCachedToken(): void {
  cachedAccessToken = null;
}
