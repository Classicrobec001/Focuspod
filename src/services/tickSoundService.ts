/**
 * tickSoundService — plays the mechanical click sound on every wheel step.
 *
 * Calls TickSoundModule.play() which is fire-and-forget (no Promise) and
 * triggers a pre-loaded static AudioTrack on the native thread.  The round-
 * trip JS→native takes ~1-2 ms; the sound itself is ~18 ms.
 *
 * On iOS or when the native module is unavailable the call is a no-op.
 */

import { NativeModules, Platform } from 'react-native';

const { TickSound } = NativeModules;

export function playTick(): void {
  if (Platform.OS !== 'android' || !TickSound) return;
  try {
    TickSound.play();
  } catch {
    // Never throw — a failed tick must not interrupt wheel interaction.
  }
}
