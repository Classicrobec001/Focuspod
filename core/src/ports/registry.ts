/**
 * Port registry — each platform calls `configureCore()` once at startup, before
 * any store is used. Stores read ports through the accessors below rather than
 * importing platform modules directly.
 */

import { AudioPort, AuthPort, DownloadPort, FocusGuardPort, HapticPort, StoragePort } from './index';

export interface CorePorts {
  audio: AudioPort;
  storage: StoragePort;
  downloads: DownloadPort;
  haptics: HapticPort;
  focusGuard: FocusGuardPort;
  /**
   * Optional. Left out — as mobile does, and as any build without an auth
   * provider does — accounts are simply unavailable and the UI hides itself.
   * Optional rather than required so adding it did not break every existing
   * `configureCore()` call site.
   */
  auth?: AuthPort;
}

/**
 * Stands in when no auth provider was configured. Every method is a no-op
 * rather than a throw: call sites should be able to ask without guarding, and
 * `available: false` is the one answer they need to branch on.
 */
const NO_AUTH: AuthPort = {
  available: false,
  currentAccount: async () => null,
  sendMagicLink: async () => {
    throw new Error('Accounts are not available in this build.');
  },
  signOut: async () => {},
  subscribe: () => () => {},
  pullState: async () => null,
  pushState: async () => {},
};

let ports: CorePorts | null = null;

export function configureCore(implementations: CorePorts): void {
  ports = implementations;
}

function require<K extends keyof CorePorts>(name: K): CorePorts[K] {
  if (!ports) {
    throw new Error(
      `@focuspod/core: configureCore() must be called before using the "${name}" port.`,
    );
  }
  return ports[name];
}

export const audio = (): AudioPort => require('audio');
export const storage = (): StoragePort => require('storage');
export const downloads = (): DownloadPort => require('downloads');
export const haptics = (): HapticPort => require('haptics');
export const focusGuard = (): FocusGuardPort => require('focusGuard');
export const auth = (): AuthPort => ports?.auth ?? NO_AUTH;
