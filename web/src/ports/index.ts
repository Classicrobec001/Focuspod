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
 * Browsers gate audio playback and the AudioContext behind a real user gesture,
 * so both are primed from the first interaction.
 *
 * The listener stays attached rather than firing once: iOS suspends the
 * AudioContext again after any audio interruption (an incoming call, the app
 * being backgrounded), and a one-shot unlock would leave the wheel silent for
 * the rest of the session. Re-priming is a no-op once everything is running.
 */
export function primeOnFirstGesture(): void {
  let claimedStorage = false;

  const prime = () => {
    // Both calls are guarded internally and become no-ops once satisfied.
    // webAudio.unlock() in particular must never disturb loaded audio — see the
    // comment there; an earlier version assigned a silent source to the live
    // player on every gesture, which stopped playback on any tap.
    webAudio.unlock();
    webHaptics.unlock();
    if (!claimedStorage) {
      claimedStorage = true;
      void requestPersistentStorage();
    }
  };

  // `capture` so priming happens before the wheel's own handlers run and the
  // first detent of a drag already has sound.
  //
  // `touchend` and `click` matter as much as `pointerdown`: Safari does not
  // count pointerdown as a user activation, so an iPhone would refuse every
  // prime attempted from it and the audio element would never unlock.
  for (const event of ['pointerdown', 'touchend', 'click', 'keydown'] as const) {
    window.addEventListener(event, prime, { capture: true });
  }

  // Coming back from the background is when iOS has suspended the AudioContext.
  // This is not a user gesture, so anything primed here must tolerate refusal.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') prime();
  });
}

export { webAudio, webDownloads, webFocusGuard, webHaptics, webStorage };
