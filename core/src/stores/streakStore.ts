/**
 * streakStore — consecutive days with real listening behind them.
 *
 * What counts is time actually spent listening, not sessions started or books
 * opened: ten minutes of audio in a local calendar day. Ten is low enough that
 * a commute or a washing-up clears it, and high enough that pressing play and
 * walking away doesn't.
 *
 * Time is measured from the wall clock between progress events, not by summing
 * the audio positions those events report. Positions jump when the listener
 * seeks — scrubbing forward through an hour would otherwise "earn" an hour —
 * and they run fast at 2× speed. Each increment is clamped, so a tab that was
 * suspended for twenty minutes contributes at most one tick on its return.
 *
 * A day is a *local* date. See the note on StreakDays in types.ts for why.
 */

import { create } from 'zustand';
import { StreakDays, StreakState } from '../types';
import { loadStreak, saveStreak } from '../services/storage';

/** Seconds of listening that make a day count. */
export const DAILY_GOAL_SECONDS = 600;

/** Day counts worth marking. Kept short — a badge every week stops meaning anything. */
export const MILESTONES = [3, 7, 14, 30, 60, 100, 365];

/** Largest gap a single increment may credit, however long the tab was frozen. */
const MAX_INCREMENT_SECONDS = 5;

/** Writes are batched: persisting on every progress event would thrash storage. */
const SAVE_INTERVAL_SECONDS = 30;

/** `YYYY-MM-DD` in the listener's own timezone. */
export function dayKey(at: number = Date.now()): string {
  const d = new Date(at);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  // Local-midnight construction, so DST shifts can't move the date.
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dayKey(date.getTime());
}

const qualifies = (days: StreakDays, key: string) => (days[key] ?? 0) >= DAILY_GOAL_SECONDS;

/**
 * Length of the run ending today.
 *
 * Today not qualifying does *not* break the streak — the day isn't over. The
 * run is measured from yesterday in that case, and only becomes zero once a
 * whole day has passed with nothing in it.
 */
export function computeStreak(days: StreakDays, today: string = dayKey()): number {
  let cursor = qualifies(days, today) ? today : shiftDay(today, -1);
  if (!qualifies(days, cursor)) return 0;

  let count = 0;
  while (qualifies(days, cursor)) {
    count += 1;
    cursor = shiftDay(cursor, -1);
  }
  return count;
}

export function longestStreak(days: StreakDays): number {
  const keys = Object.keys(days)
    .filter(k => qualifies(days, k))
    .sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of keys) {
    run = previous !== null && shiftDay(previous, 1) === key ? run + 1 : 1;
    previous = key;
    if (run > best) best = run;
  }
  return best;
}

/** The last `count` days, oldest first — what the little bar chart draws. */
export function recentDays(days: StreakDays, count: number): Array<{ key: string; seconds: number }> {
  const out: Array<{ key: string; seconds: number }> = [];
  let cursor = dayKey();
  for (let i = 0; i < count; i += 1) {
    out.unshift({ key: cursor, seconds: days[cursor] ?? 0 });
    cursor = shiftDay(cursor, -1);
  }
  return out;
}

/** Drops days older than the retention window, newest kept. */
function prune(days: StreakDays, keepDays: number): StreakDays {
  const cutoff = shiftDay(dayKey(), -keepDays);
  const out: StreakDays = {};
  for (const [key, seconds] of Object.entries(days)) {
    if (key >= cutoff) out[key] = seconds;
  }
  return out;
}

interface StreakStoreState extends StreakState {
  isLoaded: boolean;
  /** Set when a milestone is first reached, so the UI can announce it once. */
  earned: number | null;
  /** Wall-clock ms of the last credited tick; null when not listening. */
  lastTickAt: number | null;
  /** Seconds credited since the last write, for batching. */
  unsavedSeconds: number;

  load: () => Promise<void>;
  /**
   * Credit elapsed listening. Called from the playback engine's progress
   * events; works out the increment itself from the wall clock.
   */
  tick: (retentionDays: number) => void;
  /** Stop crediting — pause, stop, or leaving the app. */
  suspend: () => Promise<void>;
  clearEarned: () => void;
  /** Replace everything, taking the larger value per day. Used by sync. */
  mergeDays: (incoming: StreakDays, retentionDays: number) => Promise<void>;
  todaySeconds: () => number;
}

const EMPTY: StreakState = { days: {}, current: 0, longest: 0, celebrated: [] };

export const useStreakStore = create<StreakStoreState>((set, get) => ({
  ...EMPTY,
  isLoaded: false,
  earned: null,
  lastTickAt: null,
  unsavedSeconds: 0,

  load: async () => {
    const saved = (await loadStreak()) ?? EMPTY;
    const days = saved.days ?? {};
    set({
      days,
      // Recomputed rather than trusted: the stored numbers were correct when
      // written, and a streak silently expires just by time passing.
      current: computeStreak(days),
      longest: Math.max(saved.longest ?? 0, longestStreak(days)),
      celebrated: saved.celebrated ?? [],
      isLoaded: true,
    });
  },

  tick: retentionDays => {
    const now = Date.now();
    const { lastTickAt } = get();
    set({ lastTickAt: now });
    if (lastTickAt === null) return; // first tick only establishes the baseline

    const elapsed = Math.min((now - lastTickAt) / 1000, MAX_INCREMENT_SECONDS);
    if (elapsed <= 0) return;

    const key = dayKey(now);
    const state = get();
    const days = { ...state.days, [key]: (state.days[key] ?? 0) + elapsed };
    const current = computeStreak(days, key);

    // Only fire a milestone the first time it is reached, and remember that it
    // fired — otherwise it reappears on every tick for the rest of the day.
    const milestone = MILESTONES.includes(current) && !state.celebrated.includes(current)
      ? current
      : null;

    set({
      days,
      current,
      longest: Math.max(state.longest, current),
      celebrated: milestone ? [...state.celebrated, milestone] : state.celebrated,
      earned: milestone ?? state.earned,
      unsavedSeconds: state.unsavedSeconds + elapsed,
    });

    if (get().unsavedSeconds >= SAVE_INTERVAL_SECONDS || milestone) {
      void persist(get, set, retentionDays);
    }
  },

  suspend: async () => {
    set({ lastTickAt: null });
    if (get().unsavedSeconds > 0) await persist(get, set, Number.MAX_SAFE_INTEGER);
  },

  clearEarned: () => set({ earned: null }),

  mergeDays: async (incoming, retentionDays) => {
    const merged: StreakDays = { ...get().days };
    for (const [key, seconds] of Object.entries(incoming ?? {})) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) continue;
      // Larger wins: two devices both listened that day and neither total is
      // wrong, but adding them would double-count time spent on both at once.
      merged[key] = Math.max(merged[key] ?? 0, seconds);
    }
    const days = prune(merged, retentionDays);
    set({ days, current: computeStreak(days), longest: longestStreak(days) });
    await saveStreak({
      days,
      current: get().current,
      longest: get().longest,
      celebrated: get().celebrated,
    });
  },

  todaySeconds: () => get().days[dayKey()] ?? 0,
}));

type Get = () => StreakStoreState;
type Set = (partial: Partial<StreakStoreState>) => void;

async function persist(get: Get, set: Set, retentionDays: number): Promise<void> {
  const state = get();
  const days = prune(state.days, retentionDays);
  set({ days, unsavedSeconds: 0 });
  await saveStreak({
    days,
    current: state.current,
    longest: state.longest,
    celebrated: state.celebrated,
  });
}
