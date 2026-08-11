/**
 * Typed JSON helpers over the StoragePort. All persistence in core goes
 * through here so key names live in one place.
 */

import { storage } from '../ports/registry';
import { Book, FocusSession, PlaybackState, UserPreferences } from '../types';

const KEYS = {
  PREFERENCES: '@focuspod/preferences',
  PLAYBACK_STATE: '@focuspod/playback_state',
  SESSIONS: '@focuspod/sessions',
  DOWNLOADS: '@focuspod/downloads',
  FAVORITES: '@focuspod/favorites',
  CATALOG_CACHE: '@focuspod/catalog_cache',
} as const;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await storage().getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt entry — treat as absent rather than breaking startup.
    return null;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await storage().setItem(key, JSON.stringify(value));
  } catch (error) {
    // Quota exhaustion must never take down playback or an active session.
    console.warn('[Storage] write failed for', key, error);
  }
}

// ─── Preferences ──────────────────────────────────────────────────────────

export const loadPreferences = () => readJson<UserPreferences>(KEYS.PREFERENCES);
export const savePreferences = (prefs: UserPreferences) =>
  writeJson(KEYS.PREFERENCES, prefs);

// ─── Playback state ───────────────────────────────────────────────────────

export const loadPlaybackState = () => readJson<PlaybackState>(KEYS.PLAYBACK_STATE);
export const savePlaybackState = (state: PlaybackState) =>
  writeJson(KEYS.PLAYBACK_STATE, state);

// ─── Sessions ─────────────────────────────────────────────────────────────

export async function loadSessions(): Promise<FocusSession[]> {
  return (await readJson<FocusSession[]>(KEYS.SESSIONS)) ?? [];
}

export async function appendSession(session: FocusSession): Promise<void> {
  const existing = await loadSessions();
  await writeJson(KEYS.SESSIONS, [session, ...existing].slice(0, 100));
}

// ─── Downloads ────────────────────────────────────────────────────────────

/**
 * A downloaded book's manifest.
 *
 * `book` is the whole hydrated record, not just display fields. Audio bytes are
 * useless without the chapter list that names and orders them, and that list
 * otherwise exists only inside a cached archive.org HTTP response — which
 * expires and can be evicted, leaving downloaded audio unplayable. Storing the
 * book here is what makes a download genuinely offline-complete.
 */
export interface PersistedDownload {
  book: Book;
  /** Chapter ids whose audio is actually stored. May be a subset of book.chapters. */
  chapterIds: string[];
}

export const loadDownloadIndex = async () =>
  (await readJson<Record<string, PersistedDownload>>(KEYS.DOWNLOADS)) ?? {};
export const saveDownloadIndex = (index: Record<string, PersistedDownload>) =>
  writeJson(KEYS.DOWNLOADS, index);

// ─── Favourites ───────────────────────────────────────────────────────────

export interface PersistedFavorite {
  /** Stripped of its chapter list — see favoritesStore for why. */
  book: Book;
  addedAt: number;
}

export const loadFavorites = async () =>
  (await readJson<Record<string, PersistedFavorite>>(KEYS.FAVORITES)) ?? {};
export const saveFavorites = (items: Record<string, PersistedFavorite>) =>
  writeJson(KEYS.FAVORITES, items);

// ─── Catalog cache ────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

export async function readCatalogCache<T>(subKey: string): Promise<T | null> {
  const all = await readJson<Record<string, CacheEntry<T>>>(KEYS.CATALOG_CACHE);
  const entry = all?.[subKey];
  if (!entry) return null;
  if (Date.now() - entry.ts > CATALOG_TTL_MS) return null;
  return entry.data;
}

export async function writeCatalogCache<T>(subKey: string, data: T): Promise<void> {
  const all = (await readJson<Record<string, CacheEntry<T>>>(KEYS.CATALOG_CACHE)) ?? {};
  all[subKey] = { data, ts: Date.now() };
  await writeJson(KEYS.CATALOG_CACHE, all);
}
