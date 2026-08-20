import { create } from 'zustand';
import { AppTheme, UserPreferences } from '../types';
import { haptics } from '../ports/registry';
import { loadPreferences, savePreferences } from '../services/storage';
import { DEFAULT_THEME, THEMES } from '../services/themes';

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: DEFAULT_THEME,
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
  streakEnabled: true,
};

/**
 * The theme names shipped before the palette set existed. A stored preference
 * of 'light' or 'dark' has to keep working, and anything unrecognised — a
 * downgrade after trying a newer build — falls back rather than rendering an
 * unstyled shell.
 */
const LEGACY_THEMES: Record<string, AppTheme> = { light: 'classic', dark: 'midnight' };

function migrateTheme(stored: string | undefined): AppTheme {
  if (!stored) return DEFAULT_THEME;
  if (THEMES.some(t => t.id === stored)) return stored as AppTheme;
  return LEGACY_THEMES[stored] ?? DEFAULT_THEME;
}

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
    const preferences: UserPreferences = saved
      ? { ...DEFAULT_PREFERENCES, ...saved, theme: migrateTheme(saved.theme) }
      : DEFAULT_PREFERENCES;
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
