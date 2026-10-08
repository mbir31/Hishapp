/**
 * HISAPP — FIREBASE WEB APP CONFIGURATION
 * ─────────────────────────────────────────────────────────────────
 * This is the ONLY file you need to edit to link the app to your
 * Firebase project (hosting + authentication + Google Drive backup).
 *
 * Where to find these values:
 *   1. Open https://console.firebase.google.com/ and select project "hishapp1"
 *   2. Click the ⚙️ gear icon → Project settings → General tab
 *   3. Scroll to "Your apps" → if no Web app exists yet, click the
 *      "</>" (Web) icon to register one (name it e.g. "Hisapp Web")
 *   4. Under "SDK setup and configuration" choose "Config" and copy the
 *      values into the object below, replacing every PASTE_... placeholder.
 *
 * NOTE: A Firebase web config is a public client identifier (not a secret)
 * and is safe to keep in this file. Security is enforced by Firebase
 * Authentication rules + authorized domains.
 *
 * Also make sure (Firebase Console):
 *   • Authentication → Sign-in method → Google → Enabled
 *   • Authentication → Settings → Authorized domains contains:
 *       localhost, hishapp1.web.app (both are added automatically)
 */
export const firebaseConfig = {
  apiKey: 'PASTE_YOUR_API_KEY',
  authDomain: 'hishapp1.firebaseapp.com',
  projectId: 'hishapp1',
  storageBucket: 'hishapp1.firebasestorage.app',
  messagingSenderId: 'PASTE_YOUR_SENDER_ID',
  appId: 'PASTE_YOUR_APP_ID',
};

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
