// ─── Data Models ────────────────────────────────────────────────────────────

export interface Book {
  id: string;
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  categories: string[];
  chapters: Chapter[];
  duration: number; // total seconds
  /**
   * Set only for podcasts: the RSS feed the episode list comes from. LibriVox
   * books derive their chapters from the Archive metadata endpoint instead.
   */
  feedUrl?: string;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  audioUrl: string;
  duration: number; // seconds
}

// ─── Audio Engine ─────────────────────────────────────────────────────────

export type AudioStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'completed'
  | 'error';

export interface PlaybackState {
  bookId: string | null;
  chapterId: string | null;
  chapterIndex: number;
  position: number; // seconds
  status: AudioStatus;
}

// ─── Focus Session ────────────────────────────────────────────────────────

export type SessionStatus =
  | 'not_started'
  | 'preparing'
  | 'active'
  | 'paused'
  | 'completed'
  | 'interrupted'
  | 'cancelled';

/**
 * A moment the user navigated away from FocusPod during an active session.
 *
 * On mobile these are rare (blocked apps can't be opened at all); on web they
 * are the primary accountability signal, since the browser sandbox cannot stop
 * the user from switching tabs — only notice that they did.
 */
export interface Distraction {
  at: number; // unix ms when focus was lost
  durationMs: number; // how long the user stayed away (0 while still away)
}

export interface FocusSession {
  id: string;
  duration: number; // minutes
  startTime: number | null; // unix timestamp ms
  endTime: number | null;
  status: SessionStatus;
  blockedApps: string[];
  bookId: string | null;
  distractions: Distraction[];
}

// ─── Preferences ──────────────────────────────────────────────────────────

export type AppTheme = 'dark' | 'light';

export interface UserPreferences {
  theme: AppTheme;
  haptics: boolean;
  defaultSessionDuration: number; // minutes
  blockedApps: string[];
  playbackRate: number; // 0.75 | 1 | 1.25 | 1.5 | 2
  /** Keep the screen awake for the duration of a focus session (web: Wake Lock). */
  keepAwake: boolean;
}

// ─── Blocking ─────────────────────────────────────────────────────────────

export interface BlockableApp {
  packageName: string;
  appName: string;
  icon?: string;
}
