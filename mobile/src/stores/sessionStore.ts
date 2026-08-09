import { create } from 'zustand';
import { BlockableApp, FocusSession, SessionStatus } from '../types';
import * as storageService from '../services/storageService';
import * as blockingService from '../services/blockingService';

function generateId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ── Focus setup steps ─────────────────────────────────────────────────────────
// 'duration' → user picks how long (wheel scrolls FOCUS_DURATIONS)
// 'book'     → user picks an audiobook to listen to during the session
// 'apps'     → user picks which apps to block (wheel scrolls installed apps list)
// Session itself is created only when the user confirms on the 'apps' screen.
// When entering Focus from BookDetail (bookId param already known) the 'book'
// step is skipped and setup jumps straight from 'duration' → 'apps'.
export type FocusSetupStep = 'duration' | 'book' | 'apps';

interface SessionStoreState {
  currentSession: FocusSession | null;
  sessions: FocusSession[];
  remainingSeconds: number;
  timerHandle: ReturnType<typeof setInterval> | null;

  // ── Focus setup state (cleared on session end / screen exit) ─────────────
  focusSetupStep: FocusSetupStep;
  /** Installed non-system apps; populated by loadInstalledApps(). */
  installedApps: BlockableApp[];
  isLoadingApps: boolean;
  /** Apps the user has toggled on for the upcoming session. */
  selectedAppsForSession: string[];
  /** Duration chosen in the duration step (minutes). */
  selectedDuration: number;
  /** Book chosen in the book step (null = no book selected / will use currently loaded book). */
  focusSetupBookId: string | null;

  createSession: (params: {
    duration: number;
    blockedApps: string[];
    bookId: string | null;
  }) => FocusSession;
  startSession: (sessionId: string) => Promise<void>;
  pauseSession: () => void;
  resumeSession: () => void;
  endSession: (status?: SessionStatus) => Promise<void>;
  cancelSession: () => Promise<void>;
  loadSessions: () => Promise<void>;
  tick: () => void;

  // ── Focus setup actions ──────────────────────────────────────────────────
  loadInstalledApps: () => Promise<void>;
  setFocusSetupStep: (step: FocusSetupStep) => void;
  setSelectedDuration: (minutes: number) => void;
  setFocusSetupBookId: (bookId: string | null) => void;
  toggleAppForSession: (packageName: string) => void;
  /** Reset step, app selection, and duration — call when leaving setup. */
  resetFocusSetup: () => void;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  currentSession: null,
  sessions: [],
  remainingSeconds: 0,
  timerHandle: null,

  focusSetupStep: 'duration',
  installedApps: [],
  isLoadingApps: false,
  selectedAppsForSession: [],
  selectedDuration: 25, // overwritten by user selection; 25 min is a reasonable default
  focusSetupBookId: null,

  createSession: ({ duration, blockedApps, bookId }) => {
    const session: FocusSession = {
      id: generateId(),
      duration,
      startTime: null,
      endTime: null,
      status: 'not_started',
      blockedApps,
      bookId,
    };
    set({ currentSession: session, remainingSeconds: duration * 60 });
    return session;
  },

  startSession: async (sessionId: string) => {
    const { currentSession } = get();
    if (!currentSession || currentSession.id !== sessionId) return;

    const started: FocusSession = {
      ...currentSession,
      status: 'active',
      startTime: Date.now(),
    };
    set({ currentSession: started });

    if (started.blockedApps.length > 0) {
      const hasUsage = await blockingService.hasUsageStatsPermission();
      if (!hasUsage) {
        console.warn(
          '[Session] startSession: PACKAGE_USAGE_STATS not granted — ' +
          'app blocking will be inactive. Grant Usage Access in Settings.',
        );
      }
      await blockingService.startBlocking(started.blockedApps);
    }

    const handle = setInterval(() => get().tick(), 1000);
    set({ timerHandle: handle });
  },

  pauseSession: () => {
    const { timerHandle, currentSession } = get();
    if (timerHandle) clearInterval(timerHandle);
    if (currentSession) {
      set({ currentSession: { ...currentSession, status: 'paused' }, timerHandle: null });
    }
  },

  resumeSession: () => {
    const { currentSession } = get();
    if (!currentSession || currentSession.status !== 'paused') return;
    set({ currentSession: { ...currentSession, status: 'active' } });
    const handle = setInterval(() => get().tick(), 1000);
    set({ timerHandle: handle });
  },

  endSession: async (status: SessionStatus = 'completed') => {
    const { timerHandle, currentSession } = get();
    if (timerHandle) clearInterval(timerHandle);
    if (currentSession) {
      const ended: FocusSession = {
        ...currentSession,
        status,
        endTime: Date.now(),
      };
      await storageService.appendSession(ended);
      await blockingService.stopBlocking();
      set({
        currentSession: null,
        timerHandle: null,
        remainingSeconds: 0,
        // Reset setup state so the screen is fresh next time.
        focusSetupStep: 'duration',
        selectedAppsForSession: [],
        focusSetupBookId: null,
      });
    }
  },

  cancelSession: async () => {
    await get().endSession('cancelled');
  },

  tick: () => {
    const { remainingSeconds, currentSession } = get();
    if (!currentSession || currentSession.status !== 'active') return;
    const next = remainingSeconds - 1;
    if (next <= 0) {
      set({ remainingSeconds: 0 });
      get().endSession('completed');
    } else {
      set({ remainingSeconds: next });
    }
  },

  loadSessions: async () => {
    const sessions = await storageService.loadSessions();
    set({ sessions });
  },

  // ── Focus setup actions ────────────────────────────────────────────────────

  loadInstalledApps: async () => {
    if (get().isLoadingApps) {
      console.log('[Session] loadInstalledApps: already loading, skipping');
      return;
    }
    console.log('[Session] loadInstalledApps: starting');
    set({ isLoadingApps: true });
    try {
      const apps = await blockingService.getInstalledApps();
      console.log('[Session] loadInstalledApps: done —', apps.length, 'apps');
      set({ installedApps: apps });
    } catch (e) {
      console.warn('[Session] loadInstalledApps error:', e);
    } finally {
      set({ isLoadingApps: false });
    }
  },

  setFocusSetupStep: (step) => set({ focusSetupStep: step }),

  setSelectedDuration: (minutes) => set({ selectedDuration: minutes }),

  setFocusSetupBookId: (bookId) => set({ focusSetupBookId: bookId }),

  toggleAppForSession: (packageName) => {
    const { selectedAppsForSession } = get();
    const next = selectedAppsForSession.includes(packageName)
      ? selectedAppsForSession.filter(p => p !== packageName)
      : [...selectedAppsForSession, packageName];
    set({ selectedAppsForSession: next });
  },

  resetFocusSetup: () =>
    set({ focusSetupStep: 'duration', selectedAppsForSession: [], selectedDuration: 25, focusSetupBookId: null }),
}));
