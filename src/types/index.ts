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

export interface FocusSession {
  id: string;
  duration: number; // minutes
  startTime: number | null; // unix timestamp ms
  endTime: number | null;
  status: SessionStatus;
  blockedApps: string[];
  bookId: string | null;
}

// ─── Preferences ──────────────────────────────────────────────────────────

export type AppTheme = 'dark' | 'light';

export interface UserPreferences {
  theme: AppTheme;
  haptics: boolean;
  defaultSessionDuration: number; // minutes
  blockedApps: string[];
}

// ─── Navigation ───────────────────────────────────────────────────────────

export type RootStackParamList = {
  Library: undefined;
  BookDetail: { bookId: string };
  NowPlaying: undefined;
  FocusSetup: { bookId?: string };
  ActiveSession: { sessionId: string };
  Settings: undefined;
};

// ─── Blocking ─────────────────────────────────────────────────────────────

export interface BlockableApp {
  packageName: string;
  appName: string;
  icon?: string;
}
