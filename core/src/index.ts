export * from './types';
export * from './ports';
export { configureCore } from './ports/registry';
export type { CorePorts } from './ports/registry';

export * as archiveService from './services/archiveService';
export { isHydrated, fetchVersions, extractNarrator } from './services/archiveService';
export { fetchBookText } from './services/textService';
export { GENRES, SORT_LABELS } from './services/archiveService';
export { PODCAST_TOPICS, isPodcast } from './services/podcastService';
export { usePodcastStore } from './stores/podcastStore';
export type { GenreKey, SortOption } from './services/archiveService';
export type { BookText } from './services/textService';

export { useLibraryStore } from './stores/libraryStore';
export { usePlaybackStore } from './stores/playbackStore';
export {
  useSessionStore,
  FOCUS_DURATIONS,
  totalDistractionMs,
} from './stores/sessionStore';
export type { FocusSetupStep } from './stores/sessionStore';
export {
  useSettingsStore,
  DEFAULT_PREFERENCES,
  PLAYBACK_RATES,
} from './stores/settingsStore';
export {
  useReadAlongStore,
  bookFraction,
  buildAlignment,
  estimateParagraph,
} from './stores/readAlongStore';
export {
  useFavoritesStore,
  listFavorites,
  listFavoriteChapters,
  chapterFavoriteAsBook,
} from './stores/favoritesStore';
export { useAuthStore, accountsAvailable, looksLikeEmail, setAccountChangeHandler } from './stores/authStore';
export {
  useStreakStore,
  computeStreak,
  longestStreak,
  recentDays,
  dayKey,
  DAILY_GOAL_SECONDS,
  MILESTONES,
} from './stores/streakStore';
export { THEMES, DEFAULT_THEME, themeMeta, isThemeFree } from './services/themes';
export type { ThemeMeta } from './services/themes';
export { FREE, SIGNED_IN, entitlementsFor } from './services/entitlements';
export type { Entitlements } from './services/entitlements';
export { syncNow, scheduleSync, flushSync, syncStatus, onSyncStatus } from './services/sync';
export type { SyncStatus } from './services/sync';
export type { PersistedFavorite, PersistedChapterFavorite } from './services/storage';
export { useDownloadStore } from './stores/downloadStore';
export type { DownloadStatus, BookDownloadState } from './stores/downloadStore';
export { useIpodNavStore } from './stores/ipodNavStore';
export type { ScreenId, StackEntry } from './stores/ipodNavStore';

export { formatTime, formatDuration } from './utils/format';
