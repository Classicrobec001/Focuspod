/**
 * downloadStore — per-book offline state.
 *
 * Only the chapter inventory is persisted; `status` and `progress` are derived
 * on load from what the DownloadPort reports as actually present, so a download
 * interrupted by a crash or a cleared cache is never reported as complete.
 */

import { create } from 'zustand';
import { Book } from '../types';
import { downloads } from '../ports/registry';
import { loadDownloadIndex, PersistedDownload, saveDownloadIndex } from '../services/storage';

export type DownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

export interface BookDownloadState {
  status: DownloadStatus;
  /** 0–1 across the whole book. */
  progress: number;
  /** Chapter ids confirmed stored. */
  chapterIds: string[];
  totalChapters: number;
  errorMessage?: string;
  bookTitle: string;
  bookAuthor: string;
  coverUrl: string;
}

interface DownloadStoreState {
  books: Record<string, BookDownloadState>;
  usedBytes: number;
  quotaBytes: number | null;

  getState: (bookId: string) => BookDownloadState | null;
  isDownloaded: (bookId: string) => boolean;
  isDownloading: (bookId: string) => boolean;
  downloadedBooks: () => Array<{ bookId: string } & BookDownloadState>;

  startDownload: (book: Book) => Promise<void>;
  cancelDownload: (bookId: string) => void;
  deleteDownload: (bookId: string) => Promise<void>;
  loadSaved: () => Promise<void>;
  refreshUsage: () => Promise<void>;
}

/** Live AbortControllers, kept out of state so aborting doesn't re-render. */
const controllers = new Map<string, AbortController>();

function persist(books: Record<string, BookDownloadState>): void {
  const index: Record<string, PersistedDownload> = {};
  for (const [bookId, state] of Object.entries(books)) {
    if (state.chapterIds.length > 0) {
      index[bookId] = {
        chapterIds: state.chapterIds,
        bookTitle: state.bookTitle,
        bookAuthor: state.bookAuthor,
        coverUrl: state.coverUrl,
      };
    }
  }
  void saveDownloadIndex(index);
}

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  books: {},
  usedBytes: 0,
  quotaBytes: null,

  getState: bookId => get().books[bookId] ?? null,
  isDownloaded: bookId => get().books[bookId]?.status === 'done',
  isDownloading: bookId => get().books[bookId]?.status === 'downloading',

  downloadedBooks: () =>
    Object.entries(get().books)
      .filter(([, s]) => s.chapterIds.length > 0)
      .map(([bookId, s]) => ({ bookId, ...s })),

  startDownload: async book => {
    if (book.chapters.length === 0) {
      console.warn('[Download] refusing to download an unhydrated book:', book.id);
      return;
    }
    if (get().books[book.id]?.status === 'downloading') return;

    const controller = new AbortController();
    controllers.set(book.id, controller);

    const already = get().books[book.id]?.chapterIds ?? [];
    set(s => ({
      books: {
        ...s.books,
        [book.id]: {
          status: 'downloading',
          progress: already.length / book.chapters.length,
          chapterIds: already,
          totalChapters: book.chapters.length,
          bookTitle: book.title,
          bookAuthor: book.author,
          coverUrl: book.coverUrl,
        },
      },
    }));

    try {
      for (const chapter of book.chapters) {
        if (controller.signal.aborted) {
          throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        }
        if (await downloads().isChapterDownloaded(book.id, chapter.id)) continue;

        await downloads().downloadChapter(
          book.id,
          chapter,
          fraction => {
            // Blend the in-flight chapter into overall book progress so the
            // bar moves smoothly on books with few, long chapters.
            set(s => {
              const prev = s.books[book.id];
              if (!prev) return s;
              const base = prev.chapterIds.length;
              return {
                books: {
                  ...s.books,
                  [book.id]: {
                    ...prev,
                    progress: Math.min(1, (base + fraction) / prev.totalChapters),
                  },
                },
              };
            });
          },
          controller.signal,
        );

        set(s => {
          const prev = s.books[book.id];
          if (!prev) return s;
          const chapterIds = [...prev.chapterIds, chapter.id];
          const next = {
            ...s.books,
            [book.id]: {
              ...prev,
              chapterIds,
              progress: chapterIds.length / prev.totalChapters,
            },
          };
          persist(next);
          return { books: next };
        });
      }

      set(s => {
        const prev = s.books[book.id];
        if (!prev) return s;
        const next = {
          ...s.books,
          [book.id]: { ...prev, status: 'done' as DownloadStatus, progress: 1 },
        };
        persist(next);
        return { books: next };
      });
      void get().refreshUsage();
    } catch (e) {
      const cancelled = (e as Error)?.name === 'AbortError';
      set(s => {
        const prev = s.books[book.id];
        if (!prev) return s;
        return {
          books: {
            ...s.books,
            [book.id]: {
              ...prev,
              // A cancelled download keeps the chapters it already fetched.
              status: cancelled ? (prev.chapterIds.length ? 'idle' : 'idle') : 'error',
              errorMessage: cancelled ? undefined : (e as Error)?.message ?? 'Download failed',
            },
          },
        };
      });
    } finally {
      controllers.delete(book.id);
    }
  },

  cancelDownload: bookId => {
    controllers.get(bookId)?.abort();
    controllers.delete(bookId);
  },

  deleteDownload: async bookId => {
    get().cancelDownload(bookId);
    const state = get().books[bookId];
    await downloads().deleteBook(bookId, state?.chapterIds ?? []);
    set(s => {
      const { [bookId]: _removed, ...rest } = s.books;
      persist(rest);
      return { books: rest };
    });
    void get().refreshUsage();
  },

  loadSaved: async () => {
    const index = await loadDownloadIndex();
    const books: Record<string, BookDownloadState> = {};

    for (const [bookId, entry] of Object.entries(index)) {
      // Verify against the store rather than trusting the index — a browser can
      // evict cached audio at any time to reclaim space.
      const present: string[] = [];
      for (const chapterId of entry.chapterIds) {
        if (await downloads().isChapterDownloaded(bookId, chapterId)) present.push(chapterId);
      }
      if (present.length === 0) continue;

      books[bookId] = {
        status: present.length === entry.chapterIds.length ? 'done' : 'idle',
        progress: present.length / entry.chapterIds.length,
        chapterIds: present,
        totalChapters: entry.chapterIds.length,
        bookTitle: entry.bookTitle,
        bookAuthor: entry.bookAuthor,
        coverUrl: entry.coverUrl,
      };
    }

    set({ books });
    persist(books);
    void get().refreshUsage();
  },

  refreshUsage: async () => {
    try {
      const { usedBytes, quotaBytes } = await downloads().usage();
      set({ usedBytes, quotaBytes });
    } catch {
      // Storage estimation is best-effort and unsupported on some platforms.
    }
  },
}));
