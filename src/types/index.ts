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
  synced: boolean;
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
  synced: boolean;
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
  action: 'ENTRY_CREATED' | 'ENTRY_EDITED' | 'ENTRY_DELETED' | 'SETTLEMENT_CREATED' | 'SETTLEMENT_DELETED';
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
  currencySymbol: string;
  sharePercentage: number;
  googleClientId: string;
  spreadsheetId?: string | null;
  lastSyncTimestamp?: number | null;
  lastDriveSnapshotTimestamp?: number | null;
  driveFolderId?: string | null;
  autoSync: boolean;
  procedures?: string[];
  amountPresets?: AmountPreset[];
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

export type TabType = 'dashboard' | 'entry' | 'settlement' | 'history';

export interface ProcedurePreset {
  name: string;
  category: string;
  defaultPrice?: number;
}

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  type: 'success' | 'info' | 'warning' | 'error';
}
