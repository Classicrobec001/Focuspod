/**
 * webFocusGuard — FocusGuardPort for the browser.
 *
 * The mobile build enforces focus: an accessibility service detects a blocked
 * app coming to the foreground and pulls FocusPod back over it. Nothing in the
 * web platform can do that. A page cannot enumerate other applications, cannot
 * observe them, and cannot raise itself — by design, and no permission unlocks
 * it.
 *
 * So this port reports `soft-guard` and does the two things the platform *can*
 * do honestly:
 *
 *   • Wake Lock — hold the screen on so a session isn't broken by the display
 *     sleeping mid-chapter. Released automatically when the page hides, so it
 *     is re-acquired on return.
 *   • Page Visibility — notice when the user leaves and how long they stayed
 *     away, and record it against the session.
 *
 * That is accountability rather than enforcement, and the UI says so. Claiming
 * to block apps here would be a lie the browser cannot back up.
 */

import type { BlockableApp, FocusCapability, FocusGuardPort } from '@focuspod/core';

type DistractionListener = (event: { at: number; durationMs: number }) => void;

/** Ignore blips shorter than this — a notification shade or an accidental swipe. */
const MIN_AWAY_MS = 1500;

interface WakeLockSentinelLike {
  release(): Promise<void>;
  released: boolean;
}

export class WebFocusGuardPort implements FocusGuardPort {
  readonly capability: FocusCapability = 'soft-guard';

  private listeners = new Set<DistractionListener>();
  private active = false;
  private awaySince: number | null = null;
  private wakeLock: WakeLockSentinelLike | null = null;
  private keepAwake = true;
  private onVisibilityChange = () => void this.handleVisibilityChange();

  /** No enumerable apps on web — the picker step is hidden entirely. */
  async listBlockableApps(): Promise<BlockableApp[]> {
    return [];
  }

  /** Nothing to grant: soft guard needs no permission. */
  async hasPermission(): Promise<boolean> {
    return true;
  }

  async requestPermission(): Promise<void> {}

  setKeepAwake(enabled: boolean): void {
    this.keepAwake = enabled;
    if (!enabled) void this.releaseWakeLock();
    else if (this.active) void this.acquireWakeLock();
  }

  async start(_blockedApps: string[]): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.awaySince = null;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    await this.acquireWakeLock();
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    // Close out an in-flight distraction so a session ended while away still
    // records the time correctly.
    if (this.awaySince !== null) {
      this.emit({ at: this.awaySince, durationMs: Date.now() - this.awaySince });
      this.awaySince = null;
    }
    await this.releaseWakeLock();
  }

  onDistraction(listener: DistractionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: { at: number; durationMs: number }): void {
    this.listeners.forEach(l => l(event));
  }

  private async handleVisibilityChange(): Promise<void> {
    if (!this.active) return;

    if (document.visibilityState === 'hidden') {
      this.awaySince = Date.now();
      // durationMs 0 opens the distraction; the return event closes it.
      this.emit({ at: this.awaySince, durationMs: 0 });
      return;
    }

    // Back in view: the wake lock was dropped by the browser when we hid.
    await this.acquireWakeLock();

    if (this.awaySince === null) return;
    const durationMs = Date.now() - this.awaySince;
    const at = this.awaySince;
    this.awaySince = null;
    this.emit({ at, durationMs: durationMs < MIN_AWAY_MS ? 0 : durationMs });
  }

  private async acquireWakeLock(): Promise<void> {
    if (!this.keepAwake || !('wakeLock' in navigator)) return;
    if (this.wakeLock && !this.wakeLock.released) return;
    try {
      this.wakeLock = (await navigator.wakeLock.request('screen')) as WakeLockSentinelLike;
    } catch {
      // Denied when the document isn't visible, or unsupported. Non-fatal:
      // the session still runs, the screen just may sleep.
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      if (this.wakeLock && !this.wakeLock.released) await this.wakeLock.release();
    } catch {
      // Already released by the browser.
    }
    this.wakeLock = null;
  }
}

export const webFocusGuard = new WebFocusGuardPort();
