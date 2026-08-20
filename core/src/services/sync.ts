/**
 * sync — mirroring the small, personal part of the app to an account.
 *
 * What crosses the wire: favourites, favourite chapters, streak days and the
 * chosen theme. What never does: downloaded audio (gigabytes, and the archive
 * is the source), the catalog cache (re-fetchable), focus session history
 * (long, and about a specific device's day) or playback position.
 *
 * The merge is union-and-max rather than last-writer-wins, because the common
 * case is two devices that have both been used offline and neither is stale.
 * Deleting a favourite on one device therefore does not delete it on the other
 * — it comes back on the next sync. That is the honest cost of a union merge,
 * and the alternative (tombstones with timestamps) is a lot of machinery for a
 * list of bookmarks.
 *
 * Every failure here is non-fatal and logged. Sync going wrong must never cost
 * the listener anything they have locally.
 */

import { CloudState } from '../ports';
import { auth } from '../ports/registry';
import { useAuthStore } from '../stores/authStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useStreakStore } from '../stores/streakStore';
import { useSettingsStore } from '../stores/settingsStore';
import { StreakDays } from '../types';
import { PersistedChapterFavorite, PersistedFavorite } from './storage';
import { THEMES } from './themes';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

let status: SyncStatus = 'idle';
let lastSyncedAt: number | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(status: SyncStatus, at: number | null) => void>();

function setStatus(next: SyncStatus): void {
  status = next;
  if (next === 'synced') lastSyncedAt = Date.now();
  listeners.forEach(listener => listener(status, lastSyncedAt));
}

export function syncStatus(): { status: SyncStatus; lastSyncedAt: number | null } {
  return { status, lastSyncedAt };
}

export function onSyncStatus(listener: (status: SyncStatus, at: number | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Keeps every entry from both sides; the earlier `addedAt` wins a collision. */
function unionByAddedAt<T extends { addedAt: number }>(
  local: Record<string, T>,
  remote: Record<string, T> | undefined,
): Record<string, T> {
  const merged: Record<string, T> = { ...local };
  for (const [id, entry] of Object.entries(remote ?? {})) {
    if (!entry || typeof entry.addedAt !== 'number') continue;
    const existing = merged[id];
    if (!existing || entry.addedAt < existing.addedAt) merged[id] = entry;
  }
  return merged;
}

function currentCloudState(): CloudState {
  const favorites = useFavoritesStore.getState();
  return {
    version: 1,
    updatedAt: Date.now(),
    favorites: favorites.items,
    favoriteChapters: favorites.chapters,
    streakDays: useStreakStore.getState().days,
    theme: useSettingsStore.getState().preferences.theme,
  };
}

/**
 * Pull, merge, push. `adoptTheme` is set only for the first sync after signing
 * in on a device — that is when "my setup follows me" is what the listener
 * expects, and every time after it would fight a local change.
 */
export async function syncNow({ adoptTheme = false } = {}): Promise<void> {
  if (!useAuthStore.getState().isSignedIn()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus('offline');
    return;
  }

  setStatus('syncing');
  try {
    const remote = await auth().pullState();

    if (remote && remote.version === 1) {
      const favorites = useFavoritesStore.getState();
      await favorites.replaceAll(
        unionByAddedAt(favorites.items, remote.favorites as Record<string, PersistedFavorite>),
        unionByAddedAt(
          favorites.chapters,
          remote.favoriteChapters as Record<string, PersistedChapterFavorite>,
        ),
      );

      await useStreakStore
        .getState()
        .mergeDays(
          (remote.streakDays ?? {}) as StreakDays,
          useAuthStore.getState().entitlements().streakHistoryDays,
        );

      if (adoptTheme && THEMES.some(t => t.id === remote.theme)) {
        await useSettingsStore.getState().update({ theme: remote.theme as never });
      }
    }

    await auth().pushState(currentCloudState());
    setStatus('synced');
  } catch (error) {
    console.warn('[Sync] failed:', error);
    setStatus('error');
  }
}

/**
 * Queue a push after a local change. Coalesced, because favouriting three
 * chapters in a row is one intent, not three round trips.
 */
export function scheduleSync(delayMs = 4000): void {
  if (!useAuthStore.getState().isSignedIn()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncNow();
  }, delayMs);
}

/** Flush a queued push immediately — used when the app is about to be hidden. */
export function flushSync(): void {
  if (!pushTimer) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  void syncNow();
}
