import { create } from 'zustand';
import { AudioStatus, Book } from '../types';
import { audio, downloads } from '../ports/registry';
import { AudioTrack } from '../ports';
import { loadPlaybackState, savePlaybackState } from '../services/storage';

const SEEK_STEP_CLAMP = 30; // wheel rotation never jumps more than this per event

interface PlaybackStoreState {
  currentBook: Book | null;
  currentChapterIndex: number;
  position: number;
  duration: number;
  status: AudioStatus;
  playbackRate: number;
  isPlayerReady: boolean;
  /** Set when a saved position exists for the book currently being loaded. */
  resumePosition: number | null;

  initPlayer: () => Promise<void>;
  loadBook: (book: Book, chapterIndex?: number) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  stop: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  seekBy: (seconds: number) => Promise<void>;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;
  setRate: (rate: number) => Promise<void>;
  persistPosition: () => Promise<void>;
}

/** Resolve each chapter to a local file when downloaded, else the stream URL. */
async function buildQueue(book: Book): Promise<AudioTrack[]> {
  return Promise.all(
    book.chapters.map(async chapter => ({
      id: chapter.id,
      url: await downloads().resolveUrl(book.id, chapter.id, chapter.audioUrl),
      title: chapter.title,
      artist: book.author,
      album: book.title,
      artwork: book.coverUrl,
      duration: chapter.duration,
    })),
  );
}

export const usePlaybackStore = create<PlaybackStoreState>((set, get) => ({
  currentBook: null,
  currentChapterIndex: 0,
  position: 0,
  duration: 0,
  status: 'idle',
  playbackRate: 1.0,
  isPlayerReady: false,
  resumePosition: null,

  initPlayer: async () => {
    await audio().setup();

    // The engine is the source of truth for position and status — mirror its
    // events into the store rather than polling.
    audio().subscribe(event => {
      switch (event.type) {
        case 'status':
          set({ status: event.status });
          break;
        case 'progress':
          set({ position: event.position, duration: event.duration });
          break;
        case 'track':
          set({ currentChapterIndex: event.index, position: 0 });
          break;
        case 'error':
          console.warn('[Playback] engine error:', event.message);
          set({ status: 'error' });
          break;
      }
    });

    const saved = await loadPlaybackState();
    set({
      isPlayerReady: true,
      resumePosition: saved?.position ?? null,
    });
  },

  loadBook: async (book, chapterIndex = 0) => {
    if (book.chapters.length === 0) {
      set({ status: 'error' });
      console.warn('[Playback] loadBook called with an unhydrated book:', book.id);
      return;
    }

    set({
      currentBook: book,
      currentChapterIndex: chapterIndex,
      position: 0,
      duration: book.chapters[chapterIndex]?.duration ?? 0,
      status: 'loading',
    });

    const queue = await buildQueue(book);
    await audio().loadQueue(queue, chapterIndex);
    set({ status: 'paused' });

    // Resume where this book was left off, but only if it's the same book.
    const saved = await loadPlaybackState();
    if (saved?.bookId === book.id && saved.chapterIndex === chapterIndex && saved.position > 5) {
      await audio().seekTo(saved.position);
      set({ position: saved.position });
    }
  },

  play: async () => {
    // A focus session can run with no audiobook at all. Calling play() on an
    // engine with an empty queue rejects, so treat it as a no-op instead of
    // letting the rejection escape into the caller.
    if (!get().currentBook) return;
    await audio().play();
    set({ status: 'playing' });
  },

  pause: async () => {
    await audio().pause();
    set({ status: 'paused' });
    await get().persistPosition();
  },

  togglePlayPause: async () => {
    const { status } = get();
    if (status === 'playing') {
      await get().pause();
    } else if (get().currentBook) {
      await get().play();
    }
  },

  stop: async () => {
    await audio().stop();
    set({ status: 'idle', position: 0 });
  },

  seekTo: async seconds => {
    const { duration } = get();
    const target = Math.max(0, duration > 0 ? Math.min(duration, seconds) : seconds);
    await audio().seekTo(target);
    set({ position: target });
  },

  /**
   * Relative seek. Reads the live position from the engine rather than the
   * store, which can lag behind by up to one progress tick.
   */
  seekBy: async seconds => {
    const delta = Math.max(-SEEK_STEP_CLAMP, Math.min(SEEK_STEP_CLAMP, seconds));
    const { position, duration } = await audio().getProgress();
    const target = Math.max(0, duration > 0 ? Math.min(duration, position + delta) : position + delta);
    await audio().seekTo(target);
    set({ position: target });
  },

  skipToNext: async () => {
    const { currentBook, currentChapterIndex } = get();
    if (!currentBook || currentChapterIndex >= currentBook.chapters.length - 1) return;
    await audio().skipToNext();
    set({ currentChapterIndex: currentChapterIndex + 1, position: 0 });
  },

  skipToPrevious: async () => {
    const { currentChapterIndex } = get();
    if (currentChapterIndex <= 0) {
      await get().seekTo(0);
      return;
    }
    await audio().skipToPrevious();
    set({ currentChapterIndex: currentChapterIndex - 1, position: 0 });
  },

  setRate: async rate => {
    await audio().setRate(rate);
    set({ playbackRate: rate });
  },

  persistPosition: async () => {
    const { currentBook, currentChapterIndex, position, status } = get();
    if (!currentBook) return;
    await savePlaybackState({
      bookId: currentBook.id,
      chapterId: currentBook.chapters[currentChapterIndex]?.id ?? null,
      chapterIndex: currentChapterIndex,
      position,
      status,
    });
  },
}));
