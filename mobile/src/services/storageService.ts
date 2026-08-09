import AsyncStorage from '@react-native-async-storage/async-storage';
import { FocusSession, UserPreferences, PlaybackState } from '../types';

const KEYS = {
  PREFERENCES: '@focuspod/preferences',
  PLAYBACK_STATE: '@focuspod/playback_state',
  SESSIONS: '@focuspod/sessions',
  DOWNLOADED_BOOKS: '@focuspod/downloaded_books',
} as const;

async function get<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

async function set<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// ─── Preferences ──────────────────────────────────────────────────────────

export async function loadPreferences(): Promise<UserPreferences | null> {
  return get<UserPreferences>(KEYS.PREFERENCES);
}

export async function savePreferences(prefs: UserPreferences): Promise<void> {
  return set(KEYS.PREFERENCES, prefs);
}

// ─── Playback State ───────────────────────────────────────────────────────

export async function loadPlaybackState(): Promise<PlaybackState | null> {
  return get<PlaybackState>(KEYS.PLAYBACK_STATE);
}

export async function savePlaybackState(state: PlaybackState): Promise<void> {
  return set(KEYS.PLAYBACK_STATE, state);
}

// ─── Sessions ─────────────────────────────────────────────────────────────

export async function loadSessions(): Promise<FocusSession[]> {
  return (await get<FocusSession[]>(KEYS.SESSIONS)) ?? [];
}

export async function appendSession(session: FocusSession): Promise<void> {
  const existing = await loadSessions();
  const updated = [session, ...existing].slice(0, 100); // keep last 100
  return set(KEYS.SESSIONS, updated);
}

// ─── Downloaded Books ─────────────────────────────────────────────────────

export async function loadDownloadedBookIds(): Promise<string[]> {
  return (await get<string[]>(KEYS.DOWNLOADED_BOOKS)) ?? [];
}

export async function markBookDownloaded(bookId: string): Promise<void> {
  const ids = await loadDownloadedBookIds();
  if (!ids.includes(bookId)) {
    return set(KEYS.DOWNLOADED_BOOKS, [...ids, bookId]);
  }
}
