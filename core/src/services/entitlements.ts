/**
 * entitlements — what an email address buys.
 *
 * The rule this file encodes: **nothing that makes FocusPod useful is ever
 * gated.** Every book, every podcast, every download, every focus session and
 * the streak itself stay free and work signed out, offline, forever. What an
 * account adds is continuity (the same library on your phone and your laptop),
 * depth (streak history that outlives a cleared cache) and decoration (the
 * rest of the themes).
 *
 * Stated plainly so it can't drift: a listener who never gives an email loses
 * no listening. If a future change makes that untrue, change this comment
 * first and see whether it still reads defensibly.
 */

export interface Entitlements {
  /** Books + shows that can be favourited. */
  maxFavorites: number;
  /** Individual chapters that can be favourited. */
  maxFavoriteChapters: number;
  /** Days of streak history retained locally before the oldest is dropped. */
  streakHistoryDays: number;
  /** Whether the locked themes are selectable. */
  allThemes: boolean;
  /** Whether state is mirrored to the account. */
  cloudSync: boolean;
}

/**
 * Signed out. The caps are set where a real listener will rarely meet them —
 * they exist to make the account worth having, not to make the app annoying.
 * Two weeks of history is enough to see a streak working; it is losing a
 * hundred-day streak to a browser cache clear that an account prevents.
 */
export const FREE: Entitlements = {
  maxFavorites: 20,
  maxFavoriteChapters: 20,
  streakHistoryDays: 14,
  allThemes: false,
  cloudSync: false,
};

export const SIGNED_IN: Entitlements = {
  maxFavorites: 300,
  maxFavoriteChapters: 300,
  streakHistoryDays: 400,
  allThemes: true,
  cloudSync: true,
};

export function entitlementsFor(signedIn: boolean): Entitlements {
  return signedIn ? SIGNED_IN : FREE;
}
