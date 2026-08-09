/**
 * webHaptics — HapticPort for the click wheel.
 *
 * The mobile build vibrates on every detent. On web that only works on Android
 * (`navigator.vibrate` does not exist in Safari and never has), so the wheel
 * would feel dead on iPhone — where an iPod replica is most likely to be used.
 *
 * The fix is to synthesise the click *sound* instead: a short filtered noise
 * burst through the Web Audio API, which is the same feedback the original
 * device gave. Vibration is layered on top wherever it exists.
 */

import type { HapticPort } from '@focuspod/core';

const TICK_GAIN = 0.09;
const TICK_MS = 12;

export class WebHapticPort implements HapticPort {
  private enabled = true;
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastTickAt = 0;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Create/resume the AudioContext from a user gesture. Browsers start every
   * context suspended, and a suspended context makes the first several ticks
   * silent. Call from the first pointerdown.
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    this.context = new Ctor();

    // Pre-render the click once. Generating noise per tick would allocate a
    // buffer on every detent, and the wheel fires these many times a second.
    const frames = Math.ceil((this.context.sampleRate * TICK_MS) / 1000);
    const buffer = this.context.createBuffer(1, frames, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // White noise under a steep exponential decay — a dry mechanical click
      // rather than a tone.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 3);
    }
    this.noise = buffer;
    return this.context;
  }

  tick(): void {
    if (!this.enabled) return;

    // The wheel can emit detents faster than a click can decay; dropping the
    // overlapping ones keeps it crisp instead of turning into a buzz.
    const now = performance.now();
    if (now - this.lastTickAt < TICK_MS * 1.5) return;
    this.lastTickAt = now;

    this.playClick(TICK_GAIN, 1);
    this.vibrate(8);
  }

  select(): void {
    if (!this.enabled) return;
    this.playClick(TICK_GAIN * 1.6, 0.7);
    this.vibrate(18);
  }

  private playClick(gainValue: number, rate: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noise || ctx.state !== 'running') return;

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = rate;

    // Band-pass around 2 kHz: removes the low thud and the hiss, leaving the
    // part of the spectrum that reads as a plastic click.
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.value = gainValue;

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  }

  private vibrate(ms: number): void {
    // Absent on iOS Safari and on desktop; the click above is the real feedback.
    navigator.vibrate?.(ms);
  }
}

export const webHaptics = new WebHapticPort();
