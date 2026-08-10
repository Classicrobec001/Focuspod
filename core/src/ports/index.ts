/**
 * Ports — the seam between shared domain logic and platform capabilities.
 *
 * Everything in `core` is written against these interfaces. `web` implements
 * them with browser APIs (HTMLAudioElement, Cache Storage, IndexedDB, Wake
 * Lock); `mobile` implements them with react-native-track-player, react-native-fs
 * and the FocusPod Kotlin modules.
 *
 * Rule: if a capability differs between platforms, it belongs here — never in a
 * store and never behind a `Platform.OS` check.
 */

import { AudioStatus, BlockableApp, Chapter } from '../types';

// ─── Audio ────────────────────────────────────────────────────────────────

export interface AudioTrack {
  id: string;
  url: string;
  title: string;
  artist: string;
  album: string;
  artwork?: string;
  /** Seconds, when known ahead of time. */
  duration?: number;
}

export type AudioEvent =
  | { type: 'status'; status: AudioStatus }
  | { type: 'progress'; position: number; duration: number }
  /** The engine advanced to another queue entry on its own (track ended). */
  | { type: 'track'; index: number }
  /**
   * Something worth telling the user, but not a failure — e.g. chapters that
   * aren't downloaded were skipped while offline. Does not change status.
   */
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };

export interface AudioPort {
  setup(): Promise<void>;
  loadQueue(tracks: AudioTrack[], startIndex: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  skipToNext(): Promise<void>;
  skipToPrevious(): Promise<void>;
  setRate(rate: number): Promise<void>;
  getProgress(): Promise<{ position: number; duration: number }>;
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: AudioEvent) => void): () => void;
}

// ─── Storage ──────────────────────────────────────────────────────────────

/**
 * Minimal async key/value store. Satisfied by AsyncStorage on mobile and by
 * localStorage (or IndexedDB) on web. Values are always JSON strings.
 */
export interface StoragePort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// ─── Offline downloads ────────────────────────────────────────────────────

export interface DownloadPort {
  /**
   * A URL the audio engine can play for this chapter: the local copy when one
   * exists, otherwise `remoteUrl` unchanged.
   */
  resolveUrl(bookId: string, chapterId: string, remoteUrl: string): Promise<string>;
  isChapterDownloaded(bookId: string, chapterId: string): Promise<boolean>;
  /** Resolves once the chapter is fully stored. Rejects with AbortError on cancel. */
  downloadChapter(
    bookId: string,
    chapter: Chapter,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
  deleteBook(bookId: string, chapterIds: string[]): Promise<void>;
  /** Bytes currently used by downloaded audio, when the platform can report it. */
  usage(): Promise<{ usedBytes: number; quotaBytes: number | null }>;
}

// ─── Haptics / click-wheel feedback ───────────────────────────────────────

export interface HapticPort {
  /** One wheel detent. Called often — must be cheap and non-blocking. */
  tick(): void;
  /** Heavier confirmation pulse for select / menu. */
  select(): void;
  setEnabled(enabled: boolean): void;
}

// ─── Focus enforcement ────────────────────────────────────────────────────

/**
 * `hard-block` — the platform can prevent other apps from being opened
 *                (Android accessibility service + usage stats).
 * `soft-guard`  — the platform can only notice the user leaving and hold the
 *                screen awake (browsers).
 * `none`        — no enforcement of any kind (iOS).
 */
export type FocusCapability = 'hard-block' | 'soft-guard' | 'none';

export interface FocusGuardPort {
  readonly capability: FocusCapability;
  /** Empty on platforms without `hard-block`. */
  listBlockableApps(): Promise<BlockableApp[]>;
  /** Whether the OS permissions needed for enforcement have been granted. */
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<void>;
  start(blockedApps: string[]): Promise<void>;
  stop(): Promise<void>;
  /**
   * Fires when the user leaves FocusPod during an active session, and again
   * with the elapsed duration when they return. Returns an unsubscribe function.
   */
  onDistraction(listener: (event: { at: number; durationMs: number }) => void): () => void;
}
