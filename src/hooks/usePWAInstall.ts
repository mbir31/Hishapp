import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface RelatedApp {
  platform?: string;
  url?: string;
  id?: string;
}

const INSTALLED_FLAG_KEY = 'hisapp_pwa_installed';

function readInstalledFlag(): boolean {
  try {
    return localStorage.getItem(INSTALLED_FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeInstalledFlag(): void {
  try {
    localStorage.setItem(INSTALLED_FLAG_KEY, 'true');
  } catch {
    /* storage may be unavailable (private mode) — non fatal */
  }
}

/** True while the page is being displayed as an installed app. */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const standaloneModes = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'];
  const inDisplayMode = standaloneModes.some((mode) => {
    try {
      return window.matchMedia(`(display-mode: ${mode})`).matches;
    } catch {
      return false;
    }
  });
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return inDisplayMode || iosStandalone;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() => detectStandalone() || readInstalledFlag());
  const [isIOS, setIsIOS] = useState(false);

  const markInstalled = useCallback(() => {
    writeInstalledFlag();
    setIsInstalled(true);
    setDeferredPrompt(null);
  }, []);

  useEffect(() => {
    // Running as an installed app? (iOS / Android / desktop Chrome / Edge)
    if (detectStandalone() || readInstalledFlag()) {
      setIsInstalled(true);
    }

    // Keep watching: the display mode flips to "standalone" the moment the app
    // is launched from the home screen, even after it was installed elsewhere.
    const media = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) markInstalled();
    };
    media.addEventListener?.('change', handleDisplayModeChange);

    // Detect iOS devices
    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (detectStandalone() || readInstalledFlag()) {
        setIsInstalled(true);
        return;
      }
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      markInstalled();
    };

    // Some browsers/embedded webviews expose the installed related apps.
    const nav = navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<RelatedApp[]>;
    };
    if (typeof nav.getInstalledRelatedApps === 'function') {
      nav
        .getInstalledRelatedApps()
        .then((apps) => {
          if (apps && apps.length > 0) markInstalled();
        })
        .catch(() => {
          /* not supported — ignore */
        });
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Re-check on visibility change: a user may install, leave, and come back.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && detectStandalone()) {
        markInstalled();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      media.removeEventListener?.('change', handleDisplayModeChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [markInstalled]);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      markInstalled();
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt && !isInstalled,
    isInstalled,
    isIOS,
    install,
    /** Call after the user completes the manual Add-to-Home-Screen guide. */
    markInstalled,
  };
}
