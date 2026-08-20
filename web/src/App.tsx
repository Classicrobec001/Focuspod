import { useEffect, useState } from 'react';
import {
  useDownloadStore,
  usePlaybackStore,
  useSessionStore,
  useSettingsStore,
  useFavoritesStore,
  useAuthStore,
  useStreakStore,
  setAccountChangeHandler,
  syncNow,
  flushSync,
  isThemeFree,
  DEFAULT_THEME,
} from '@focuspod/core';
import IpodDevice from './components/IpodDevice';
import InstallPrompt from './components/InstallPrompt';
import ConsentPrompt from './components/ConsentPrompt';
import UpdatePrompt from './components/UpdatePrompt';
import StreakToast from './components/StreakToast';
import { analytics, setAnalyticsConsent } from './analytics';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Order matters: preferences configure the haptics port, and the download
    // index has to be verified before playback can resolve offline chapters.
    (async () => {
      await useSettingsStore.getState().loadPreferences();
      // Apply the stored decision before anything is tracked. Until this runs,
      // and whenever it is false, no analytics script is loaded at all.
      const { analyticsConsent } = useSettingsStore.getState().preferences;
      setAnalyticsConsent(analyticsConsent);
      analytics.appOpen(
        window.matchMedia('(display-mode: standalone)').matches ||
          (window.navigator as { standalone?: boolean }).standalone === true,
      );
      await useDownloadStore.getState().loadSaved();
      await usePlaybackStore.getState().initPlayer();
      await useSessionStore.getState().loadSessions();
      await useFavoritesStore.getState().load();
      await useStreakStore.getState().load();

      // Registered before init so the very first restored session syncs too.
      // `adoptTheme` only on a genuine sign-in: on every later sync the local
      // choice is the newer one and must not be overwritten by the stored blob.
      let firstSync = true;
      setAccountChangeHandler(account => {
        if (!account) return;
        if (firstSync) analytics.signInCompleted();
        void syncNow({ adoptTheme: firstSync });
        firstSync = false;
      });
      await useAuthStore.getState().init();

      setReady(true);
      // Downloads stop when the tab closes or the connection drops. Pick up
      // where they left off once the UI is up, so the user never has to notice.
      // Skipped while offline — the 'online' listener below covers that case.
      if (navigator.onLine !== false) {
        void useDownloadStore.getState().resumeInterrupted();
      }
    })().catch(error => {
      console.error('[App] startup failed:', error);
      // Render anyway — a failed preference read shouldn't be a blank screen.
      setReady(true);
    });
  }, []);

  // Same again when the connection comes back mid-session.
  useEffect(() => {
    const onOnline = () => {
      void useDownloadStore.getState().resumeInterrupted();
      // A sync that failed while offline is worth retrying straight away.
      void syncNow();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  /*
   * Paint the chosen palette.
   *
   * Subscribed rather than read once, so a theme picked on another device and
   * pulled in by a sync applies without a reload. The attribute is set on the
   * root element because that is what the `:root[data-theme=…]` blocks in
   * index.css select on.
   */
  useEffect(() => {
    const apply = (theme: string) => {
      document.documentElement.dataset.theme = theme;
    };
    apply(useSettingsStore.getState().preferences.theme);
    return useSettingsStore.subscribe(state => apply(state.preferences.theme));
  }, []);

  /*
   * Signing out gives back the locked themes, so fall back to a free one.
   *
   * Only once auth has actually resolved — 'loading' means we do not yet know,
   * and stripping the theme on every cold start before the session restores
   * would make it look like the setting never saved.
   */
  useEffect(
    () =>
      useAuthStore.subscribe(state => {
        if (state.status !== 'signed-out') return;
        const { theme } = useSettingsStore.getState().preferences;
        if (!isThemeFree(theme)) void useSettingsStore.getState().update({ theme: DEFAULT_THEME });
      }),
    [],
  );

  /*
   * Report the day being cleared, once, when it happens.
   *
   * Watched here rather than fired from the store because core has no
   * analytics — and it has to be an increase, not any change: `current` also
   * moves when a sync merges another device's history, which is not the
   * listener clearing today's ten minutes.
   */
  useEffect(() => {
    let previous = useStreakStore.getState().current;
    return useStreakStore.subscribe(state => {
      if (state.current > previous) analytics.streakDay(state.current);
      previous = state.current;
    });
  }, []);

  /*
   * Push any queued sync before the tab goes away. `pagehide` is the only event
   * iOS reliably fires before discarding a tab — the same reason playback
   * position is persisted there.
   */
  useEffect(() => {
    const flush = () => {
      flushSync();
      void useStreakStore.getState().suspend();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  if (!ready) {
    return (
      <div className="device">
        <div className="lcd">
          <div className="lcd__glass">
            <div className="lcd__titlebar">
              <span className="lcd__title">FocusPod</span>
            </div>
            <div className="lcd__content">
              <div className="panel__center">
                <span className="panel__subtitle">Starting…</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <IpodDevice />
      <StreakToast />
      <InstallPrompt />
      <ConsentPrompt />
      <UpdatePrompt />
    </>
  );
}
