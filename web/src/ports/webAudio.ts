/**
 * webAudio — AudioPort backed by a single HTMLAudioElement plus the Media
 * Session API for lock-screen / notification controls.
 *
 * Queue handling is ours, not the element's: the element holds exactly one
 * chapter at a time and we advance it on 'ended'. That keeps seeking simple and
 * lets us swap a chapter's source between the network and an offline copy
 * without rebuilding anything.
 *
 * Two browser constraints shape the design:
 *
 *  1. iOS will not start playback unless play() is reached from a user gesture.
 *     `unlock()` primes the element on the first touch so later programmatic
 *     play() calls — which happen after awaits — are permitted.
 *
 *  2. Offline chapters live in the Cache Storage API, which is not addressable
 *     by URL. resolveUrl() hands back a `focuspod-cache:` pseudo-URL that this
 *     module turns into a blob URL at the moment the chapter starts, holding at
 *     most one chapter in memory instead of a whole book.
 */

import type { AudioEvent, AudioPort, AudioTrack } from '@focuspod/core';
import { CACHE_URL_SCHEME, readCachedChapter } from './webDownloads';

type Listener = (event: AudioEvent) => void;

export class WebAudioPort implements AudioPort {
  private element: HTMLAudioElement | null = null;
  private queue: AudioTrack[] = [];
  private index = 0;
  private listeners = new Set<Listener>();
  private rate = 1;
  private unlocked = false;
  /** Object URL for the chapter currently loaded from the offline cache. */
  private objectUrl: string | null = null;

  async setup(): Promise<void> {
    this.ensureElement();
    this.bindMediaSession();
  }

  // ─── Element lifecycle ──────────────────────────────────────────────────

  private ensureElement(): HTMLAudioElement {
    if (this.element) return this.element;

    const el = new Audio();
    el.preload = 'auto';
    // Chapters are long; letting the browser keep the whole file lets it seek
    // without re-requesting ranges over a slow connection.
    el.autoplay = false;

    // A detached element plays, but browsers treat in-document media better for
    // background playback and audio routing (AirPlay, Bluetooth handoff), and it
    // makes the player inspectable in devtools.
    el.setAttribute('data-focuspod-player', '');
    el.style.display = 'none';
    document.body.appendChild(el);

    el.addEventListener('timeupdate', () => {
      this.emit({
        type: 'progress',
        position: el.currentTime,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
      });
      this.syncPositionState();
    });
    el.addEventListener('durationchange', () => this.syncPositionState());
    el.addEventListener('playing', () => this.emit({ type: 'status', status: 'playing' }));
    el.addEventListener('pause', () => {
      // A pause fired at the very end of a chapter is the transition to the
      // next one, not a user pause — 'ended' handles it.
      if (!el.ended) this.emit({ type: 'status', status: 'paused' });
    });
    el.addEventListener('waiting', () => this.emit({ type: 'status', status: 'buffering' }));
    el.addEventListener('ended', () => void this.handleEnded());
    el.addEventListener('error', () => {
      const code = el.error?.code;
      this.emit({
        type: 'error',
        message:
          code === MediaError.MEDIA_ERR_NETWORK
            ? 'Lost connection while streaming this chapter.'
            : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
              ? 'This chapter could not be played.'
              : 'Playback failed.',
      });
    });

    this.element = el;
    return el;
  }

