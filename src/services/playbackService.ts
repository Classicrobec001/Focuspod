/**
 * PlaybackService — runs in a separate background task managed by
 * react-native-track-player. Handles remote control events
 * (lock screen, notification, headphone buttons).
 *
 * NOTE: RemoteDuck is intentionally NOT handled here.
 * setupPlayer sets autoHandleInterruptions: true, which means RNTP's internal
 * ExoPlayer wrapper already pauses/resumes on audio focus changes. Adding a
 * manual RemoteDuck listener on top causes double-handling: RNTP internally
 * acts first, then our listener fires again on the already-modified state,
 * which can call TrackPlayer.stop() on a permanent loss and tear down the
 * audio session — leaving the progress bar running but audio silent.
 */

import { DeviceEventEmitter } from 'react-native';
import TrackPlayer, { Event, State } from 'react-native-track-player';

export async function PlaybackService() {
  // ── Remote-control events (lock screen / notification / headphone buttons) ──
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) =>
    TrackPlayer.seekTo(position),
  );

  // ── Playback error logging ────────────────────────────────────────────────
  // "Progress bar moves, no sound" is the symptom of an audio renderer error
  // that ExoPlayer swallows internally — this makes it visible in Logcat.
  TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
    console.error('[PlaybackService] PlaybackError:', JSON.stringify(e));
  });

  // ── Audio focus recovery ──────────────────────────────────────────────────
  // FocusPodBlockingModule emits these events from its OnAudioFocusChangeListener.
  // autoHandleInterruptions:true already asks ExoPlayer to handle focus internally,
  // but on several OEM Android builds (Samsung, Xiaomi) that internal handler
  // silently fails to resume after a transient loss. These listeners are the
  // belt-and-suspenders layer that guarantees audio resumes.

  DeviceEventEmitter.addListener('FocusPodAudioFocusGained', async () => {
    try {
      const { state } = await TrackPlayer.getPlaybackState();
      console.log('[PlaybackService] FocusPodAudioFocusGained — current state:', state);
      if (state === State.Paused) {
        // Only resume if autoHandleInterruptions left us paused (not if the
        // user pressed pause themselves — but we have no way to distinguish,
        // so we resume here and let the user re-pause if needed).
        console.log('[PlaybackService] Resuming after focus gain');
        await TrackPlayer.play();
      }
    } catch (e) {
      console.warn('[PlaybackService] FocusPodAudioFocusGained handler error:', e);
    }
  });

  DeviceEventEmitter.addListener('FocusPodAudioFocusDucked', async () => {
    try {
      const { state } = await TrackPlayer.getPlaybackState();
      console.log('[PlaybackService] FocusPodAudioFocusDucked — current state:', state);
      // autoHandleInterruptions handles ducking; log only so we can see transient
      // focus losses in Logcat without taking additional action.
    } catch (e) {
      console.warn('[PlaybackService] FocusPodAudioFocusDucked handler error:', e);
    }
  });

  DeviceEventEmitter.addListener('FocusPodAudioFocusLost', async () => {
    console.log('[PlaybackService] FocusPodAudioFocusLost — permanent focus loss');
    // Permanent loss (phone call answered, another media app started).
    // autoHandleInterruptions will pause; we don't call stop() here because
    // that would tear down the audio session and make resumption impossible.
  });
}
