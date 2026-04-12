import { create } from 'zustand';
import { FocusSession, SessionStatus } from '../types';
import * as storageService from '../services/storageService';
import * as blockingService from '../services/blockingService';

function generateId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

interface SessionStoreState {
  currentSession: FocusSession | null;
  sessions: FocusSession[];
  remainingSeconds: number;
  timerHandle: ReturnType<typeof setInterval> | null;

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
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  currentSession: null,
  sessions: [],
  remainingSeconds: 0,
  timerHandle: null,

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
      set({ currentSession: null, timerHandle: null, remainingSeconds: 0 });
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
}));
