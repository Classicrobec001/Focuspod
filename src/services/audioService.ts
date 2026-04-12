import { NativeModules } from 'react-native';
import TrackPlayer, {
  AndroidAudioContentType,
  AppKilledPlaybackBehavior,
  Capability,
} from 'react-native-track-player';
import { Book } from '../types';

const { FocusPodBlocking } = NativeModules;

let isSetup = false;

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
    // Reduce initial buffer requirement so playback starts sooner.
    // ExoPlayer defaults: minBuffer=15s, playBuffer=2.5s.
    minBuffer: 10,
    maxBuffer: 30,
    backBuffer: 5,
    playBuffer: 1.5,
  });
  // RNTP player volume (0–1 internal gain). Already defaults to 1.0 but be explicit.
  await TrackPlayer.setVolume(1.0);
  // Raise the Android system STREAM_MUSIC to hardware maximum.
  // setStreamVolume(STREAM_MUSIC, ...) needs no special permission.
  // LibriVox recordings are typically captured at -18 to -12 dBFS so getting
  // the system stream to max is the most effective amplification we can do.
  try {
    const max: number = await FocusPodBlocking.setMusicVolumeToMax();
    console.log('[Audio] STREAM_MUSIC set to max step:', max);
  } catch (e: any) {
    console.warn('[Audio] setMusicVolumeToMax failed:', e?.message);
  }
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
  console.log('[Audio] setupPlayer: done, isSetup=true');
}

export async function loadBook(book: Book, chapterIndex = 0): Promise<void> {
  console.log('[Audio] loadBook:', book.title, '— chapters:', book.chapters.length, 'startIndex:', chapterIndex);
  await TrackPlayer.reset();
  const tracks = book.chapters.map(ch => ({
    id: ch.id,
    url: ch.audioUrl,
    title: ch.title,
    artist: book.author,
    album: book.title,
    artwork: book.coverUrl,
    duration: ch.duration,
  }));
  console.log('[Audio] loadBook: adding', tracks.length, 'tracks, first url:', tracks[0]?.url ?? 'none');
  await TrackPlayer.add(tracks);
  if (chapterIndex > 0) {
    await TrackPlayer.skip(chapterIndex);
  }
  console.log('[Audio] loadBook: done');
}

export async function play(): Promise<void> {
  console.log('[Audio] play: requesting audio focus...');
  // Request audio focus explicitly before handing off to ExoPlayer.
  // ExoPlayer also requests focus internally on play(), but having our own
  // request first ensures the OnAudioFocusChangeListener is registered and
  // every focus event (LOSS, LOSS_TRANSIENT, GAIN) appears in Logcat under
  // the [AudioFocus] tag so interruptions are visible during debugging.
  try {
    const granted: boolean = await FocusPodBlocking.requestAudioFocus();
    console.log('[Audio] play: audio focus granted:', granted);
  } catch (e: any) {
    console.warn('[Audio] play: requestAudioFocus failed (non-fatal):', e?.message);
  }

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
  // Abandon focus when the user explicitly stops playback so other apps
  // (Spotify, phone, etc.) can reclaim it cleanly.
  try {
    await FocusPodBlocking.abandonAudioFocus();
  } catch {
    // non-fatal
  }
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
