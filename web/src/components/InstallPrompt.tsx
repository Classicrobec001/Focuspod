/**
 * InstallPrompt — nudges the user to install FocusPod to the home screen.
 *
 * Installing matters here beyond convenience: a standalone PWA keeps playing
 * more reliably in the background than a browser tab, gets its own task-switcher
 * entry, and loses the browser chrome that breaks the device illusion.
 *
 * Chromium fires `beforeinstallprompt` and lets us trigger the native sheet.
 * iOS Safari does neither, so it gets instructions instead — which is the only
 * honest option, since Apple has never exposed a programmatic install path.
 */

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = '@focuspod/install_dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's non-standard flag, still the only signal on iOS.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // Private mode — just show it.
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    // iOS never fires the event; show the manual hint after a delay so it
    // doesn't greet a first-time visitor before they've seen anything.
    const timer = isIos() ? window.setTimeout(() => setShowIosHint(true), 20_000) : undefined;

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Non-fatal.
    }
    setDeferred(null);
    setShowIosHint(false);
  };

  if (deferred) {
    return (
      <div className="install" role="dialog" aria-label="Install FocusPod">
        <span>Install FocusPod</span>
        <button
          type="button"
          onClick={async () => {
            await deferred.prompt();
            await deferred.userChoice;
            setDeferred(null);
          }}
        >
          Install
        </button>
        <button type="button" className="install__dismiss" onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className="install" role="dialog" aria-label="Install FocusPod">
        <span>
          Add to Home Screen: tap Share <span aria-hidden="true">􀈂</span> then “Add to Home
          Screen”.
        </span>
        <button type="button" className="install__dismiss" onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  return null;
}