  /**
   * Primes the audio element inside a user gesture. Safari refuses playback
   * that does not originate from one, and our play() calls happen after async
   * work, so the element has to be blessed up front. Call from the first
   * pointerdown; repeat calls are free.
   */
  unlock(): void {
    if (this.unlocked) return;
    const el = this.ensureElement();
    const previous = el.src;
    // A 1-sample silent wav — enough for Safari to mark the element as
    // user-activated without audibly clicking.
    el.src =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';
    el.play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
        if (previous) el.src = previous;
        else el.removeAttribute('src');
        this.unlocked = true;
      })
      .catch(() => {
        // Not in a gesture yet — the next touch will try again.
      });
  }

  // ─── Queue ──────────────────────────────────────────────────────────────

  async loadQueue(tracks: AudioTrack[], startIndex: number): Promise<void> {
    this.queue = tracks;
    this.index = Math.max(0, Math.min(tracks.length - 1, startIndex));
    await this.loadCurrent();
  }

  private async loadCurrent(): Promise<void> {
    const track = this.queue[this.index];
    if (!track) return;

    const el = this.ensureElement();
    this.emit({ type: 'status', status: 'loading' });

    this.releaseObjectUrl();
    let src = track.url;
    if (src.startsWith(CACHE_URL_SCHEME)) {
      const blob = await readCachedChapter(src);
      if (blob) {
        this.objectUrl = URL.createObjectURL(blob);
        src = this.objectUrl;
      } else {
        // The browser evicted this chapter — fall back to streaming.
        this.emit({ type: 'error', message: 'Offline copy missing; streaming instead.' });
        return;
      }
    }

    el.src = src;
    el.playbackRate = this.rate;
    el.load();
    this.updateMetadata(track);
  }

  private releaseObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private async handleEnded(): Promise<void> {
    if (this.index >= this.queue.length - 1) {
      this.emit({ type: 'status', status: 'completed' });
      return;
    }
    this.index += 1;
    await this.loadCurrent();
    this.emit({ type: 'track', index: this.index });
    await this.play();
  }

  // ─── Transport ──────────────────────────────────────────────────────────

  async play(): Promise<void> {
    const el = this.ensureElement();
    try {
      await el.play();
    } catch (error) {
      // NotAllowedError means we lost the gesture chain; surface it rather than
      // leaving the UI showing "playing" with silence.
      this.emit({
        type: 'error',
        message:
          (error as Error)?.name === 'NotAllowedError'
            ? 'Tap the centre button again to start playback.'
            : 'Playback could not start.',
      });
      throw error;
    }
  }

  async pause(): Promise<void> {
    this.ensureElement().pause();
  }

  async stop(): Promise<void> {
    const el = this.ensureElement();
    el.pause();
    el.currentTime = 0;
    this.releaseObjectUrl();
    this.emit({ type: 'status', status: 'idle' });
  }

  async seekTo(seconds: number): Promise<void> {
    const el = this.ensureElement();
    if (!Number.isFinite(el.duration)) return;
    el.currentTime = Math.max(0, Math.min(el.duration, seconds));
  }

  async skipToNext(): Promise<void> {
    if (this.index >= this.queue.length - 1) return;
    const wasPlaying = !this.ensureElement().paused;
    this.index += 1;
    await this.loadCurrent();
    if (wasPlaying) await this.play();
  }

  async skipToPrevious(): Promise<void> {
    if (this.index <= 0) {
      await this.seekTo(0);
      return;
    }
    const wasPlaying = !this.ensureElement().paused;
    this.index -= 1;
    await this.loadCurrent();
    if (wasPlaying) await this.play();
  }

  async setRate(rate: number): Promise<void> {
    this.rate = rate;
    this.ensureElement().playbackRate = rate;
  }

  async getProgress(): Promise<{ position: number; duration: number }> {
    const el = this.ensureElement();
    return {
      position: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AudioEvent): void {
    this.listeners.forEach(l => l(event));
  }

  // ─── Media Session (lock screen / notification controls) ────────────────

  private bindMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;

    ms.setActionHandler('play', () => void this.play());
    ms.setActionHandler('pause', () => void this.pause());
    ms.setActionHandler('previoustrack', () => void this.skipToPrevious());
    ms.setActionHandler('nexttrack', () => void this.skipToNext());
    ms.setActionHandler('seekbackward', details => {
      void this.seekTo(this.ensureElement().currentTime - (details.seekOffset ?? 15));
    });
    ms.setActionHandler('seekforward', details => {
      void this.seekTo(this.ensureElement().currentTime + (details.seekOffset ?? 30));
    });
    ms.setActionHandler('seekto', details => {
      if (details.seekTime != null) void this.seekTo(details.seekTime);
    });
  }

  private updateMetadata(track: AudioTrack): void {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artwork
        ? [{ src: track.artwork, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });
  }

  private syncPositionState(): void {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const el = this.ensureElement();
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: el.duration,
        playbackRate: el.playbackRate,
        position: Math.min(el.currentTime, el.duration),
      });
    } catch {
      // Some browsers throw on out-of-range values mid-seek; harmless.
    }
  }
}

export const webAudio = new WebAudioPort();
