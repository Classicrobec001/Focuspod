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
export { useFavoritesStore, listFavorites } from './stores/favoritesStore';
export { useDownloadStore } from './stores/downloadStore';
export type { DownloadStatus, BookDownloadState } from './stores/downloadStore';
export { useIpodNavStore } from './stores/ipodNavStore';
export type { ScreenId, StackEntry } from './stores/ipodNavStore';

export { formatTime, formatDuration } from './utils/format';
