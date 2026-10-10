/**
 * HISAPP — FIREBASE WEB APP & FIRESTORE CONFIGURATION (PROJECT: hishapp1)
 * ─────────────────────────────────────────────────────────────────
 * Central Cloud Firestore database configuration for Hisapp.
 * Hosted at: https://hishapp1.web.app/
 * Developer / Project: hishapp1 (mbr.uhq@gmail.com)
 *
 * Each clinic / doctor uses their 11-digit mobile number and 4-digit PIN
 * to access their dedicated encrypted data vault in Cloud Firestore.
 */
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyC2VQdCuMe5DD5dkjH_l2AjvfV2O4xKK2M',
  authDomain: 'hishapp1.firebaseapp.com',
  projectId: 'hishapp1',
  storageBucket: 'hishapp1.firebasestorage.app',
  messagingSenderId: '707696094388',
  appId: '1:707696094388:web:a732f9bd2c945c550b3be1',
  measurementId: 'G-D00YKC7CWJ',
};

/** True once valid Firebase credentials are provided. */
export function isFirebaseConfigured(): boolean {
  return (
    !!firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith('PASTE_') &&
    firebaseConfig.apiKey.length > 10 &&
    !!firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith('PASTE_')
  );
}

let appInstance: FirebaseApp | null = null;
let firestoreInstance: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!appInstance) {
    appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  return appInstance;
}

export function getFirestoreDb(): Firestore {
  if (!firestoreInstance) {
    const app = getFirebaseApp();
    firestoreInstance = getFirestore(app);
  }
  return firestoreInstance;
}
