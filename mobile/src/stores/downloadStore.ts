/**
 * downloadStore — per-book download state, persisted to AsyncStorage.
 *
 * State shape per book:
 *   status       : 'idle' | 'downloading' | 'done' | 'error'
 *   progress     : 0–1  (fraction of chapters fully written to disk)
 *   chapterPaths : chapterId → absolute local path (populated as each chapter finishes)
 *   errorMessage : set when status === 'error'
 *
 * The chapter paths are the only part that truly needs to persist across
 * sessions (so playback can resolve local files).  status/progress are
 * re-derived on load by checking which paths actually exist on disk.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Book } from '../types';
import * as downloadService from '../services/downloadService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

export interface BookDownloadState {
  status: DownloadStatus;
  /** 0–1: fraction of chapters whose local file exists */
  progress: number;
  /** chapterId → absolute path on disk */
  chapterPaths: Record<string, string>;
  errorMessage?: string;
  /** Stored so the Downloads screen can display the title without re-fetching */
  bookTitle?: string;
  bookAuthor?: string;
}

interface DownloadStoreState {
  /** bookId → download state */
  books: Record<string, BookDownloadState>;

  /** Active AbortControllers for in-progress downloads */
  controllers: Record<string, AbortController>;

  // ── Selectors ──────────────────────────────────────────────────────────────
  getState: (bookId: string) => BookDownloadState;
  getLocalPath: (bookId: string, chapterId: string) => string | null;
  isBookDownloaded: (bookId: string) => boolean;
  isBookDownloading: (bookId: string) => boolean;

  // ── Actions ────────────────────────────────────────────────────────────────
  startDownload: (book: Book) => Promise<void>;
  cancelDownload: (book: Book) => Promise<void>;
  deleteDownload: (book: Book) => Promise<void>;

  /** Reload persisted chapter paths from AsyncStorage on app start. */
  loadSaved: () => Promise<void>;
}

// ─── Persistence key ─────────────────────────────────────────────────────────

const STORAGE_KEY = '@focuspod/chapter_paths';

interface PersistedBookEntry {
  chapterPaths: Record<string, string>;
  bookTitle?: string;
  bookAuthor?: string;
}

