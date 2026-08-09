/**
 * Port registry — each platform calls `configureCore()` once at startup, before
 * any store is used. Stores read ports through the accessors below rather than
 * importing platform modules directly.
 */

import { AudioPort, DownloadPort, FocusGuardPort, HapticPort, StoragePort } from './index';

export interface CorePorts {
  audio: AudioPort;
  storage: StoragePort;
  downloads: DownloadPort;
  haptics: HapticPort;
  focusGuard: FocusGuardPort;
}

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
