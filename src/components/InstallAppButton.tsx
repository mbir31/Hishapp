import React, { useState } from 'react';
import { Check, Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

/**
 * Dedicated one-click PWA install button, labelled "INSTALL APP".
 * - Chrome / Android / Edge: fires the native beforeinstallprompt flow.
 * - iOS Safari (no native prompt): one click opens the Add-to-Home-Screen guide.
 * - Already installed: shows a small "INSTALLED" chip instead.
 */
export const InstallAppButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  const handleClick = async () => {
    if (isInstallable) {
      // One-click native install prompt
      await install();
      return;
    }
    // No native prompt available (iOS Safari or not-yet-eligible): show the
    // one-tap install guide so the button never dead-ends.
    setShowGuide(true);
  };

  return (
    <>
      {isInstalled ? (
        <div
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 text-[10px] font-bold shrink-0"
          title="Hisapp is installed on this device"
        >
          <Check className="w-3 h-3 text-emerald-600" />
          <span>INSTALLED</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-tr from-indigo-600 to-sky-500 text-white text-[10px] font-bold tracking-wide shadow-sm shadow-indigo-500/25 hover:shadow-md hover:brightness-105 active:scale-95 transition-all shrink-0"
          title="Install Hisapp as an app on this device"
        >
          <Download className="w-3 h-3" />
          <span>INSTALL APP</span>
        </button>
      )}

      {/* One-click install guide when no native prompt exists */}
      {showGuide && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-3">
            <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
              <img
                src="/applogo.png"
                alt="Hisapp"
                className="w-10 h-10 rounded-xl object-contain border border-slate-200 shadow-xs"
              />
              <div className="flex-1">
                <h4 className="text-sm font-bold text-slate-900">
                  {isIOS ? 'Install Hisapp on iPhone / iPad' : 'Install Hisapp on this device'}
                </h4>
                <p className="text-[11px] text-slate-500">
                  {isIOS ? 'Add to your Home Screen' : 'One click away from your home screen'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install guide"
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center active:scale-95 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {isIOS ? (
                <>
                  1. Tap the <strong>Share</strong> icon (box with upward arrow) in the Safari toolbar.
                  <br />
                  2. Scroll down and tap <strong>Add to Home Screen</strong>.
                  <br />
                  3. Tap <strong>Add</strong> at top right.
                </>
              ) : (
                <>
                  1. Open your browser menu (<strong>⋮</strong> on Android / Chrome).
                  <br />
                  2. Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                  <br />
                  3. Confirm — Hisapp opens full-screen and works offline.
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold active:scale-95 transition"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
};
