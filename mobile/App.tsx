/**
 * FocusPod — distraction-free audiobook listening with focus sessions.
 *
 * App shell: initialises audio + preferences, then hands full control to
 * IpodDevice which owns all UI and navigation.
 */

import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeModules } from 'react-native';
import IpodDevice from './src/components/IpodDevice';
import { usePlaybackStore } from './src/stores/playbackStore';
import { useSettingsStore } from './src/stores/settingsStore';
import { useDownloadStore } from './src/stores/downloadStore';

// ─── RNFS availability check (runs once at startup) ───────────────────────────
// If RNFSManager is null the native module is not linked and all downloads will fail.
const RNFSManager = NativeModules.RNFSManager;
console.log('[App] RNFSManager native module:', RNFSManager != null ? 'AVAILABLE' : 'MISSING');
if (RNFSManager) {
  console.log('[App] RNFSManager.RNFSDocumentDirectoryPath:', RNFSManager.RNFSDocumentDirectoryPath);
}

export default function App() {
  const initPlayer      = usePlaybackStore(s => s.initPlayer);
  const loadPreferences = useSettingsStore(s => s.loadPreferences);
  const loadSaved       = useDownloadStore(s => s.loadSaved);

  useEffect(() => {
    // Init in sequence so the saved playback rate is applied after the player is ready
    (async () => {
      await loadPreferences();
      await initPlayer().catch(console.error);
      const rate = useSettingsStore.getState().preferences.playbackRate ?? 1.0;
      if (rate !== 1.0) {
        await usePlaybackStore.getState().setRate(rate).catch(console.error);
      }
    })();
    loadSaved().catch(console.error);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <IpodDevice />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
