/**
 * HISAPP — FIREBASE WEB APP CONFIGURATION (PROJECT: hishapp1)
 * ─────────────────────────────────────────────────────────────────
 * Live values for the Firebase project that hosts this app.
 * Security is enforced by Firebase Authentication + authorized domains;
 * a web config is a public client identifier, not a secret.
 *
 * Requirements in the Firebase Console:
 *   • Authentication → Sign-in method → Google → Enabled
 *   • Authorized domains include hishapp1.web.app and localhost
 *   • Realtime Database is enabled; database.rules.json restricts each user's data to auth.uid
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyC2VQdCuMe5DD5dkjH_l2AjvfV2O4xKK2M',
  authDomain: 'hishapp1.firebaseapp.com',
  databaseURL: 'https://hishapp1-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'hishapp1',
  storageBucket: 'hishapp1.firebasestorage.app',
  messagingSenderId: '707696094388',
  appId: '1:707696094388:web:a732f9bd2c945c550b3be1',
  measurementId: 'G-D00YKC7CWJ',
};

/**
 * OPTIONAL — Google OAuth Web client ID used to renew the Google Drive
 * connection silently (no pop-up) when its one-hour access token expires.
 *
 * Where to find it: Firebase Console → Authentication → Sign-in method →
 * Google → "Web SDK configuration" → "Web client ID" (looks like
 * 1234567890-abc….apps.googleusercontent.com).
 *
 * Also add https://hishapp1.web.app (and http://localhost:3000 for local
 * development) to that client's "Authorized JavaScript origins" in Google
 * Cloud Console → APIs & Services → Credentials.
 *
 * Until this is set, Drive renewal still works but needs one tap on
 * "Reconnect Google Drive". Your records sync live regardless.
 */
export const googleOAuthClientId = '';

/** True once real Firebase credentials have been pasted above. */
export function isFirebaseConfigured(): boolean {
  return (
    !!firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith('PASTE_') &&
    firebaseConfig.apiKey.length > 10 &&
    !!firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith('PASTE_')
  );
}
