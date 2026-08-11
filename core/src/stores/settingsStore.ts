import { create } from 'zustand';
import { UserPreferences } from '../types';
import { haptics } from '../ports/registry';
import { loadPreferences, savePreferences } from '../services/storage';

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  haptics: true,
  defaultSessionDuration: 30,
  blockedApps: [],
  playbackRate: 1.0,
  keepAwake: true,
  // On by default: the wheel alone is unusable with a screen reader, and a
  // 21,000-title catalog is tedious to rotate through.
  tapToSelect: true,
  analyticsConsent: null,
  lastSeenVersion: null,
};

export const PLAYBACK_RATES = [0.75, 1.0, 1.25, 1.5, 2.0];

interface SettingsStoreState {
  preferences: UserPreferences;
  isLoaded: boolean;

  loadPreferences: () => Promise<void>;
  update: (patch: Partial<UserPreferences>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  isLoaded: false,

  loadPreferences: async () => {
    const saved = await loadPreferences();
    const preferences = saved ? { ...DEFAULT_PREFERENCES, ...saved } : DEFAULT_PREFERENCES;
    haptics().setEnabled(preferences.haptics);
    set({ preferences, isLoaded: true });
  },

  update: async patch => {
    const preferences = { ...get().preferences, ...patch };
    if (patch.haptics !== undefined) haptics().setEnabled(patch.haptics);
    set({ preferences });
    await savePreferences(preferences);
  },
}));
