import { create } from 'zustand';
import { AudioStatus, Book } from '../types';
import * as audioService from '../services/audioService';
import * as storageService from '../services/storageService';

interface PlaybackStoreState {
  currentBook: Book | null;
  currentChapterIndex: number;
  position: number; // seconds
  duration: number; // seconds
  status: AudioStatus;
  playbackRate: number;
  isPlayerReady: boolean;

  initPlayer: () => Promise<void>;
  loadBook: (book: Book, chapterIndex?: number) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  seekForward: (seconds: number) => Promise<void>;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;
  setRate: (rate: number) => Promise<void>;
  setStatus: (status: AudioStatus) => void;
  setPosition: (position: number) => void;
  setDuration: (duration: number) => void;
  setChapterIndex: (index: number) => void;
}

export const usePlaybackStore = create<PlaybackStoreState>((set, get) => ({
  currentBook: null,
  currentChapterIndex: 0,
  position: 0,
  duration: 0,
  status: 'idle',
  playbackRate: 1.0,
  isPlayerReady: false,

  initPlayer: async () => {
    await audioService.setupPlayer();
    const saved = await storageService.loadPlaybackState();
    set({ isPlayerReady: true });
    if (saved) {
      set({
        position: saved.position,
        status: 'paused',
      });
    }
  },

  loadBook: async (book: Book, chapterIndex = 0) => {
    set({ currentBook: book, currentChapterIndex: chapterIndex, status: 'loading' });
    await audioService.loadBook(book, chapterIndex);
    set({ status: 'paused' });
  },

  play: async () => {
    await audioService.play();
    set({ status: 'playing' });
  },

  pause: async () => {
    await audioService.pause();
    set({ status: 'paused' });
    const { currentBook, currentChapterIndex, position } = get();
    if (currentBook) {
      await storageService.savePlaybackState({
        bookId: currentBook.id,
        chapterId: currentBook.chapters[currentChapterIndex]?.id ?? null,
        position,
        status: 'paused',
      });
    }
  },

  stop: async () => {
    await audioService.stop();
    set({ status: 'idle', position: 0 });
  },

  seekTo: async (seconds: number) => {
    await audioService.seekTo(seconds);
    set({ position: seconds });
  },

  seekForward: async (seconds: number) => {
    // Always read the real position from TrackPlayer — the store's `position`
    // field is not kept in sync with ongoing playback, so it would give a
    // stale value (typically 0 or the last seeked position).
    const { position, duration } = await audioService.getProgress();
    const next = Math.max(0, Math.min(duration, position + seconds));
    console.log('[Playback] seekForward', seconds, 's: pos', position.toFixed(1), '→', next.toFixed(1), '/ dur', duration.toFixed(1));
    await audioService.seekTo(next);
    set({ position: next });
  },

  skipToNext: async () => {
    await audioService.skipToNext();
    const { currentChapterIndex, currentBook } = get();
    if (currentBook && currentChapterIndex < currentBook.chapters.length - 1) {
      set({ currentChapterIndex: currentChapterIndex + 1, position: 0 });
    }
  },

  skipToPrevious: async () => {
    await audioService.skipToPrevious();
    const { currentChapterIndex } = get();
    if (currentChapterIndex > 0) {
      set({ currentChapterIndex: currentChapterIndex - 1, position: 0 });
    }
  },

  setRate: async (rate: number) => {
    await audioService.setRate(rate);
    set({ playbackRate: rate });
  },

  setStatus: (status) => set({ status }),
  setPosition: (position) => set({ position }),
  setDuration: (duration) => set({ duration }),
  setChapterIndex: (index) => set({ currentChapterIndex: index }),
}));
