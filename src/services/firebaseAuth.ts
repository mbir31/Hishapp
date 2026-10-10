/**
 * HISAPP — FIREBASE AUTHENTICATION SERVICE
 * ─────────────────────────────────────────────────────────────────
 * Signs the clinic user in with their own Gmail account using Firebase
 * Authentication (Google provider) and returns a Google OAuth access
 * token scoped for Google Drive, so every user's data is backed up to
 * THEIR OWN Drive — no Google Cloud Console OAuth client required.
 */
import { firebaseConfig, isFirebaseConfigured } from '../config/firebase';

const TOKEN_CACHE_KEY = 'hisapp_google_access_token';
// Google access tokens live ~1h; treat as stale after 50 min for safety.
const TOKEN_TTL_MS = 50 * 60 * 1000;

export interface HisappUser {
  uid: string;
  name: string;
  email: string;
  photoURL: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  userUid?: string;
}

async function buildProvider() {
  const { GoogleAuthProvider } = await import('firebase/auth');
  const provider = new GoogleAuthProvider();
  // drive.file = per-file access limited to files created/opened by Hisapp.
  // The app can only see & manage its own Hisapp_Backups folder — nothing
  // else in the user's Drive — the least-privilege way to back up data.
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
  provider.addScope('https://www.googleapis.com/auth/userinfo.email');
  return provider;
}

async function getFirebaseAuth() {
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Firebase is not configured yet. Paste your Firebase web app config in src/config/firebase.ts.'
    );
  }
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getAuth } = await import('firebase/auth');
  if (getApps().length === 0) {
    initializeApp(firebaseConfig);
  }
  return getAuth(getApp());
}

function mapUser(user: { uid: string; displayName: string | null; email: string | null; photoURL: string | null }): HisappUser {
  return {
    uid: user.uid,
    name: user.displayName || user.email?.split('@')[0] || 'Doctor',
    email: user.email || '',
    photoURL: user.photoURL || '',
  };
}

// ── Access-token cache (localStorage) ────────────────────────────────

function readCachedToken(expectedUid?: string): CachedToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedToken;
    if (
      parsed.accessToken &&
      parsed.expiresAt > Date.now() &&
      (!expectedUid || parsed.userUid === expectedUid)
    ) {
      return parsed;
    }
  } catch {
    // corrupted cache — ignore
  }
  return null;
}

function writeCachedToken(accessToken: string, userUid: string): void {
  const cached: CachedToken = {
    accessToken,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    userUid,
  };
  localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(cached));
}

export function clearCachedToken(): void {
  localStorage.removeItem(TOKEN_CACHE_KEY);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Returns a valid Google Drive-scoped access token, or null when the user
 * is signed out or the cached token has expired (never opens a popup).
 */
export function getSilentGoogleToken(expectedUid?: string): string | null {
  return readCachedToken(expectedUid)?.accessToken ?? null;
}

/**
 * Signs the user in with their Gmail account via a Firebase popup and
 * caches the resulting Drive-scoped Google access token.
 */
export async function signInWithGoogle(): Promise<{ user: HisappUser; accessToken: string }> {
  const auth = await getFirebaseAuth();
  const [{ signInWithPopup }, { GoogleAuthProvider }, provider] = await Promise.all([
    import('firebase/auth'),
    import('firebase/auth'),
    buildProvider(),
  ]);
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken;
    if (!accessToken) {
      throw new Error(
        'Google did not return a Drive access token. Make sure the Google sign-in provider is enabled in Firebase Authentication.'
      );
    }
    const user = mapUser(result.user);
    writeCachedToken(accessToken, user.uid);
    return { user, accessToken };
  } catch (err: any) {
    throw new Error(friendlyAuthError(err));
  }
}

/**
 * Returns a valid access token, re-authenticating with a popup when the
 * cached one has expired. Call this from user-gesture handlers (buttons)
 * so the browser allows the popup.
 */
export async function ensureGoogleToken(expectedUid?: string): Promise<string> {
  const cached = readCachedToken(expectedUid);
  if (cached) return cached.accessToken;
  const { user, accessToken } = await signInWithGoogle();
  if (expectedUid && user.uid !== expectedUid) {
    throw new Error('Google sign-in switched to a different account. Please try again with the intended account.');
  }
  return accessToken;
}

/** Subscribe to Firebase auth state changes. Returns an unsubscribe fn. */
export async function onAuthChanged(
  cb: (user: HisappUser | null) => void
): Promise<() => void> {
  if (!isFirebaseConfigured()) {
    cb(null);
    return () => {};
  }
  try {
    const auth = await getFirebaseAuth();
    const { onAuthStateChanged } = await import('firebase/auth');
    return onAuthStateChanged(auth, (user) => cb(user ? mapUser(user) : null));
  } catch (err) {
    console.error('Firebase auth listener failed:', err);
    cb(null);
    return () => {};
  }
}

/** Sign the user out (local data stays safely on the device). */
export async function signOutGoogle(): Promise<void> {
  try {
    const auth = await getFirebaseAuth();
    const { signOut: firebaseSignOut } = await import('firebase/auth');
    await firebaseSignOut(auth);
  } finally {
    clearCachedToken();
  }
}

/** Translate Firebase error codes into helpful, human messages. */
export function friendlyAuthError(err: any): string {
  const code = err?.code || '';
  switch (code) {
    case 'auth/unauthorized-domain':
      return `This domain is not authorized for sign-in. In the Firebase Console open Authentication → Settings → Authorized domains and add this site's domain.`;
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in window was closed before finishing. Please try again.';
    case 'auth/popup-blocked':
      return 'The browser blocked the sign-in popup. Allow popups for this site and try again.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled. In the Firebase Console open Authentication → Sign-in method → Google → Enable.';
    case 'auth/network-request-failed':
      return 'Network problem while contacting Google. Check your internet connection.';
    case 'auth/configuration-not-found':
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
      return 'Firebase configuration is invalid. Double-check the values in src/config/firebase.ts.';
    default:
      return err?.message || 'Google sign-in failed. Please try again.';
  }
}
