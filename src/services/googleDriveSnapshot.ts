import {
  getAllAuditLogs,
  getAllPatientEntries,
  getAllSettlements,
  getSettings,
  saveSettings,
} from '../db/indexedDB';

export interface DriveSnapshotResult {
  fileId: string;
  fileName: string;
  folderId: string;
  folderName: string;
  timestamp: number;
  totalEntries: number;
  totalSettlements: number;
}

const BACKUPS_FOLDER_NAME = 'Hisapp_Backups';

/**
 * Locate or automatically create the dedicated "Hisapp_Backups" folder in user's Google Drive
 */
export async function getOrCreateBackupsFolder(accessToken: string): Promise<string> {
  const settings = await getSettings();

  // If cached folderId exists, verify it still exists
  if (settings.driveFolderId) {
    try {
      const checkRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${settings.driveFolderId}?fields=id,trashed`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (!checkData.trashed) {
          return settings.driveFolderId;
        }
      }
    } catch {
      // Inaccessible or deleted, search or recreate
    }
  }

  // Search Google Drive for Hisapp_Backups folder
  const query = encodeURIComponent(
    `name = '${BACKUPS_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      const folderId = searchData.files[0].id;
      await saveSettings({ driveFolderId: folderId });
      return folderId;
    }
  }

  // Create Hisapp_Backups folder
  const createFolderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
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
 * Execute an instant snapshot backup upload to Google Drive in the Hisapp_Backups/ folder
 */
export async function createDriveSnapshot(accessToken: string): Promise<DriveSnapshotResult> {
  const folderId = await getOrCreateBackupsFolder(accessToken);
  const settings = await getSettings();
  const patientEntries = await getAllPatientEntries();
  const settlements = await getAllSettlements();
  const auditLogs = await getAllAuditLogs();

  const now = Date.now();
  const dateFormatted = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const fileName = `Hisapp_Backup_${dateFormatted}.json`;

  const snapshotPayload = {
    app: 'Hisapp Dental Practice & Settlement Tracker',
    clinicName: settings.clinicName,
    doctorName: settings.doctorName,
    sharePercentage: settings.sharePercentage,
    currencySymbol: settings.currencySymbol,
    snapshotTimestamp: now,
    snapshotDate: new Date(now).toISOString(),
    version: 2,
    stats: {
      totalPatientEntries: patientEntries.length,
      totalSettlements: settlements.length,
      totalAuditLogs: auditLogs.length,
    },
    patientEntries,
    settlements,
    auditLogs,
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
    throw new Error(`Failed to upload snapshot file to Google Drive: ${errorText}`);
  }

  const uploadedData = await uploadRes.json();

  // Update settings with last snapshot timestamp
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

/**
 * Checks if 7 days have passed since the last Google Drive snapshot,
 * and if so, automatically triggers a new snapshot.
 */
export async function checkAndRunWeeklyAutoSnapshot(accessToken: string): Promise<boolean> {
  const settings = await getSettings();
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const lastSnapshot = settings.lastDriveSnapshotTimestamp || 0;
  const timeSinceLast = Date.now() - lastSnapshot;

  if (timeSinceLast >= ONE_WEEK_MS) {
    try {
      await createDriveSnapshot(accessToken);
      return true;
    } catch (err) {
      console.warn('Weekly auto-snapshot notice:', err);
      return false;
    }
  }

  return false;
}
