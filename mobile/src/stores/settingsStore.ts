import { create } from 'zustand';
import { UserPreferences } from '../types';
import * as storageService from '../services/storageService';

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  haptics: true,
  defaultSessionDuration: 30,
  blockedApps: [],
  playbackRate: 1.0,
};

interface SettingsStoreState {
  preferences: UserPreferences;
  isLoaded: boolean;

  loadPreferences: () => Promise<void>;
  setTheme: (theme: UserPreferences['theme']) => Promise<void>;
  setHaptics: (enabled: boolean) => Promise<void>;
  setDefaultDuration: (minutes: number) => Promise<void>;
  setBlockedApps: (apps: string[]) => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  isLoaded: false,

  loadPreferences: async () => {
    const saved = await storageService.loadPreferences();
    set({
      preferences: saved ? { ...DEFAULT_PREFERENCES, ...saved } : DEFAULT_PREFERENCES,
      isLoaded: true,
    });
  },

  setTheme: async (theme) => {
    const updated = { ...get().preferences, theme };
    set({ preferences: updated });
    await storageService.savePreferences(updated);
  },

  setHaptics: async (haptics) => {
    const updated = { ...get().preferences, haptics };
    set({ preferences: updated });
    await storageService.savePreferences(updated);
  },

  setDefaultDuration: async (defaultSessionDuration) => {
    const updated = { ...get().preferences, defaultSessionDuration };
    set({ preferences: updated });
    await storageService.savePreferences(updated);
  },

  setBlockedApps: async (blockedApps) => {
    const updated = { ...get().preferences, blockedApps };
    set({ preferences: updated });
    await storageService.savePreferences(updated);
  },

  setPlaybackRate: async (playbackRate) => {
    const updated = { ...get().preferences, playbackRate };
    set({ preferences: updated });
    await storageService.savePreferences(updated);
  },
}));
