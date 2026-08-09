import { NativeModules } from 'react-native';
import TrackPlayer, {
  AndroidAudioContentType,
  AppKilledPlaybackBehavior,
  Capability,
} from 'react-native-track-player';
import { Book } from '../types';
import { chapterFileUri, isChapterDownloaded } from './downloadService';

const { FocusPodBlocking } = NativeModules;

let isSetup = false;
// Separate flag so setMusicVolumeToMax is never called a second time even if
// the module is somehow re-evaluated (hot reload in dev, etc.).  Calling it
// during active playback causes a brief audio interruption.
let isVolumeMaxed = false;

export async function setupPlayer(): Promise<void> {
  if (isSetup) {
    console.log('[Audio] setupPlayer: already set up, skipping');
    return;
  }
  console.log('[Audio] setupPlayer: starting...');
  await TrackPlayer.setupPlayer({
    autoHandleInterruptions: true,
    // Route through the music content type so ExoPlayer requests STREAM_MUSIC
    // audio focus and volume control (not the default generic content type).
    androidAudioContentType: AndroidAudioContentType.Music,
    // Buffer tuning for LibriVox MP3s (64–128 kbps, varying sample rates).
    // LibriVox streams from the Internet Archive CDN which can be slow or
    // bursty; emulators add additional network latency on top.
    //
    // Symptom being mitigated: audio crackling / distortion from buffer
    // underruns when the CDN is slow to deliver the next chunk.
    //
    // Strategy:
    //   • Raise minBuffer to 30 s so ExoPlayer refills earlier and has more
    //     headroom before the play-head catches the buffer edge.
    //   • Raise playBuffer to 5 s so audio never starts (or resumes after a
    //     seek/skip) before enough data has arrived to survive a momentary stall.
    //   • Keep maxBuffer at 60 s (slightly above the default 50 s) to allow
    //     longer look-ahead pre-buffering on good connections.
    //   • Keep backBuffer at 10 s for smooth seek-back.
    minBuffer: 15,   // refill when buffer falls below 15 s
    maxBuffer: 60,   // pre-buffer up to 60 s ahead
    backBuffer: 10,  // keep 10 s behind the play-head for smooth seek-back
    playBuffer: 1.5, // start/resume after 1.5 s buffered — fast first-audio
  });
  // RNTP player volume (0–1 internal gain). Already defaults to 1.0 but be explicit.
  await TrackPlayer.setVolume(1.0);
  console.log('[Audio] setupPlayer: player created, setting options...');
  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
    },
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.Stop,
    ],
    compactCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
    ],
  });
  isSetup = true;
  console.log('[Audio] setupPlayer: done');

  // Raise Android system STREAM_MUSIC to hardware maximum — done once, here,
  // after the player is fully initialised and not yet playing anything.
  // setStreamVolume(STREAM_MUSIC, ...) needs no special permission.
  // LibriVox recordings are typically -18 to -12 dBFS; maximising the stream
  // volume is the most effective amplification available from JS.
  // isVolumeMaxed prevents a second call if setupPlayer is somehow re-entered
  // (module re-eval during hot reload, etc.) which would interrupt active audio.
  if (!isVolumeMaxed) {
    isVolumeMaxed = true;
    try {
      const max: number = await FocusPodBlocking.setMusicVolumeToMax();
      console.log('[Audio] STREAM_MUSIC set to max step:', max);
    } catch (e: any) {
      console.warn('[Audio] setMusicVolumeToMax failed:', e?.message);
    }
  }
}

export async function loadBook(book: Book, chapterIndex = 0): Promise<void> {
  console.log('[Audio] loadBook:', book.title, '— chapters:', book.chapters.length, 'startIndex:', chapterIndex);
  await TrackPlayer.reset();

  // Resolve each chapter's URL: use the local downloaded file if it exists,
  // fall back to the LibriVox stream URL otherwise.
  const tracks = await Promise.all(
    book.chapters.map(async ch => {
      const downloaded = await isChapterDownloaded(book.id, ch.id);
      const url = downloaded ? chapterFileUri(book.id, ch.id) : ch.audioUrl;
      if (downloaded) {
        console.log(`[Audio] chapter "${ch.title}" → local file`);
      }
      return {
        id: ch.id,
        url,
        title: ch.title,
        artist: book.author,
        album: book.title,
        artwork: book.coverUrl,
        duration: ch.duration,
      };
    }),
  );

  console.log('[Audio] loadBook: adding', tracks.length, 'tracks, first url:', tracks[0]?.url ?? 'none');
  await TrackPlayer.add(tracks);
  if (chapterIndex > 0) {
    await TrackPlayer.skip(chapterIndex);
  }
  console.log('[Audio] loadBook: done');
}

export async function play(): Promise<void> {
  // NOTE: Do NOT call FocusPodBlocking.requestAudioFocus() here.
  //
  // On Android O+ (API 26), every AudioFocusRequest is associated with a
  // listener.  When ExoPlayer (via RNTP) calls requestAudioFocus() with its
  // own request, Android delivers AUDIOFOCUS_LOSS to any previously registered
  // listener in the same UID — including ours.  That displaces our listener
  // permanently: it stops receiving future GAIN/LOSS events, so our JS-side
  // FocusPodAudioFocusGained recovery handler never fires.  The result is the
  // "progress bar moves, no sound" symptom after any transient interruption.
  //
  // ExoPlayer already manages audio focus correctly via autoHandleInterruptions.
  // OEM-specific recovery is handled via Event.RemoteDuck in playbackService.ts.
  console.log('[Audio] play: calling TrackPlayer.play()...');
  try {
    const queue = await TrackPlayer.getQueue();
    const active = await TrackPlayer.getActiveTrack();
    console.log('[Audio] play: queue length:', queue.length, '— active track:', active?.title ?? 'none', 'url:', active?.url ?? 'none');
    await TrackPlayer.play();
    console.log('[Audio] play: TrackPlayer.play() resolved');
  } catch (e: any) {
    console.error('[Audio] play: ERROR', e?.message, e);
    throw e;
  }
}

export async function pause(): Promise<void> {
  console.log('[Audio] pause: calling TrackPlayer.pause()...');
  await TrackPlayer.pause();
  console.log('[Audio] pause: done');
}

export async function stop(): Promise<void> {
  await TrackPlayer.stop();
  // Audio focus is owned by ExoPlayer (via RNTP), not by us directly.
  // ExoPlayer abandons focus when it stops; we don't need to call
  // FocusPodBlocking.abandonAudioFocus() here.
}

export async function getProgress(): Promise<{ position: number; duration: number }> {
  const p = await TrackPlayer.getProgress();
  return { position: p.position, duration: p.duration };
}

export async function seekTo(seconds: number): Promise<void> {
  console.log('[Audio] seekTo:', seconds.toFixed(2), 's');
  await TrackPlayer.seekTo(seconds);
}

export async function skipToNext(): Promise<void> {
  try {
    await TrackPlayer.skipToNext();
  } catch {
    // already at last track
  }
}

export async function skipToPrevious(): Promise<void> {
  try {
    await TrackPlayer.skipToPrevious();
  } catch {
    // already at first track
  }
}

export async function setRate(rate: number): Promise<void> {
  await TrackPlayer.setRate(rate);
}
