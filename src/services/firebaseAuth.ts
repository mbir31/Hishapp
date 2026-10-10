/**
 * HISAPP — FIREBASE AUTHENTICATION SERVICE
 * ─────────────────────────────────────────────────────────────────
 * Signs the clinic user in with their own Gmail account using Firebase
 * Authentication (Google provider) and returns a Google OAuth access
 * token scoped for Google Drive, so every user's data is backed up to
 * THEIR OWN Drive — no Google Cloud Console OAuth client required.
 */
import { firebaseConfig, googleOAuthClientId, isFirebaseConfigured } from '../config/firebase';

const TOKEN_CACHE_KEY = 'hisapp_google_access_token';
// Google access tokens live about one hour. The cache is trusted for 55 min and
// renewed silently a few minutes before that (see refreshDriveTokenSilently).
const TOKEN_TTL_MS = 55 * 60 * 1000;
/** Renew when less than this remains, so a token never expires mid-upload. */
const RENEW_BEFORE_MS = 5 * 60 * 1000;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

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
  email?: string;
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
}

interface GisTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface GisWindow {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          hint?: string;
          callback: (response: GisTokenResponse) => void;
          error_callback?: (error: { type?: string; message?: string }) => void;
        }) => GisTokenClient;
      };
    };
  };
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

function readCachedToken(expectedUid?: string, minRemainingMs = 0): CachedToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedToken;
    if (
      parsed.accessToken &&
      parsed.expiresAt - minRemainingMs > Date.now() &&
      (!expectedUid || parsed.userUid === expectedUid)
    ) {
      return parsed;
    }
  } catch {
    // corrupted cache — ignore
  }
  return null;
}

function writeCachedToken(accessToken: string, userUid: string, email: string, lifetimeMs = TOKEN_TTL_MS): void {
  const cached: CachedToken = {
    accessToken,
    expiresAt: Date.now() + Math.min(lifetimeMs, TOKEN_TTL_MS),
    userUid,
    email,
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

/** When the cached Drive token expires (epoch ms), or null when none is cached for this user. */
export function getDriveTokenExpiry(expectedUid?: string): number | null {
  return readCachedToken(expectedUid)?.expiresAt ?? null;
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
    writeCachedToken(accessToken, user.uid, user.email);
    return { user, accessToken };
  } catch (err: any) {
    throw new Error(friendlyAuthError(err));
  }
}

/**
 * Returns a valid access token for explicit user actions (Reconnect button).
 * Opens the Google popup when no valid token is cached. Call from a click
 * handler so the browser allows the popup.
 */
export async function ensureGoogleToken(expectedUid?: string): Promise<string> {
  const cached = readCachedToken(expectedUid, RENEW_BEFORE_MS);
  if (cached) return cached.accessToken;
  const { user, accessToken } = await signInWithGoogle();
  if (expectedUid && user.uid !== expectedUid) {
    throw new Error('Google sign-in switched to a different account. Please try again with the intended account.');
  }
  return accessToken;
}

// ── Silent renewal (Google Identity Services) ─────────────────────────

let gisLoading: Promise<void> | null = null;

function loadGoogleIdentityServices(): Promise<void> {
  const gis = (window as unknown as GisWindow).google;
  if (gis?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisLoading = null;
        reject(new Error('Could not load Google sign-in services.'));
      };
      document.head.appendChild(script);
    });
  }
  return gisLoading;
}

/**
 * Requests a Drive access token from Google without an explicit user action.
 * First tries prompt "none" (no UI at all), then prompt "" (reuses the existing
 * grant). Succeeds when the user is already signed in to Google in this browser
 * and has granted Hisapp access before. Otherwise it rejects, and the user must
 * tap Reconnect Google Drive.
 */
async function requestDriveTokenSilently(email: string): Promise<{ accessToken: string; expiresIn: number }> {
  if (!googleOAuthClientId) throw new Error('GOOGLE_OAUTH_CLIENT_NOT_SET');
  try {
    return await requestDriveToken(email, 'none');
  } catch {
    // Some browsers/Google sessions refuse prompt "none" even with an existing grant.
    // An empty prompt reuses the existing grant and only shows UI if Google requires it.
    return requestDriveToken(email, '');
  }
}

async function requestDriveToken(
  email: string,
  prompt: 'none' | ''
): Promise<{ accessToken: string; expiresIn: number }> {
  await loadGoogleIdentityServices();
  const gis = (window as unknown as GisWindow).google?.accounts?.oauth2;
  if (!gis) throw new Error('Google sign-in services are unavailable.');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Silent Google renewal timed out.')), 20_000);
    const client = gis.initTokenClient({
      client_id: googleOAuthClientId,
      scope: `${DRIVE_SCOPE} ${EMAIL_SCOPE}`,
      hint: email || undefined,
      callback: (response) => {
        clearTimeout(timer);
        if (response.error || !response.access_token) {
          reject(new Error(response.error || 'Google did not return an access token.'));
          return;
        }
        resolve({ accessToken: response.access_token, expiresIn: Number(response.expires_in) || 3600 });
      },
      error_callback: (error) => {
        clearTimeout(timer);
        reject(new Error(error?.type || 'Silent Google renewal failed.'));
      },
    });
    client.requestAccessToken({ prompt });
  });
}

/** Confirms that a Drive token belongs to the Firebase user it is cached for. */
async function verifyTokenEmail(accessToken: string, expectedEmail: string): Promise<void> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Could not verify the Google account for this Drive token.');
  const info = (await res.json()) as { email?: string };
  if (!info.email || !expectedEmail || info.email.toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error('The Google account for Drive does not match the signed-in account.');
  }
}

/**
 * Returns a Drive token that is valid for at least a few more minutes, renewing
 * it silently when needed. Never opens a popup. Returns null when silent renewal
 * is not possible (the caller then asks the user to reconnect Drive).
 */
export async function refreshDriveTokenSilently(user: HisappUser): Promise<string | null> {
  const cached = readCachedToken(user.uid, RENEW_BEFORE_MS);
  if (cached) return cached.accessToken;
  if (!googleOAuthClientId) return null;
  try {
    const { accessToken, expiresIn } = await requestDriveTokenSilently(user.email);
    await verifyTokenEmail(accessToken, user.email);
    writeCachedToken(accessToken, user.uid, user.email, expiresIn * 1000);
    return accessToken;
  } catch (err) {
    console.info('Silent Drive renewal not available:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Whether silent Drive renewal is set up in this build (a Web client ID is configured). */
export function isSilentDriveRenewalConfigured(): boolean {
  return !!googleOAuthClientId;
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
