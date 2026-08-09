/**
 * webStorage — StoragePort over localStorage.
 *
 * Everything routed through here is small and structural (preferences, session
 * history, the download index, catalog cache). Audio bytes go to Cache Storage
 * via webDownloads, so localStorage's ~5 MB ceiling is not a constraint.
 *
 * Every method is defensive: Safari throws on any localStorage access in
 * Private Browsing, and a thrown error during startup would take the whole app
 * down for a preference read.
 */

import type { StoragePort } from '@focuspod/core';

export class WebStoragePort implements StoragePort {
  private memory = new Map<string, string>();
  private available: boolean;

  constructor() {
    this.available = WebStoragePort.probe();
    if (!this.available) {
      console.warn('[Storage] localStorage unavailable — settings will not persist.');
    }
  }

  private static probe(): boolean {
    try {
      const key = '__focuspod_probe__';
      window.localStorage.setItem(key, '1');
      window.localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  async getItem(key: string): Promise<string | null> {
    if (!this.available) return this.memory.get(key) ?? null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    if (!this.available) {
      this.memory.set(key, value);
      return;
    }
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Quota exceeded: fall back to memory for this session rather than
      // throwing into a store action.
      console.warn('[Storage] setItem failed, falling back to memory:', error);
      this.memory.set(key, value);
    }
  }

  async removeItem(key: string): Promise<void> {
    this.memory.delete(key);
    if (!this.available) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing meaningful to do.
    }
  }
}

export const webStorage = new WebStoragePort();
