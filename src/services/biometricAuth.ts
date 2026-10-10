/**
 * HISAPP — BIOMETRIC AUTHENTICATION SERVICE (WebAuthn / Passkeys)
 * ─────────────────────────────────────────────────────────────────
 * Allows users to unlock their Cloud Data Vault using Fingerprint,
 * Face ID, Touch ID, or device screen lock.
 *
 * Capabilities:
 *   1. Check device biometric availability
 *   2. Register device biometric credential for an 11-digit vault
 *   3. Biometric login without typing 4-digit PIN
 *   4. PIN Reset / Change using biometric verification
 */
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getFirestoreDb } from '../config/firebase';
import {
  generateSalt,
  hashPin,
  isValidPin,
  storeVaultSession,
  type VaultMetadata,
  type VaultSession,
} from './vaultAuth';

const BIO_PREFIX = 'hisapp_bio_vault_';
const LAST_BIO_PHONE_KEY = 'hisapp_bio_last_phone';

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Check if device supports platform biometric authentication */
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return false;
  }
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    return false;
  }
  return false;
}

/** Check if biometrics is already enrolled for a specific phone on this device */
export function isBiometricEnrolledFor(phone: string): boolean {
  if (!phone) return false;
  try {
    const raw = localStorage.getItem(`${BIO_PREFIX}${phone}`);
    return !!raw;
  } catch {
    return false;
  }
}

/** Get the last enrolled phone number for biometrics */
export function getLastBiometricPhone(): string | null {
  try {
    return localStorage.getItem(LAST_BIO_PHONE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Register biometric passkey for the current vault
 */
export async function registerBiometric(phone: string): Promise<boolean> {
  const supported = await isBiometricAvailable();
  if (!supported) {
    throw new Error('এই ডিভাইসে বায়োমেট্রিক (ফিঙ্গারপ্রিন্ট/ফেস আনলক) সাপোর্ট পাওয়া যায়নি।');
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const userId = new TextEncoder().encode(phone);

  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'Hisapp Dental Clinic Vault',
          id: window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname,
        },
        user: {
          id: userId,
          name: phone,
          displayName: `Hisapp Vault (${phone})`,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error('বায়োমেট্রিক সেটআপ সম্পন্ন হয়নি।');
    }

    const credentialIdBase64 = bufferToBase64(credential.rawId);
    localStorage.setItem(
      `${BIO_PREFIX}${phone}`,
      JSON.stringify({
        phone,
        credentialId: credentialIdBase64,
        enrolledAt: Date.now(),
      })
    );
    localStorage.setItem(LAST_BIO_PHONE_KEY, phone);
    return true;
  } catch (err: any) {
    if (err?.name === 'NotAllowedError') {
      throw new Error('বায়োমেট্রিক অ্যাক্সেস বাতিল করা হয়েছে বা সময় পার হয়ে গেছে।');
    }
    throw new Error(err?.message || 'বায়োমেট্রিক সেটআপ ব্যর্থ হয়েছে।');
  }
}

/**
 * Prompt biometric sensor and verify identity
 */
export async function verifyBiometric(phone: string): Promise<boolean> {
  const enrollmentRaw = localStorage.getItem(`${BIO_PREFIX}${phone}`);
  if (!enrollmentRaw) {
    throw new Error('এই নম্বরের জন্য বায়োমেট্রিক সক্রিয় করা নেই। আগে পিন দিয়ে লগইন করে বায়োমেট্রিক চালু করুন।');
  }

  const enrollment = JSON.parse(enrollmentRaw);
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  try {
    const credentialIdBuffer = base64ToBuffer(enrollment.credentialId);
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            type: 'public-key',
            id: credentialIdBuffer,
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    });

    return !!assertion;
  } catch (err: any) {
    if (err?.name === 'NotAllowedError') {
      throw new Error('বায়োমেট্রিক ভেরিফিকেশন বাতিল হয়েছে।');
    }
    throw new Error(err?.message || 'বায়োমেট্রিক ভেরিফিকেশন ব্যর্থ হয়েছে।');
  }
}

/**
 * Log in using Biometrics
 */
export async function loginWithBiometric(phone: string): Promise<VaultSession> {
  const verified = await verifyBiometric(phone);
  if (!verified) {
    throw new Error('বায়োমেট্রিক যাচাই ব্যর্থ হয়েছে।');
  }

  const db = getFirestoreDb();
  const vaultRef = doc(db, 'vaults', phone);
  const snapshot = await getDoc(vaultRef);

  if (!snapshot.exists()) {
    throw new Error('ক্লাউড ভল্ট পাওয়া যায়নি। অনুগ্রহ করে প্রথমে একবার ৪-ডিজিট পিন দিয়ে ভল্ট তৈরি করুন।');
  }

  const data = snapshot.data() as VaultMetadata;
  const now = Date.now();

  try {
    await updateDoc(vaultRef, { lastLoginAt: now });
  } catch {
    // non-fatal
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
 * Reset / Change PIN using Biometric verification (no old PIN needed)
 */
export async function resetPinWithBiometric(phone: string, newPin: string): Promise<void> {
  const cleanPin = (newPin || '').trim();
  if (!isValidPin(cleanPin)) {
    throw new Error('নতুন পিন অবশ্যই ৪ ডিজিটের হতে হবে (New PIN must be 4 digits).');
  }

  const verified = await verifyBiometric(phone);
  if (!verified) {
    throw new Error('বায়োমেট্রিক যাচাই বাতিল হয়েছে।');
  }

  const db = getFirestoreDb();
  const vaultRef = doc(db, 'vaults', phone);
  const snapshot = await getDoc(vaultRef);

  if (!snapshot.exists()) {
    throw new Error('ক্লাউড ভল্ট পাওয়া যায়নি।');
  }

  const newSalt = generateSalt();
  const newPinHash = await hashPin(cleanPin, newSalt);

  await updateDoc(vaultRef, {
    pinHash: newPinHash,
    salt: newSalt,
    updatedAt: Date.now(),
  });

  // Update local session
  const session: VaultSession = {
    phoneNumber: phone,
    pinHash: newPinHash,
    isNew: false,
    loggedInAt: Date.now(),
  };
  storeVaultSession(session);
}

/** Remove biometric enrollment for a phone */
export function removeBiometricEnrollment(phone: string): void {
  try {
    localStorage.removeItem(`${BIO_PREFIX}${phone}`);
    if (localStorage.getItem(LAST_BIO_PHONE_KEY) === phone) {
      localStorage.removeItem(LAST_BIO_PHONE_KEY);
    }
  } catch {
    // ignore
  }
}
