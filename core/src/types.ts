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
  /**
   * Who reads the recording. LibriVox does not publish this as a field — the
   * Archive's `creator` is the *author* — so it is extracted from the
   * description where stated, and absent otherwise.
   */
  narrator?: string;
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

/**
 * Theme ids. 'classic' and 'midnight' are what used to be 'light' and 'dark';
 * settingsStore migrates the two old values on read, so a stored preference
 * from an earlier build still resolves.
 */
export type AppTheme =
  | 'classic'
  | 'midnight'
  | 'strawberry'
  | 'matcha'
  | 'blueberry'
  | 'peach'
  | 'lavender'
  | 'bubblegum';

export interface UserPreferences {
  theme: AppTheme;
  haptics: boolean;
  defaultSessionDuration: number; // minutes
  blockedApps: string[];
  playbackRate: number; // 0.75 | 1 | 1.25 | 1.5 | 2
  /** Keep the screen awake for the duration of a focus session (web: Wake Lock). */
  keepAwake: boolean;
  /**
   * Allow tapping a row directly instead of rotating to it. The wheel is
   * unaffected either way — this only adds a second route to the same action.
   */
  tapToSelect: boolean;
  /**
   * Anonymous usage analytics. null = never asked, so the consent prompt is
   * still owed; false = declined and no tracking script is ever loaded.
   */
  analyticsConsent: boolean | null;
  /** Version whose release notes have been read, for the What's New marker. */
  lastSeenVersion: string | null;
  /**
   * Whether to keep a listening streak. Opt-out rather than opt-in: the counter
   * is local and costs nothing, but a streak is a pressure some listeners
   * explicitly do not want, and turning it off must actually stop the counting.
   */
  streakEnabled: boolean;
}

// ─── Blocking ─────────────────────────────────────────────────────────────

export interface BlockableApp {
  packageName: string;
  appName: string;
  icon?: string;
}

// ─── Account ──────────────────────────────────────────────────────────────

/**
 * A signed-in listener. Deliberately tiny: the email is the only thing the app
 * ever knows about a person, and there is no profile, name or avatar to leak.
 */
export interface Account {
  id: string;
  email: string;
}

export type AuthStatus =
  /** No auth implementation was configured in this build. */
  | 'unavailable'
  /** Restoring a stored session; unknown either way. */
  | 'loading'
  | 'signed-out'
  /** A link has been sent and we are waiting for it to be opened. */
  | 'link-sent'
  | 'signed-in';

// ─── Streak ───────────────────────────────────────────────────────────────

/**
 * Listening totals per local calendar day, `YYYY-MM-DD` → seconds.
 *
 * Local dates, not UTC: a streak is about the listener's day. The cost is that
 * flying across timezones can gift or cost a day, which is the right trade —
 * the alternative punishes anyone who listens in the evening east of UTC.
 */
export type StreakDays = Record<string, number>;

export interface StreakState {
  days: StreakDays;
  /** Consecutive qualifying days ending today or yesterday. */
  current: number;
  longest: number;
  /** Milestone day-counts already celebrated, so a badge is only shown once. */
  celebrated: number[];
}
