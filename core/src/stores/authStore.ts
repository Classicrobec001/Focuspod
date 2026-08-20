/**
 * authStore — who is signed in, and what that unlocks.
 *
 * Sign-in is passwordless: an address is given, a link is emailed, opening it
 * on the same device completes the session. That means the store has a state
 * most auth stores don't — `link-sent` — where the app is waiting on an email
 * client it cannot see. It is a real state and the UI has to show it, because
 * otherwise "nothing happened" is indistinguishable from "it failed".
 *
 * Everything here is a no-op when no auth provider was configured at build
 * time (`status: 'unavailable'`). Call sites don't need to guard.
 */

import { create } from 'zustand';
import { Account, AuthStatus } from '../types';
import { auth } from '../ports/registry';
import { Entitlements, entitlementsFor } from '../services/entitlements';

/** Cheap sanity check, not validation — the mail either arrives or it doesn't. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

interface AuthStoreState {
  account: Account | null;
  status: AuthStatus;
  /** Last failure, shown verbatim on the account screen. */
  error: string | null;
  /** The address a link was sent to, so the waiting screen can name it. */
  pendingEmail: string | null;

  init: () => Promise<void>;
  sendLink: (email: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  entitlements: () => Entitlements;
  isSignedIn: () => boolean;
}

/**
 * Set by the platform so a sign-in can trigger a sync without core stores
 * importing each other in a cycle. Optional: no listener, no sync.
 */
let onAccountChange: ((account: Account | null) => void) | null = null;
export function setAccountChangeHandler(handler: (account: Account | null) => void): void {
  onAccountChange = handler;
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  account: null,
  status: auth().available ? 'loading' : 'unavailable',
  error: null,
  pendingEmail: null,

  init: async () => {
    if (!auth().available) {
      set({ status: 'unavailable' });
      return;
    }
    // Subscribe before restoring: opening a magic link resolves the session
    // asynchronously, and the event can land before currentAccount() returns.
    auth().subscribe(account => {
      set({
        account,
        status: account ? 'signed-in' : 'signed-out',
        error: null,
        pendingEmail: account ? null : get().pendingEmail,
      });
      onAccountChange?.(account);
    });

    try {
      const account = await auth().currentAccount();
      set({ account, status: account ? 'signed-in' : 'signed-out' });
      if (account) onAccountChange?.(account);
    } catch (error) {
      console.warn('[Auth] session restore failed:', error);
      set({ status: 'signed-out' });
    }
  },

  /** Returns whether the link was accepted for delivery. */
  sendLink: async email => {
    const address = email.trim().toLowerCase();
    if (!looksLikeEmail(address)) {
      set({ error: "That doesn't look like an email address." });
      return false;
    }
    set({ error: null });
    try {
      await auth().sendMagicLink(address);
      set({ status: 'link-sent', pendingEmail: address });
      return true;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Could not send the link.',
        status: 'signed-out',
      });
      return false;
    }
  },

  signOut: async () => {
    try {
      await auth().signOut();
    } catch (error) {
      console.warn('[Auth] sign out failed:', error);
    }
    // Local data is deliberately kept. Signing out is not "delete my library" —
    // the favourites and streak on this device stay exactly where they are,
    // trimmed back to the free caps the next time they are written.
    set({ account: null, status: 'signed-out', pendingEmail: null });
    onAccountChange?.(null);
  },

  /**
   * A build with no auth provider has no gate: every limit is lifted rather
   * than permanently locked. Gating a feature behind a door that does not
   * exist would make a fork strictly worse than the deployed app for no reason.
   */
  entitlements: () =>
    entitlementsFor(get().status === 'unavailable' || get().account !== null),

  isSignedIn: () => get().account !== null,
}));

/** Whether accounts exist at all in this build — hides the UI when they don't. */
export const accountsAvailable = (): boolean => auth().available;
