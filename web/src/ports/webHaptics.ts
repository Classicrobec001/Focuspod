/**
 * webHaptics — the click wheel's feedback.
 *
 * The click is the point of the wheel: without it the gesture feels dead, and
 * the whole nostalgia of the device goes with it. It has to be audible on a
 * phone, not just on a laptop.
 *
 * Three platform problems shape this file.
 *
 * 1. `navigator.vibrate` does not exist in Safari and never has, so on iPhone
 *    the *sound* is the only feedback available. It cannot be an afterthought.
 *
 * 2. iOS routes Web Audio through the "ambient" audio session by default, which
 *    the hardware silent switch mutes — the single most common reason a PWA's
 *    Web Audio is inaudible on iPhone while working everywhere else. Safari
 *    16.4+ exposes `navigator.audioSession`; setting it to 'playback' opts into
 *    the media session that ignores the silent switch.
 *
 * 3. Browsers start every AudioContext suspended and iOS re-suspends it after
 *    interruptions (a call, backgrounding). A context that is merely created in
 *    a gesture is not enough — it has to be resumed, and resumed again later.
 *
 * The click itself is a short filtered noise burst: a real click wheel is a
 * piezo tick, broadband with a hard attack and almost no tail. A pure tone
 * sounds like a beep, and a long decay smears into a buzz when the wheel is
 * spun quickly.
 */

import type { HapticPort } from '@focuspod/core';

/** Peak gain of one detent click. Loud enough to hear over a phone speaker. */
const TICK_GAIN = 0.5;
/** Click length. Under ~8 ms reads as mechanical rather than tonal. */
const TICK_MS = 7;
/** Centre of the band that carries the "plastic" character of the click. */
const TICK_HZ = 3200;
/** Minimum gap between clicks, so a fast spin stays crisp instead of buzzing. */
const MIN_GAP_MS = 12;

interface AudioSessionCapable {
  audioSession?: { type: string };
}

export class WebHapticPort implements HapticPort {
  private enabled = true;
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastTickAt = 0;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Prepare audio output from inside a user gesture. Safe and cheap to call on
   * every interaction — and it should be, because iOS suspends the context
   * again after any audio interruption.
   */
  unlock(): void {
    this.claimPlaybackAudioSession();
    const ctx = this.ensureContext();
    if (ctx && ctx.state !== 'running') void ctx.resume();
  }

  /**
   * Opt out of the iOS "ambient" session, which the silent switch mutes.
   * Without this the wheel is completely silent on an iPhone with the ringer
   * off, which is how most phones are carried.
   */
  private claimPlaybackAudioSession(): void {
    const session = (navigator as Navigator & AudioSessionCapable).audioSession;
    if (session && session.type !== 'playback') {
      try {
        session.type = 'playback';
      } catch {
        // Older Safari exposes no setter; nothing else to try.
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    // 'interactive' asks for the smallest buffer the device will give us. A
    // click that lands 100 ms after the thumb moves reads as a glitch, not
    // feedback.
    this.context = new Ctor({ latencyHint: 'interactive' });

    // Pre-render the noise once. Generating it per click would allocate a
    // buffer on every detent, and the wheel fires these many times a second.
    const frames = Math.ceil((this.context.sampleRate * TICK_MS) / 1000);
    const buffer = this.context.createBuffer(1, frames, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      const t = i / frames;
      // Instant attack, steep exponential decay — the envelope of something
      // struck, not something played.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2);
    }
    this.noise = buffer;
    return this.context;
  }

  tick(): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastTickAt < MIN_GAP_MS) return;
    this.lastTickAt = now;

    this.playClick(TICK_GAIN, 1);
    this.vibrate(10);
  }

  select(): void {
    if (!this.enabled) return;
    // Lower and slightly slower: a button press, distinct from a detent.
    this.playClick(TICK_GAIN * 0.9, 0.75);
    this.vibrate(20);
  }

  private playClick(gainValue: number, rate: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noise) return;

    // A suspended context yields silence. Resume and drop this one click rather
    // than queueing a burst that would all fire at once on resume.
    if (ctx.state !== 'running') {
      void ctx.resume();
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = rate;

    // Band-pass keeps the part of the spectrum that reads as a click and drops
    // the low thud and the hiss either side of it.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = TICK_HZ;
    band.Q.value = 1.2;

    // Roll off everything below the click's body so it can be loud without
    // sounding boomy on a phone speaker.
    const cut = ctx.createBiquadFilter();
    cut.type = 'highpass';
    cut.frequency.value = 1200;

    const gain = ctx.createGain();
    gain.gain.value = gainValue;

    source.connect(band).connect(cut).connect(gain).connect(ctx.destination);
    source.start();
    // Let the node graph be collected once the click has finished.
    source.onended = () => source.disconnect();
  }

  private vibrate(ms: number): void {
    // Absent on iOS Safari and on desktop; the click above is the real feedback.
    navigator.vibrate?.(ms);
  }
}

export const webHaptics = new WebHapticPort();
