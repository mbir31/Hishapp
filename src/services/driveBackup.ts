/**
 * HISAPP — GOOGLE DRIVE CLOUD BACKUP SERVICE
 * ─────────────────────────────────────────────────────────────────
 * Backs the entire clinical database up to the SIGNED-IN USER'S OWN
 * Google Drive, inside a private "Hisapp_Backups" folder. Access is
 * scoped with drive.file (the app can only touch files it created),
 * so nothing else in the user's Drive is ever reachable.
 *
 * The access token comes from Firebase Authentication (Google provider).
 */
import {
  getAllAuditLogs,
  getAllPatientEntries,
  getAllPatientProfiles,
  getAllSettlements,
  getSettings,
  saveSettings,
} from '../db/indexedDB';

export interface DriveBackupResult {
  fileId: string;
  fileName: string;
  folderId: string;
  folderName: string;
  timestamp: number;
  totalEntries: number;
  totalSettlements: number;
}

export interface DriveBackupMeta {
  id: string;
  name: string;
  createdTime: string;
}

export interface DriveBackupPayload {
  app: string;
  version: number;
  snapshotTimestamp: number;
  snapshotDate: string;
  clinicName?: string;
  doctorName?: string;
  sharePercentage?: number;
  currencySymbol?: string;
  stats?: Record<string, number>;
  patientEntries: any[];
  settlements: any[];
  auditLogs?: any[];
  patientProfiles?: any[];
  settings?: any;
}

const BACKUPS_FOLDER_NAME = 'Hisapp_Backups';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

async function driveFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return res;
}

/**
 * Locate or automatically create the dedicated "Hisapp_Backups" folder
 * in the signed-in user's Google Drive.
 */
export async function getOrCreateBackupsFolder(accessToken: string): Promise<string> {
  const settings = await getSettings();

  // If a cached folderId exists, verify it still exists and isn't trashed
  if (settings.driveFolderId) {
    try {
      const checkRes = await driveFetch(
        accessToken,
        `/files/${settings.driveFolderId}?fields=id,trashed`
      );
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (!checkData.trashed) return settings.driveFolderId;
      }
    } catch {
      // Inaccessible or deleted — search or recreate below
    }
  }

  // Search Drive for the Hisapp_Backups folder (app-created files only)
  const query = encodeURIComponent(
    `name = '${BACKUPS_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const searchRes = await driveFetch(
    accessToken,
    `/files?q=${query}&fields=files(id,name)&pageSize=1`
  );

  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      const folderId = searchData.files[0].id;
      await saveSettings({ driveFolderId: folderId });
      return folderId;
    }
  }

  // Create the Hisapp_Backups folder
  const createFolderRes = await driveFetch(accessToken, `/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: BACKUPS_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Dedicated automated snapshots and database backups for Hisapp Dental Tracker',
    }),
  });

  if (!createFolderRes.ok) {
    const errorBody = await createFolderRes.text();
    throw new Error(`Failed to create ${BACKUPS_FOLDER_NAME} folder in Google Drive: ${errorBody}`);
  }

  const folderData = await createFolderRes.json();
  const folderId = folderData.id;
  await saveSettings({ driveFolderId: folderId });
  return folderId;
}

/**
 * Collect the ENTIRE local database (IndexedDB) and upload it as a JSON
 * snapshot into the user's Hisapp_Backups Drive folder.
 */
export async function createDriveBackup(accessToken: string): Promise<DriveBackupResult> {
  const folderId = await getOrCreateBackupsFolder(accessToken);
  const settings = await getSettings();
  const patientEntries = await getAllPatientEntries();
  const settlements = await getAllSettlements();
  const auditLogs = await getAllAuditLogs();
  let patientProfiles: any[] = [];
  try {
    patientProfiles = await getAllPatientProfiles();
  } catch {
    patientProfiles = [];
  }

  const now = Date.now();
  const dateFormatted = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const fileName = `Hisapp_Backup_${dateFormatted}.json`;

  const snapshotPayload: DriveBackupPayload = {
    app: 'Hisapp Dental Practice & Settlement Tracker',
    clinicName: settings.clinicName,
    doctorName: settings.doctorName,
    sharePercentage: settings.sharePercentage,
    currencySymbol: settings.currencySymbol,
    snapshotTimestamp: now,
    snapshotDate: new Date(now).toISOString(),
    version: 3,
    stats: {
      totalPatientEntries: patientEntries.length,
      totalSettlements: settlements.length,
      totalAuditLogs: auditLogs.length,
      totalPatientProfiles: patientProfiles.length,
    },
    patientEntries,
    settlements,
    auditLogs,
    patientProfiles,
    settings,
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'application/json',
    description: `Automated Hisapp Clinical Snapshot generated on ${new Date(now).toLocaleString()}`,
  };

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(snapshotPayload, null, 2) +
    closeDelimiter;

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    if (uploadRes.status === 401) {
      throw new Error('SESSION_EXPIRED');
    }
    throw new Error(`Failed to upload backup file to Google Drive: ${errorText}`);
  }

  const uploadedData = await uploadRes.json();

  await saveSettings({
    lastDriveSnapshotTimestamp: now,
    driveFolderId: folderId,
  });

  return {
    fileId: uploadedData.id,
    fileName,
    folderId,
    folderName: BACKUPS_FOLDER_NAME,
    timestamp: now,
    totalEntries: patientEntries.length,
    totalSettlements: settlements.length,
  };
}

/** List the most recent backup files in the user's Hisapp_Backups folder. */
export async function listDriveBackups(
  accessToken: string,
  limit = 5
): Promise<DriveBackupMeta[]> {
  const folderId = await getOrCreateBackupsFolder(accessToken);
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await driveFetch(
    accessToken,
    `/files?q=${query}&orderBy=createdTime desc&fields=files(id,name,createdTime)&pageSize=${limit}`
  );
  if (!res.ok) {
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    throw new Error(`Failed to list backups from Google Drive: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.files || []) as DriveBackupMeta[];
}

/** Download and parse a backup file from the user's Drive. */
export async function downloadDriveBackup(
  accessToken: string,
  fileId: string
): Promise<DriveBackupPayload> {
  const res = await driveFetch(accessToken, `/files/${fileId}?alt=media`);
  if (!res.ok) {
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    throw new Error(`Failed to download backup from Google Drive: ${await res.text()}`);
  }
  return (await res.json()) as DriveBackupPayload;
}

/**
 * Convenience: download the most recent backup, or return null when the
 * user's Drive has no backups yet.
 */
export async function downloadLatestDriveBackup(
  accessToken: string
): Promise<{ meta: DriveBackupMeta; payload: DriveBackupPayload } | null> {
  const backups = await listDriveBackups(accessToken, 1);
  if (backups.length === 0) return null;
  const meta = backups[0];
  const payload = await downloadDriveBackup(accessToken, meta.id);
  return { meta, payload };
}

/**
 * Checks if 7 days have passed since the last Drive backup, and if so,
 * automatically creates a fresh weekly backup.
 */
export async function checkAndRunWeeklyAutoBackup(accessToken: string): Promise<boolean> {
  const settings = await getSettings();
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const lastSnapshot = settings.lastDriveSnapshotTimestamp || 0;
  const timeSinceLast = Date.now() - lastSnapshot;

  if (timeSinceLast >= ONE_WEEK_MS) {
    try {
      await createDriveBackup(accessToken);
      return true;
    } catch (err) {
      console.warn('Weekly auto-backup notice:', err);
      return false;
    }
  }
  return false;
}
