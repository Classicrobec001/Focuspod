/**
 * PlaybackService — runs in a separate background task managed by
 * react-native-track-player. Handles remote control events
 * (lock screen, notification, headphone buttons) and audio focus recovery.
 *
 * Audio focus design
 * ──────────────────
 * ExoPlayer (via RNTP) owns the AudioFocusRequest.  We do NOT call
 * FocusPodBlocking.requestAudioFocus() before play() — doing so registers a
 * competing listener in the same UID, and when ExoPlayer requests focus Android
 * delivers AUDIOFOCUS_LOSS to our listener, permanently killing it.  That was
 * the root cause of the "progress bar moves, no sound" bug.
 *
 * Instead we hook Event.RemoteDuck, which fires directly from ExoPlayer's own
 * AudioFocusRequest listener and is therefore always live.
 *
 * autoHandleInterruptions:true asks ExoPlayer to pause/resume automatically, but
 * several OEM Android builds (Samsung, Xiaomi) fail to re-open the AudioTrack
 * after a transient focus loss.  The RemoteDuck handler below is the
 * belt-and-suspenders layer that guarantees audio resumes on those devices.
 */

import TrackPlayer, { Event, State } from 'react-native-track-player';

// Tracks whether the current pause/stop was deliberately triggered by the user
// (via a remote-control event or JS call), so the auto-recovery listener can
// distinguish ExoPlayer stalls from intentional pauses.
let userInitiatedStop = false;

export async function PlaybackService() {
  // ── Remote-control events (lock screen / notification / headphone buttons) ──
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    userInitiatedStop = false;
    return TrackPlayer.play();
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    userInitiatedStop = true;
    return TrackPlayer.pause();
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    userInitiatedStop = true;
    return TrackPlayer.stop();
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) =>
    TrackPlayer.seekTo(position),
  );

  // ── Playback error logging ────────────────────────────────────────────────
  TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
    console.error('[PlaybackService] PlaybackError:', JSON.stringify(e));
  });

  // ── Auto-recovery from unexpected Stopped state ──────────────────────────
  // ExoPlayer on some OEM Android builds (Samsung, Xiaomi) spontaneously stops
  // the audio track mid-playback, surfacing as State.Stopped without any user
  // interaction.  When that happens and we weren't intending to stop, restart.
  TrackPlayer.addEventListener(Event.PlaybackState, async ({ state }) => {
    if (state === State.Playing || state === State.Buffering) {
      userInitiatedStop = false;
    } else if (state === State.Paused) {
      userInitiatedStop = true; // UI pause is intentional
    } else if (state === State.Stopped && !userInitiatedStop) {
      console.log('[PlaybackService] Unexpected Stopped — attempting auto-recovery');
      try {
        const queue = await TrackPlayer.getQueue();
        if (queue.length > 0) {
          await new Promise<void>(r => setTimeout(r, 600));
          await TrackPlayer.play();
          console.log('[PlaybackService] Auto-recovery play() succeeded');
        }
      } catch (e) {
        console.warn('[PlaybackService] Auto-recovery play() failed:', e);
      }
    }
  });

  // ── Audio focus recovery (OEM belt-and-suspenders) ───────────────────────
  // Event.RemoteDuck fires from ExoPlayer's own AudioFocusRequest listener.
  //   paused: true  → focus lost (transient or permanent); ExoPlayer already
  //                   paused via autoHandleInterruptions.
  //   paused: false → focus regained; autoHandleInterruptions should resume,
  //                   but on Samsung/Xiaomi it sometimes fails to re-open the
  //                   AudioTrack, leaving position advancing with no sound.
  //                   Calling play() here guarantees resumption.
  TrackPlayer.addEventListener(Event.RemoteDuck, async ({ paused, permanent }) => {
    console.log(`[PlaybackService] RemoteDuck paused=${paused} permanent=${permanent}`);
    if (!paused) {
      // Focus regained after a transient interruption.
      try {
        const { state } = await TrackPlayer.getPlaybackState();
        console.log('[PlaybackService] RemoteDuck gain — state:', state);
        if (state === State.Paused) {
          // autoHandleInterruptions left us paused but didn't resume.
          // Drive play() manually so audio actually restarts on OEM builds.
          await TrackPlayer.play();
        }
      } catch (e) {
        console.warn('[PlaybackService] RemoteDuck gain handler error:', e);
      }
    }
    // paused:true / permanent:true (phone call etc.) — autoHandleInterruptions
    // already paused; we do NOT call stop() because that tears down the audio
    // session and makes resumption impossible.
  });
}
