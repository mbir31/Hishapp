export interface PatientEntry {
  id: string;
  serial: number;
  date: string; // YYYY-MM-DD
  patientName: string;
  procedure: string;
  receivedAmount: number; // Clinic total bill collected
  doctorShare: number; // strictly 40% (receivedAmount * 0.40)
  settlementStatus: 'Pending' | 'Settled';
  settlementId?: string | null;
  remarks: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settlement {
  settlementId: string; // e.g., ST-YYYYMMDD-01
  settlementDate: string; // YYYY-MM-DD
  periodFrom: string; // YYYY-MM-DD
  periodTo: string; // YYYY-MM-DD
  patientCount: number;
  periodShare: number; // 40% share generated in this range
  previousDue: number; // Carry-over from preceding settlements
  totalPayable: number; // periodShare + previousDue
  amountReceived: number; // Actual payment paid by clinic
  dueBalance: number; // totalPayable - amountReceived (carries forward)
  remarks: string;
  patientIds: string[]; // List of entry IDs settled in this batch
  createdAt: number;
}

export interface AmountPreset {
  id: string;
  label: string;
  amount: number; // 0 for No Payment / Free Campaign, or custom number
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  action:
    | 'ENTRY_CREATED'
    | 'ENTRY_EDITED'
    | 'ENTRY_DELETED'
    | 'SETTLEMENT_CREATED'
    | 'SETTLEMENT_DELETED'
    | 'DATA_IMPORTED';
  targetId: string;
  targetType: 'patient_entry' | 'settlement';
  details: string;
  previousData?: any;
  newData?: any;
}

export interface ClinicSettings {
  clinicName: string;
  clinicLogo?: string;
  doctorName: string;
  doctorEmail?: string;
  doctorPhoto?: string;
  /**
   * Firebase uid of the Google account this doctor identity was filled from.
   * Empty until the user signs in with their own Gmail — Hisapp never
   * pre-populates a doctor / account identity.
   */
  ownerUid?: string | null;
  /**
   * Firebase uid of the Google account that OWNS the locally cached dataset.
   * It is set when local data is claimed, restored or cleared for an account,
   * and it deliberately survives sign-out (the dataset stays on the device),
   * so a later sign-in by a DIFFERENT Google account is detected as an
   * account switch — that account's own Google Drive backup then takes
   * priority over this device's local cache.
   */
  dataOwnerUid?: string | null;
  currencySymbol: string;
  sharePercentage: number;
  autoBackup: boolean;
  /** Timestamp of the last archived (timestamped) Drive snapshot. */
  lastDriveSnapshotTimestamp?: number | null;
  /** Timestamp of the last successful in-place update of the Drive "latest" backup. */
  lastDriveSyncAt?: number | null;
  driveFolderId?: string | null;
  /** Drive file id of the always-current `Hisapp_Latest.json` backup (updated in place). */
  driveLatestFileId?: string | null;
  ledgerSpreadsheetId?: string | null;
  procedures?: string[];
  amountPresets?: AmountPreset[];
  /**
   * Set on every settings record written by this build. Records from older
   * builds lack it and get a one-time check that clears a legacy placeholder
   * doctor name (see getSettings in db/indexedDB.ts).
   */
  legacyIdentityChecked?: boolean;
  /**
   * Set on every settings record written by this build. Records from older
   * builds lack it and get a one-time back-fill of the "Follow-up" procedure
   * / amount preset, so doctors who customized their lists still receive the
   * preset — once. Deleting it afterwards stays deleted.
   */
  followUpPresetsChecked?: boolean;
  /** Timestamp of last manual or automatic offline full data export */
  lastOfflineExportAt?: number | null;
}

export interface ReconciliationResult {
  localEntries: number;
  remoteEntries: number;
  localSettlements: number;
  remoteSettlements: number;
  healedCount: number;
  status: 'perfect-parity' | 'healed' | 'error';
  checkedAt: number;
  message: string;
}

export interface CloudSnapshotInfo {
  key: 'latest' | 'yesterday' | 'last_week';
  label: string;
  timestamp: number;
  entryCount: number;
  settlementCount: number;
  exists: boolean;
}

export interface PatientProfile {
  id: string; // usually normalized lowercase name or id
  name: string;
  phone?: string;
  notes?: string;
  totalVisits: number;
  totalBilled: number;
  totalDoctorShare: number;
  firstVisitDate: string;
  lastVisitDate: string;
  procedures: string[]; // List of procedures done
  createdAt: number;
  updatedAt: number;
}

export type TabType = 'dashboard' | 'entry' | 'records' | 'settlement';

export interface ProcedurePreset {
  name: string;
  category: string;
  defaultPrice?: number;
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  type: 'success' | 'info' | 'warning' | 'error';
  action?: ToastAction;
  duration?: number; // ms before auto-dismiss (default 4000)
}
