/**
 * HISAPP — GOOGLE DRIVE CLOUD BACKUP SERVICE
 * ─────────────────────────────────────────────────────────────────
 * Backs the signed-in account's records up to THEIR OWN Google Drive, inside a
 * private "Hisapp_Backups" folder. Access is scoped with drive.file (the app
 * can only touch files it created).
 *
 *   • Hisapp_Latest.json — ONE file, updated in place after changes (about one
 *     second after the last edit, at most eight seconds apart). It is the
 *     always-current recovery copy.
 *   • Hisapp_Backup_<time>.json — timestamped archives, created weekly and on
 *     "Backup Now". They are never overwritten.
 *
 * Before the latest file is overwritten, any newer copy written by another
 * device is union-imported, so a device with partial data cannot erase a
 * richer backup.
 */
import {
  getAllAuditLogs,
  getAllPatientEntries,
  getAllPatientProfiles,
  getAllSettlements,
  getSettings,
  importLedgerSnapshot,
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
  modifiedTime?: string;
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

export const LATEST_BACKUP_FILE_NAME = 'Hisapp_Latest.json';

/** The full snapshot of the active account's local data, as stored on Drive. */
export async function buildDriveSnapshotPayload(): Promise<DriveBackupPayload> {
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
  return {
    app: 'Hisapp Dental Practice & Settlement Tracker',
    clinicName: settings.clinicName,
    doctorName: settings.doctorName,
    sharePercentage: settings.sharePercentage,
    currencySymbol: settings.currencySymbol,
    snapshotTimestamp: now,
    snapshotDate: new Date(now).toISOString(),
    version: 4,
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
}

function multipartBody(metadata: Record<string, unknown>, payload: unknown): { boundary: string; body: string } {
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(payload) +
    closeDelimiter;
  return { boundary, body };
}

async function throwForDriveError(res: Response, action: string): Promise<never> {
  if (res.status === 401) throw new Error('SESSION_EXPIRED');
  throw new Error(`${action}: ${await res.text()}`);
}

/** Finds the latest-backup file inside the folder by name (used when the cached id is unknown). */
async function findLatestFileId(accessToken: string, folderId: string): Promise<{ id: string; modifiedTime: string } | null> {
  const query = encodeURIComponent(
    `name = '${LATEST_BACKUP_FILE_NAME}' and '${folderId}' in parents and trashed = false`
  );
  const res = await driveFetch(accessToken, `/files?q=${query}&fields=files(id,modifiedTime)&pageSize=1`);
  if (!res.ok) await throwForDriveError(res, 'Failed to search Google Drive');
  const data = await res.json();
  const file = data.files?.[0];
  return file ? { id: file.id, modifiedTime: file.modifiedTime } : null;
}

/** Metadata of a known file, or null when it no longer exists / was trashed. */
async function getFileMeta(accessToken: string, fileId: string): Promise<{ id: string; modifiedTime: string } | null> {
  const res = await driveFetch(accessToken, `/files/${fileId}?fields=id,modifiedTime,trashed`);
  if (res.status === 404) return null;
  if (!res.ok) await throwForDriveError(res, 'Failed to read backup file');
  const data = await res.json();
  return data.trashed ? null : { id: data.id, modifiedTime: data.modifiedTime };
}

/**
 * Writes the full local snapshot to the account's Hisapp_Latest.json file.
 *
 * Steps:
 *   1. Locate the file (cached id, then a search, then none).
 *   2. If another device wrote a newer copy since our last write, union-import
 *      it into the account's local ledger first (nothing local is discarded).
 *   3. Overwrite the file in place with the complete local state.
 *
 * `owner` is the account whose local ledger is active. It must match the
 * account the token belongs to.
 */
export async function syncDriveLatest(
  accessToken: string,
  owner: string
): Promise<{ imported: number; modifiedAt: number }> {
  const folderId = await getOrCreateBackupsFolder(accessToken);
  const settings = await getSettings();

  let target: { id: string; modifiedTime: string } | null = null;
  if (settings.driveLatestFileId) {
    target = await getFileMeta(accessToken, settings.driveLatestFileId);
  }
  if (!target) target = await findLatestFileId(accessToken, folderId);

  let imported = 0;
  const lastWrittenAt = settings.lastDriveSyncAt ?? 0;
  if (target && Date.parse(target.modifiedTime) > lastWrittenAt + 1000) {
    const remote = await downloadDriveBackup(accessToken, target.id);
    imported = await importLedgerSnapshot(owner, {
      patientEntries: remote.patientEntries ?? [],
      settlements: remote.settlements ?? [],
      auditLogs: remote.auditLogs ?? [],
      patientProfiles: remote.patientProfiles ?? [],
    });
  }

  const payload = await buildDriveSnapshotPayload();
  const body = JSON.stringify(payload);
  let modifiedTime: string;
  let fileId: string;

  if (target) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${target.id}?uploadType=media&fields=id,modifiedTime`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body,
      }
    );
    if (!res.ok) await throwForDriveError(res, 'Failed to update the Drive backup');
    const data = await res.json();
    fileId = data.id;
    modifiedTime = data.modifiedTime;
  } else {
    const { boundary, body: multipart } = multipartBody(
      {
        name: LATEST_BACKUP_FILE_NAME,
        parents: [folderId],
        mimeType: 'application/json',
        description: 'Hisapp latest backup. Updated automatically after each change.',
      },
      payload
    );
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipart,
      }
    );
    if (!res.ok) await throwForDriveError(res, 'Failed to create the Drive backup');
    const data = await res.json();
    fileId = data.id;
    modifiedTime = data.modifiedTime;
  }

  const modifiedAt = Date.parse(modifiedTime) || Date.now();
  await saveSettings({ driveLatestFileId: fileId, driveFolderId: folderId, lastDriveSyncAt: modifiedAt });
  return { imported, modifiedAt };
}

/**
 * Creates a timestamped archive snapshot (weekly and manual backups). Archives
 * are never overwritten, so they are a safe history of past states.
 */
export async function createDriveBackup(accessToken: string): Promise<DriveBackupResult> {
  const folderId = await getOrCreateBackupsFolder(accessToken);
  const payload = await buildDriveSnapshotPayload();
  const now = payload.snapshotTimestamp;
  const dateFormatted = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const fileName = `Hisapp_Backup_${dateFormatted}.json`;

  const { boundary, body } = multipartBody(
    {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/json',
      description: `Automated Hisapp Clinical Snapshot generated on ${new Date(now).toLocaleString()}`,
    },
    payload
  );

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!uploadRes.ok) {
    if (uploadRes.status === 401) throw new Error('SESSION_EXPIRED');
    const errorText = await uploadRes.text();
    throw new Error(`Failed to upload backup file to Google Drive: ${errorText}`);
  }

  const uploadedData = await uploadRes.json();
  await saveSettings({ lastDriveSnapshotTimestamp: now, driveFolderId: folderId });

  return {
    fileId: uploadedData.id,
    fileName,
    folderId,
    folderName: BACKUPS_FOLDER_NAME,
    timestamp: now,
    totalEntries: payload.patientEntries.length,
    totalSettlements: payload.settlements.length,
  };
}

/** List the most recently modified backup files in the user's Hisapp_Backups folder. */
export async function listDriveBackups(
  accessToken: string,
  limit = 5
): Promise<DriveBackupMeta[]> {
  const folderId = await getOrCreateBackupsFolder(accessToken);
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await driveFetch(
    accessToken,
    `/files?q=${query}&orderBy=modifiedTime desc&fields=files(id,name,createdTime,modifiedTime)&pageSize=${limit}`
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
 * The most recently modified backup (the latest file or an archive), or null
 * when the user's Drive has no backups yet.
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
 * Creates a weekly archive snapshot if the last one is at least 7 days old.
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
