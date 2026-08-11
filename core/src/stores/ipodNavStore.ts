/**
 * ipodNavStore — the stack navigator that drives the device shell.
 *
 * Every screen is a lightweight ScreenId; params are an optional payload.
 * Cursor positions are kept per screen so rotating back into a list lands
 * where the user left off.
 */

import { create } from 'zustand';

export type ScreenId =
  | 'home'
  | 'audiobooks'
  | 'genres'
  | 'podcast-topics'
  | 'podcast-shows'
  | 'search'
  | 'search-results'
  | 'downloads'
  | 'book-detail'
  | 'chapters'
  | 'now-playing'
  | 'read-along'
  | 'focus'
  | 'sessions'
  | 'settings';

export interface StackEntry {
  id: ScreenId;
  params?: Record<string, unknown>;
}

interface IpodNavState {
  stack: StackEntry[];
  cursors: Record<ScreenId, number>;

  push: (id: ScreenId, params?: Record<string, unknown>) => void;
  pop: () => void;
  reset: () => void;
  current: () => StackEntry;
  getCursor: (id: ScreenId) => number;
  moveCursor: (id: ScreenId, itemCount: number, direction: 1 | -1) => void;
  setCursor: (id: ScreenId, index: number) => void;
  resetCursor: (id: ScreenId) => void;
}

const ALL_SCREENS: ScreenId[] = [
  'home',
  'audiobooks',
  'genres',
  'podcast-topics',
  'podcast-shows',
  'search',
  'search-results',
  'downloads',
  'book-detail',
  'chapters',
  'now-playing',
  'read-along',
  'focus',
  'sessions',
  'settings',
];

const zeroCursors = () =>
  Object.fromEntries(ALL_SCREENS.map(id => [id, 0])) as Record<ScreenId, number>;

export const useIpodNavStore = create<IpodNavState>((set, get) => ({
  stack: [{ id: 'home' }],
  cursors: zeroCursors(),

  push: (id, params) => set(s => ({ stack: [...s.stack, { id, params }] })),

  pop: () =>
    set(s => ({ stack: s.stack.length > 1 ? s.stack.slice(0, -1) : s.stack })),

  reset: () => set({ stack: [{ id: 'home' }] }),

  current: () => {
    const { stack } = get();
    return stack[stack.length - 1];
  },

  getCursor: id => get().cursors[id] ?? 0,

  moveCursor: (id, itemCount, direction) =>
    set(s => {
      if (itemCount <= 0) return s;
      const cur = s.cursors[id] ?? 0;
      const next = Math.max(0, Math.min(itemCount - 1, cur + direction));
      return { cursors: { ...s.cursors, [id]: next } };
    }),

  setCursor: (id, index) => set(s => ({ cursors: { ...s.cursors, [id]: index } })),

  resetCursor: id => set(s => ({ cursors: { ...s.cursors, [id]: 0 } })),
}));