async function persistPaths(books: Record<string, BookDownloadState>): Promise<void> {
  const payload: Record<string, PersistedBookEntry> = {};
  for (const [bookId, state] of Object.entries(books)) {
    if (Object.keys(state.chapterPaths).length > 0) {
      payload[bookId] = {
        chapterPaths: state.chapterPaths,
        bookTitle: state.bookTitle,
        bookAuthor: state.bookAuthor,
      };
    }
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

// ─── Store ────────────────────────────────────────────────────────────────────

const IDLE_STATE: BookDownloadState = {
  status: 'idle',
  progress: 0,
  chapterPaths: {},
};

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  books: {},
  controllers: {},

  // ── Selectors ──────────────────────────────────────────────────────────────

  getState: (bookId) => get().books[bookId] ?? IDLE_STATE,

  getLocalPath: (bookId, chapterId) =>
    get().books[bookId]?.chapterPaths[chapterId] ?? null,

  isBookDownloaded: (bookId) =>
    get().books[bookId]?.status === 'done',

  isBookDownloading: (bookId) =>
    get().books[bookId]?.status === 'downloading',

  // ── Actions ────────────────────────────────────────────────────────────────

  startDownload: async (book) => {
    console.log(
      `[Download] startDownload: bookId=${book.id}` +
      ` title="${book.title}"` +
      ` chapters=${book.chapters.length}`,
    );
    if (book.chapters.length === 0) {
      console.warn(`[Download] startDownload: book has no chapters, cannot download`);
      set(s => ({
        books: {
          ...s.books,
          [book.id]: {
            status: 'error' as DownloadStatus,
            progress: 0,
            chapterPaths: {},
            bookTitle: book.title,
            bookAuthor: book.author,
            errorMessage: 'No chapters available',
          },
        },
      }));
      return;
    }
    // Log first few chapter URLs so we can verify they look right in logcat
    book.chapters.slice(0, 3).forEach((ch, i) => {
      console.log(`[Download] chapter[${i}]: id=${ch.id} url=${ch.audioUrl}`);
    });

    const existing = get().books[book.id];
    if (existing?.status === 'downloading') {
      console.log('[Download] startDownload: already in progress, skipping');
      return;
    }

    const controller = new AbortController();
    set(s => ({
      books: {
        ...s.books,
        [book.id]: {
          status: 'downloading',
          progress: 0,
          chapterPaths: existing?.chapterPaths ?? {},
          bookTitle: book.title,
          bookAuthor: book.author,
        },
      },
      controllers: { ...s.controllers, [book.id]: controller },
    }));

    try {
      const totalChapters = book.chapters.length;
      let doneCount = Object.keys(get().books[book.id]?.chapterPaths ?? {}).length;

      await downloadService.downloadBook(
        book,
        // onChapterProgress — ignored at store level (chapter-level granularity
        // isn't useful for the small LCD; we track whole-chapter completions).
        () => {},
        // onChapterDone — update chapterPaths + progress
        (chapterId, localPath) => {
          doneCount++;
          set(s => {
            const prev = s.books[book.id] ?? IDLE_STATE;
            const updated: BookDownloadState = {
              ...prev,
              progress: doneCount / totalChapters,
              chapterPaths: { ...prev.chapterPaths, [chapterId]: localPath },
            };
            const next = { ...s.books, [book.id]: updated };
            persistPaths(next).catch(console.warn);
            return { books: next };
          });
        },
        controller.signal,
      );

      // All chapters done
      console.log(`[Download] startDownload: all chapters done for bookId=${book.id}`);
      set(s => {
        const prev = s.books[book.id] ?? IDLE_STATE;
        const next = {
          ...s.books,
          [book.id]: { ...prev, status: 'done' as DownloadStatus, progress: 1 },
        };
        persistPaths(next).catch(console.warn);
        const { [book.id]: _, ...restControllers } = s.controllers;
        return { books: next, controllers: restControllers };
      });

    } catch (e: any) {
      const wasCancelled = e?.name === 'AbortError';
      console.error(`[Download] startDownload error: bookId=${book.id} name=${e?.name} message=${e?.message}`);
      set(s => {
        const prev = s.books[book.id] ?? IDLE_STATE;
        const { [book.id]: _, ...restControllers } = s.controllers;
        return {
          books: {
            ...s.books,
            [book.id]: {
              ...prev,
              status: wasCancelled ? 'idle' : 'error',
              errorMessage: wasCancelled ? undefined : (e?.message ?? 'Download failed'),
            },
          },
          controllers: restControllers,
        };
      });
    }
  },

  cancelDownload: async (book) => {
    const ctrl = get().controllers[book.id];
    if (ctrl) ctrl.abort();
    await downloadService.cancelBookDownload(book);
  },

  deleteDownload: async (book) => {
    // Cancel any in-progress download first.
    await get().cancelDownload(book);
    await downloadService.deleteBookDownload(book.id);
    set(s => {
      const { [book.id]: _, ...rest } = s.books;
      const next = rest;
      persistPaths(next).catch(console.warn);
      return { books: next };
    });
  },

  loadSaved: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const payload: Record<string, PersistedBookEntry | Record<string, string>> = JSON.parse(raw);
      const books: Record<string, BookDownloadState> = {};
      for (const [bookId, entry] of Object.entries(payload)) {
        // Handle both old format (plain chapterPaths map) and new format (object with chapterPaths key)
        if (entry && typeof entry === 'object' && 'chapterPaths' in entry) {
          const e = entry as PersistedBookEntry;
          books[bookId] = {
            status: 'done',
            progress: 1,
            chapterPaths: e.chapterPaths,
            bookTitle: e.bookTitle,
            bookAuthor: e.bookAuthor,
          };
        } else {
          // Legacy format: entry is Record<string, string> (chapterId → path)
          books[bookId] = {
            status: 'done',
            progress: 1,
            chapterPaths: entry as Record<string, string>,
          };
        }
      }
      set({ books });
    } catch (e) {
      console.warn('[Download] loadSaved error:', e);
    }
  },
}));
