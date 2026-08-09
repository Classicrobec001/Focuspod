import { create } from 'zustand';
import { BlockableApp, Distraction, FocusSession, SessionStatus } from '../types';
import { focusGuard } from '../ports/registry';
import { appendSession, loadSessions } from '../services/storage';

function generateId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Focus setup steps.
 *   'duration' → how long
 *   'book'     → what to listen to (skipped when entered from a book)
 *   'apps'     → which apps to block (only on platforms that can block)
 */
export type FocusSetupStep = 'duration' | 'book' | 'apps';

export const FOCUS_DURATIONS = [15, 25, 30, 45, 60, 90];

interface SessionStoreState {
  currentSession: FocusSession | null;
  sessions: FocusSession[];
  remainingSeconds: number;
  timerHandle: ReturnType<typeof setInterval> | null;
  /** Set while the user is away during an active session. */
  awaySince: number | null;

  focusSetupStep: FocusSetupStep;
  installedApps: BlockableApp[];
  isLoadingApps: boolean;
  selectedAppsForSession: string[];
  selectedDuration: number;
  focusSetupBookId: string | null;

  /** Steps this platform can actually offer, in order. */
  availableSteps: () => FocusSetupStep[];

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

  loadInstalledApps: () => Promise<void>;
  setFocusSetupStep: (step: FocusSetupStep) => void;
  advanceSetupStep: () => FocusSetupStep | 'confirm';
  setSelectedDuration: (minutes: number) => void;
  setFocusSetupBookId: (bookId: string | null) => void;
  toggleAppForSession: (packageName: string) => void;
  resetFocusSetup: () => void;
}

/** Unsubscribe handle for the distraction listener; outside state, no re-render. */
let distractionUnsub: (() => void) | null = null;

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  currentSession: null,
  sessions: [],
  remainingSeconds: 0,
  timerHandle: null,
  awaySince: null,

  focusSetupStep: 'duration',
  installedApps: [],
  isLoadingApps: false,
  selectedAppsForSession: [],
  selectedDuration: 25,
  focusSetupBookId: null,

  availableSteps: () => {
    const steps: FocusSetupStep[] = ['duration', 'book'];
    // Only offer the app picker where blocking can actually be enforced —
    // a browser cannot see or foreground other applications.
    if (focusGuard().capability === 'hard-block') steps.push('apps');
    return steps;
  },

  createSession: ({ duration, blockedApps, bookId }) => {
    const session: FocusSession = {
      id: generateId(),
      duration,
      startTime: null,
      endTime: null,
      status: 'not_started',
      blockedApps,
      bookId,
      distractions: [],
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
    set({ currentSession: started, remainingSeconds: started.duration * 60 });

    const guard = focusGuard();
    if (guard.capability !== 'none') {
      if (guard.capability === 'hard-block' && started.blockedApps.length > 0) {
        const granted = await guard.hasPermission();
        if (!granted) {
          console.warn('[Session] blocking permission not granted — enforcement inactive');
        }
      }
      await guard.start(started.blockedApps);

      distractionUnsub?.();
      distractionUnsub = guard.onDistraction(({ at, durationMs }) => {
        set(s => {
          if (!s.currentSession) return s;
          // durationMs === 0 marks leaving; a later event with the elapsed
          // time closes the same distraction out.
          if (durationMs === 0) {
            return {
              awaySince: at,
              currentSession: {
                ...s.currentSession,
                distractions: [...s.currentSession.distractions, { at, durationMs: 0 }],
              },
            };
          }
          const distractions = [...s.currentSession.distractions];
          const open = distractions.findIndex(d => d.durationMs === 0);
          if (open >= 0) distractions[open] = { ...distractions[open], durationMs };
          return {
            awaySince: null,
            currentSession: { ...s.currentSession, distractions },
          };
        });
      });
    }

    const handle = setInterval(() => get().tick(), 1000);
    set({ timerHandle: handle });
  },

  pauseSession: () => {
    const { timerHandle, currentSession } = get();
    if (timerHandle) clearInterval(timerHandle);
    if (currentSession) {
      set({
        currentSession: { ...currentSession, status: 'paused' },
        timerHandle: null,
      });
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
    distractionUnsub?.();
    distractionUnsub = null;

    if (currentSession) {
      const ended: FocusSession = {
        ...currentSession,
        status,
        endTime: Date.now(),
      };
      await appendSession(ended);
      await focusGuard().stop();
      set(s => ({
        sessions: [ended, ...s.sessions].slice(0, 100),
        currentSession: null,
        timerHandle: null,
        remainingSeconds: 0,
        awaySince: null,
        focusSetupStep: 'duration',
        selectedAppsForSession: [],
        focusSetupBookId: null,
      }));
    }
  },

  cancelSession: async () => {
    await get().endSession('cancelled');
  },

  /**
   * Derives the remaining time from wall-clock rather than counting ticks.
   *
   * Browsers throttle timers in background tabs to once a minute or stop them
   * entirely when the screen locks, so a tick-counting timer would drift badly
   * during exactly the sessions the user cares about.
   */
  tick: () => {
    const { currentSession } = get();
    if (!currentSession || currentSession.status !== 'active' || !currentSession.startTime) {
      return;
    }
    const elapsedMs = Date.now() - currentSession.startTime;
    const remaining = Math.max(0, Math.round(currentSession.duration * 60 - elapsedMs / 1000));
    set({ remainingSeconds: remaining });
    if (remaining <= 0) {
      void get().endSession('completed');
    }
  },

  loadSessions: async () => {
    set({ sessions: await loadSessions() });
  },

  loadInstalledApps: async () => {
    if (get().isLoadingApps) return;
    set({ isLoadingApps: true });
    try {
      set({ installedApps: await focusGuard().listBlockableApps() });
    } catch (e) {
      console.warn('[Session] loadInstalledApps error:', e);
    } finally {
      set({ isLoadingApps: false });
    }
  },

  setFocusSetupStep: step => set({ focusSetupStep: step }),

  /**
   * Moves to the next step this platform supports, skipping the book step when
   * a book is already chosen. Returns 'confirm' when setup is complete.
   */
  advanceSetupStep: () => {
    const { focusSetupStep, focusSetupBookId } = get();
    const steps = get().availableSteps().filter(s => !(s === 'book' && focusSetupBookId));
    const next = steps[steps.indexOf(focusSetupStep) + 1];
    if (!next) return 'confirm';
    set({ focusSetupStep: next });
    return next;
  },

  setSelectedDuration: minutes => set({ selectedDuration: minutes }),
  setFocusSetupBookId: bookId => set({ focusSetupBookId: bookId }),

  toggleAppForSession: packageName =>
    set(s => ({
      selectedAppsForSession: s.selectedAppsForSession.includes(packageName)
        ? s.selectedAppsForSession.filter(p => p !== packageName)
        : [...s.selectedAppsForSession, packageName],
    })),

  resetFocusSetup: () =>
    set({
      focusSetupStep: 'duration',
      selectedAppsForSession: [],
      selectedDuration: 25,
      focusSetupBookId: null,
    }),
}));

/** Total time away from the app during a session, in ms. */
export function totalDistractionMs(distractions: Distraction[]): number {
  return distractions.reduce((total, d) => total + d.durationMs, 0);
}
