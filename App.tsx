/**
 * FocusPod — distraction-free audiobook listening with focus sessions.
 */

import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AppNavigator from './src/navigation/AppNavigator';
import { usePlaybackStore } from './src/stores/playbackStore';
import { useSettingsStore } from './src/stores/settingsStore';

export default function App() {
  const initPlayer = usePlaybackStore(s => s.initPlayer);
  const loadPreferences = useSettingsStore(s => s.loadPreferences);

  useEffect(() => {
    loadPreferences();
    initPlayer().catch(console.error);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />
      <AppNavigator />
    </GestureHandlerRootView>
  );
}
