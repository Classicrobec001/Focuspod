import { useEffect, useState } from 'react';
import {
  useDownloadStore,
  usePlaybackStore,
  useSessionStore,
  useSettingsStore,
  useFavoritesStore,
} from '@focuspod/core';
import IpodDevice from './components/IpodDevice';
import InstallPrompt from './components/InstallPrompt';
import ConsentPrompt from './components/ConsentPrompt';
import UpdatePrompt from './components/UpdatePrompt';
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
    const onOnline = () => void useDownloadStore.getState().resumeInterrupted();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
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
      <InstallPrompt />
      <ConsentPrompt />
      <UpdatePrompt />
    </>
  );
}
