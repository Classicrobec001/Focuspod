/**
 * Wires the browser implementations into core. Must run before any store is
 * touched — main.tsx calls installWebPorts() before rendering.
 */

import { configureCore } from '@focuspod/core';
import { webAudio } from './webAudio';
import { webDownloads, requestPersistentStorage } from './webDownloads';
import { webFocusGuard } from './webFocusGuard';
import { webHaptics } from './webHaptics';
import { webStorage } from './webStorage';

export function installWebPorts(): void {
  configureCore({
    audio: webAudio,
    storage: webStorage,
    downloads: webDownloads,
    haptics: webHaptics,
    focusGuard: webFocusGuard,
  });
}

/**
 * Browsers gate audio playback and the AudioContext behind a real user
 * gesture. Priming both on the first pointerdown means the wheel clicks and the
 * first play() both work, instead of the first tap being silently swallowed.
 */
export function primeOnFirstGesture(): void {
  const prime = () => {
    webAudio.unlock();
    webHaptics.unlock();
    void requestPersistentStorage();
    window.removeEventListener('pointerdown', prime);
    window.removeEventListener('keydown', prime);
  };
  window.addEventListener('pointerdown', prime, { once: false });
  window.addEventListener('keydown', prime, { once: false });
}

export { webAudio, webDownloads, webFocusGuard, webHaptics, webStorage };
