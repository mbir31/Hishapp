/**
 * HISAPP — SECURED CLOUD DATA VAULT AUTHENTICATION
 * ─────────────────────────────────────────────────────────────────
 * Central Cloud Firestore authentication for Hisapp.
 * Users authenticate with:
 *   - 11-digit mobile number (e.g., 01XXXXXXXXX)
 *   - 4-digit secret PIN (e.g., 1234)
 *
 * First login: Automatically provisions a secured Firestore data vault
 * for that 11-digit number with salted SHA-256 PIN hashing.
 * Subsequent logins: Verifies PIN on any device running the PWA.
 * PIN can be updated anytime by the user.
 */
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { getFirestoreDb, isFirebaseConfigured } from '../config/firebase';

const SESSION_KEY = 'hisapp_vault_session';

export interface VaultSession {
  phoneNumber: string;
  pinHash: string;
  isNew?: boolean;
  loggedInAt: number;
}

export interface VaultMetadata {
  phone: string;
  pinHash: string;
  salt: string;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number;
  doctorName?: string;
  clinicName?: string;
}

/** Sanitize input to only digits */
export function cleanPhoneNumber(phone: string): string {
  return (phone || '').replace(/\D/g, '').trim();
}

/** Check if phone is a valid 11-digit mobile number */
export function isValidPhoneNumber(phone: string): boolean {
  const cleaned = cleanPhoneNumber(phone);
  return cleaned.length === 11 && /^\d{11}$/.test(cleaned);
}

/** Check if PIN is strictly 4 digits */
export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test((pin || '').trim());
}

/** Generate a random 16-byte hex salt */
export function generateSalt(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback if crypto.getRandomValues is unavailable
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/** Compute salted SHA-256 hash of the 4-digit PIN */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const input = `hisapp_v1_salt_${salt}_pin_${pin.trim()}`;
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for non-subtle environments (e.g. Node tests if globalThis.crypto not available)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `hash_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/**
 * Log into an existing vault or automatically provision a new secured vault
 * on first login with the 11-digit number and 4-digit PIN.
 */
export async function loginOrCreateVault(
  rawPhone: string,
  rawPin: string
): Promise<VaultSession> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase configuration is missing or incomplete.');
  }

  const phone = cleanPhoneNumber(rawPhone);
  if (!isValidPhoneNumber(phone)) {
    throw new Error('অনুগ্রহ করে সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন (Please enter a valid 11-digit mobile number).');
  }

  const pin = (rawPin || '').trim();
  if (!isValidPin(pin)) {
    throw new Error('অনুগ্রহ করে ৪ ডিজিটের গোপন PIN দিন (PIN must be exactly 4 digits).');
  }

  const db = getFirestoreDb();
  const vaultRef = doc(db, 'vaults', phone);
  const snapshot = await getDoc(vaultRef);

  const now = Date.now();

  if (!snapshot.exists()) {
    // First-time registration: Create secured cloud vault
    const salt = generateSalt();
    const pinHash = await hashPin(pin, salt);

    const vaultData: VaultMetadata = {
      phone,
      pinHash,
      salt,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    await setDoc(vaultRef, vaultData);

    const session: VaultSession = {
      phoneNumber: phone,
      pinHash,
      isNew: true,
      loggedInAt: now,
    };
    storeVaultSession(session);
    return session;
  }

  // Existing vault: Verify PIN
  const data = snapshot.data() as VaultMetadata;
  const candidateHash = await hashPin(pin, data.salt);

  if (candidateHash !== data.pinHash) {
    throw new Error('ভুল পিন নম্বর (Incorrect PIN)। অনুগ্রহ করে আপনার সঠিক ৪ ডিজিটের গোপন PIN দিন।');
  }

  // Update last login timestamp in Firestore
  try {
    await updateDoc(vaultRef, { lastLoginAt: now });
  } catch {
    // non-fatal if offline
  }

  const session: VaultSession = {
    phoneNumber: phone,
    pinHash: data.pinHash,
    isNew: false,
    loggedInAt: now,
  };
  storeVaultSession(session);
  return session;
}

/**
 * Change the 4-digit PIN of the current vault
 */
export async function changeVaultPin(
  rawPhone: string,
  rawOldPin: string,
  rawNewPin: string
): Promise<void> {
  const phone = cleanPhoneNumber(rawPhone);
  if (!isValidPhoneNumber(phone)) {
    throw new Error('Invalid mobile number.');
  }

  const newPin = (rawNewPin || '').trim();
  if (!isValidPin(newPin)) {
    throw new Error('নতুন পিন অবশ্যই ৪ ডিজিটের হতে হবে (New PIN must be exactly 4 digits).');
  }

  const db = getFirestoreDb();
  const vaultRef = doc(db, 'vaults', phone);
  const snapshot = await getDoc(vaultRef);

  if (!snapshot.exists()) {
    throw new Error('ক্লাউড ভল্ট পাওয়া যায়নি (Vault not found).');
  }

  const data = snapshot.data() as VaultMetadata;
  const oldHash = await hashPin((rawOldPin || '').trim(), data.salt);

  if (oldHash !== data.pinHash) {
    throw new Error('বর্তমান পিন নম্বর সঠিক নয় (Current PIN is incorrect).');
  }

  // Generate new salt and new hash
  const newSalt = generateSalt();
  const newPinHash = await hashPin(newPin, newSalt);

  await updateDoc(vaultRef, {
    pinHash: newPinHash,
    salt: newSalt,
    updatedAt: Date.now(),
  });

  // Update local session
  const currentSession = getStoredVaultSession();
  if (currentSession && currentSession.phoneNumber === phone) {
    storeVaultSession({
      ...currentSession,
      pinHash: newPinHash,
    });
  }
}

/** Get persisted vault session from localStorage */
export function getStoredVaultSession(): VaultSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultSession;
    if (parsed && isValidPhoneNumber(parsed.phoneNumber) && parsed.pinHash) {
      return parsed;
    }
  } catch {
    // ignore parse error
  }
  return null;
}

/** Store vault session in localStorage */
export function storeVaultSession(session: VaultSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore quota error
  }
}

/** Clear active vault session from localStorage */
export function clearVaultSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore error
  }
}
