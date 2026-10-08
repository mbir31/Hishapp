import type { PatientEntry, PatientProfile, Settlement } from '../types';

const DAY_MS = 86400000;

// Fingerprints of the samples shipped by older versions. These are only
// used for cleanup; they must never be inserted into a user's database.
const LEGACY_DEMO_VISITS = [
  ['Mrs. Selina Akhter', 'Root Canal Treatment (RCT)', 6000, 'Upper right 1st molar, 1st session'],
  ['Tanvir Hossain', 'Deep Scaling & Polishing', 2500, 'Subgingival calculus removal'],
  ['Farhana Chowdhury', 'Zirconia Crown Fixation', 8500, 'Shade A2, fit checked'],
  ['Kazi M. Rahman', 'Surgical Extraction (Impacted)', 5000, 'Lower left 3rd molar #38'],
  ['Nusrat Jahan', 'Composite Light Cure Filling', 3000, 'Class II restoration'],
  ['Zubair Ahmed', 'Root Canal Treatment (RCT)', 7000, 'Premolar obturation done'],
  ['Amina Begum', 'Scaling & Fluoride Therapy', 2000, 'Sensitivity management'],
] as const;

const LEGACY_DEMO_SETTLEMENT_ID = 'ST-20261001-01';

export function isLegacyDemoEntry(entry: PatientEntry): boolean {
  const match = /^entry-([1-7])$/.exec(entry.id);
  if (!match) return false;

  const serial = Number(match[1]);
  const [patientName, procedure, receivedAmount, remarks] = LEGACY_DEMO_VISITS[serial - 1];
  const wasSettled = serial <= 2;
  // The last two samples were dated on the seed day but timestamped 4h/1h
  // earlier; sample #2 included an extra one-second timestamp offset.
  const hoursBeforeSeed = serial === 6 ? 4 : serial === 7 ? 1 : 0;
  const timestampOffset = hoursBeforeSeed * 3600000 - (serial === 2 ? 1000 : 0);
  const dateStart = Date.parse(`${entry.date}T00:00:00.000Z`);
  const originalDateTimestamp = entry.createdAt + timestampOffset;

  // Never identify samples by patient name or ID alone: genuine records can
  // share a name, and imported records may use the same short IDs.
  return (
    entry.serial === serial &&
    originalDateTimestamp >= dateStart &&
    originalDateTimestamp < dateStart + DAY_MS &&
    entry.patientName === patientName &&
    entry.procedure === procedure &&
    entry.receivedAmount === receivedAmount &&
    entry.doctorShare === receivedAmount * 0.4 &&
    entry.remarks === remarks &&
    entry.settlementStatus === (wasSettled ? 'Settled' : 'Pending') &&
    entry.settlementId === (wasSettled ? LEGACY_DEMO_SETTLEMENT_ID : null)
  );
}

export function isLegacyDemoProfile(profile: PatientProfile, entry: PatientEntry): boolean {
  return (
    profile.id === entry.patientName.trim().toLowerCase() &&
    profile.name === entry.patientName &&
    profile.totalVisits === 1 &&
    profile.totalBilled === entry.receivedAmount &&
    profile.totalDoctorShare === entry.doctorShare &&
    profile.firstVisitDate === entry.date &&
    profile.lastVisitDate === entry.date &&
    Array.isArray(profile.procedures) &&
    profile.procedures.length === 1 &&
    profile.procedures[0] === entry.procedure
  );
}

export function isLegacyDemoSettlement(settlement: Settlement): boolean {
  const dateStart = Date.parse(`${settlement.settlementDate}T00:00:00.000Z`);
  return (
    settlement.settlementId === LEGACY_DEMO_SETTLEMENT_ID &&
    settlement.periodTo === settlement.settlementDate &&
    dateStart - Date.parse(`${settlement.periodFrom}T00:00:00.000Z`) === 7 * DAY_MS &&
    settlement.createdAt >= dateStart &&
    settlement.createdAt < dateStart + DAY_MS &&
    settlement.patientCount === 2 &&
    settlement.periodShare === 3400 &&
    settlement.previousDue === 0 &&
    settlement.totalPayable === 3400 &&
    settlement.amountReceived === 2900 &&
    settlement.dueBalance === 500 &&
    settlement.remarks === 'Cheque issued for ৳2,900. Remaining ৳500 due carried over to next week.' &&
    Array.isArray(settlement.patientIds) &&
    settlement.patientIds.length === 2 &&
    settlement.patientIds[0] === 'entry-1' &&
    settlement.patientIds[1] === 'entry-2'
  );
}
