import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

/**
 * Dedicated one-click PWA install button, labelled "INSTALL APP".
 * - Chrome / Android / Edge: fires the native beforeinstallprompt flow.
 * - iOS Safari (no native prompt): one click opens the Add-to-Home-Screen guide.
 * - Already installed: the button disappears completely (no leftover chip),
 *   on every platform and on every future visit.
 */
export const InstallAppButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install, markInstalled } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // Installed → render nothing at all.
  if (isInstalled) return null;

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

  const closeGuide = (installed: boolean) => {
    setShowGuide(false);
    // The user followed the home-screen guide — hide the button for good.
    if (installed) markInstalled();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="btn-gradient flex items-center gap-1 px-2.5 py-1 rounded-full text-white text-[10px] font-bold tracking-wide shrink-0"
        title="Install Hisapp as an app on this device"
      >
        <Download className="w-3 h-3" />
        <span>INSTALL APP</span>
      </button>

      {/* One-click install guide when no native prompt exists */}
      {showGuide && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => closeGuide(false)}
        >
          <div
            className="ios-glass bg-white/90 rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
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
                onClick={() => closeGuide(false)}
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => closeGuide(false)}
                className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold active:scale-95 transition"
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => closeGuide(true)}
                className="btn-gradient flex-1 py-2 rounded-xl text-white text-xs font-bold"
              >
                Added to Home Screen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
