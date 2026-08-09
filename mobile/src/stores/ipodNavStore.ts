/**
 * ipodNavStore — custom stack-based navigation that drives IpodDevice.
 *
 * Replaces React Navigation for the iPod UI. Every screen is a lightweight
 * ScreenId string; params are an optional plain-object payload. Cursor
 * positions per screen survive push/pop so rotating back into a list lands
 * where the user left off.
 */

import { create } from 'zustand';

export type ScreenId =
  | 'home'
  | 'audiobooks'
  | 'downloads'
  | 'book-detail'
  | 'now-playing'
  | 'focus'
  | 'settings'
  | 'search';

export interface StackEntry {
  id: ScreenId;
  params?: Record<string, unknown>;
}

interface IpodNavState {
  stack: StackEntry[];
  /** Per-screen cursor (selected row index). Survives push/pop. */
  cursors: Record<ScreenId, number>;

  push: (id: ScreenId, params?: Record<string, unknown>) => void;
  pop: () => void;
  /** The top-of-stack entry. */
  current: () => StackEntry;
  getCursor: (id: ScreenId) => number;
  /** Move cursor by +1 / -1, clamped to [0, itemCount-1]. */
  moveCursor: (id: ScreenId, itemCount: number, direction: 1 | -1) => void;
  setCursor: (id: ScreenId, index: number) => void;
  resetCursor: (id: ScreenId) => void;
}

const ALL_SCREENS: ScreenId[] = [
  'home', 'audiobooks', 'downloads', 'book-detail', 'now-playing', 'focus', 'settings', 'search',
];

export const useIpodNavStore = create<IpodNavState>((set, get) => ({
  stack: [{ id: 'home' }],
  cursors: Object.fromEntries(ALL_SCREENS.map(id => [id, 0])) as Record<ScreenId, number>,

  push: (id, params) =>
    set(s => ({ stack: [...s.stack, { id, params }] })),

  pop: () =>
    set(s => ({
      stack: s.stack.length > 1 ? s.stack.slice(0, -1) : s.stack,
    })),

  current: () => {
    const { stack } = get();
    return stack[stack.length - 1];
  },

  getCursor: (id) => get().cursors[id] ?? 0,

  moveCursor: (id, itemCount, direction) =>
    set(s => {
      const cur = s.cursors[id] ?? 0;
      const next = Math.max(0, Math.min(itemCount - 1, cur + direction));
      return { cursors: { ...s.cursors, [id]: next } };
    }),

  setCursor: (id, index) =>
    set(s => ({ cursors: { ...s.cursors, [id]: index } })),

  resetCursor: (id) =>
    set(s => ({ cursors: { ...s.cursors, [id]: 0 } })),
}));
