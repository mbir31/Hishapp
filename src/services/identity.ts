import type { ClinicSettings } from '../types';

/**
 * Identity fields to clear when a Google account signs out.
 *
 * Returns null when the stored identity does not belong to this account, so
 * nothing is changed. Sign-in copies the Gmail name into Settings, and that
 * copy is removed. A Doctor Name the doctor typed afterwards is kept, because
 * the header displays that field.
 */
export function signOutIdentityPatch(
  settings: Pick<ClinicSettings, 'doctorName' | 'ownerUid'>,
  account: { uid: string; name?: string | null } | null | undefined
): Partial<ClinicSettings> | null {
  if (!account || !settings.ownerUid || settings.ownerUid !== account.uid) return null;

  const typedName = (settings.doctorName || '').trim();
  const gmailName = (account.name || '').trim();
  const keepTypedName = typedName !== '' && typedName !== gmailName;

  return {
    doctorName: keepTypedName ? typedName : '',
    doctorEmail: '',
    doctorPhoto: '',
    ownerUid: null,
  };
}
