/**
 * downloadStore — per-book offline state.
 *
 * A download is only useful if the book is playable with the network off, which
 * takes two things: the audio bytes (held by the DownloadPort) and the chapter
 * list that names and orders them. The chapter list is persisted here as part of
 * the manifest rather than being re-fetched, because its only other home is a
 * cached archive.org response that expires and can be evicted — which would
 * leave the downloaded audio stranded.
 *
 * `status` and `progress` are always derived from what the port reports as
 * actually present, never from what we believe we downloaded, so an interrupted
 * or partially-evicted download can never present itself as complete.
 */

import { create } from 'zustand';
import { Book } from '../types';
import { downloads } from '../ports/registry';
import { loadDownloadIndex, PersistedDownload, saveDownloadIndex } from '../services/storage';

export type DownloadStatus = 'idle' | 'downloading' | 'partial' | 'done' | 'error';

export interface BookDownloadState {
  status: DownloadStatus;
  /** 0–1 across the whole book. */
  progress: number;
  /** Chapter ids confirmed stored. */
  chapterIds: string[];
  /** Always the book's real chapter count, never the stored subset. */
  totalChapters: number;
  errorMessage?: string;
  /** The full hydrated book, so playback needs no network. */
  book: Book;
}

interface DownloadStoreState {
  books: Record<string, BookDownloadState>;
  usedBytes: number;
  quotaBytes: number | null;

  getState: (bookId: string) => BookDownloadState | null;
  /** The offline copy of a book, if one exists. Used to play without a network. */
  getOfflineBook: (bookId: string) => Book | null;
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

function statusFor(stored: number, total: number): DownloadStatus {
  if (stored === 0) return 'idle';
  return stored >= total ? 'done' : 'partial';
}

function persist(books: Record<string, BookDownloadState>): void {
  const index: Record<string, PersistedDownload> = {};
  for (const [bookId, state] of Object.entries(books)) {
    if (state.chapterIds.length > 0) {
      index[bookId] = { book: state.book, chapterIds: state.chapterIds };
    }
  }
  void saveDownloadIndex(index);
}

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  books: {},
  usedBytes: 0,
  quotaBytes: null,

  getState: bookId => get().books[bookId] ?? null,
  getOfflineBook: bookId => get().books[bookId]?.book ?? null,
  isDownloaded: bookId => get().books[bookId]?.status === 'done',
  isDownloading: bookId => get().books[bookId]?.status === 'downloading',

  downloadedBooks: () =>
    Object.entries(get().books)
      .filter(([, s]) => s.chapterIds.length > 0 || s.status === 'downloading')
      .map(([bookId, s]) => ({ bookId, ...s })),

  /**
   * Downloads every chapter the book doesn't already have. Safe to call again
   * on a partial download — it resumes rather than restarting.
   */
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
          book,
        },
      },
    }));
    // Write the manifest up front so an interrupted download still leaves a
    // playable record of whatever chapters did land.
    persist(get().books);

    try {
      for (const chapter of book.chapters) {
        if (controller.signal.aborted) {
          throw Object.assign(new Error('Download cancelled'), { name: 'AbortError' });
        }
        if (get().books[book.id]?.chapterIds.includes(chapter.id)) continue;
        if (await downloads().isChapterDownloaded(book.id, chapter.id)) {
          set(s => {
            const prev = s.books[book.id];
            if (!prev) return s;
            const chapterIds = [...prev.chapterIds, chapter.id];
            return {
              books: {
                ...s.books,
                [book.id]: { ...prev, chapterIds, progress: chapterIds.length / prev.totalChapters },
              },
            };
          });
          continue;
        }

        await downloads().downloadChapter(
          book.id,
          chapter,
          fraction => {
            // Blend the in-flight chapter into overall progress so the bar moves
            // smoothly on books with few, long chapters.
            set(s => {
              const prev = s.books[book.id];
              if (!prev) return s;
              return {
                books: {
                  ...s.books,
                  [book.id]: {
                    ...prev,
                    progress: Math.min(1, (prev.chapterIds.length + fraction) / prev.totalChapters),
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
          [book.id]: {
            ...prev,
            status: statusFor(prev.chapterIds.length, prev.totalChapters),
            progress: prev.chapterIds.length / prev.totalChapters,
          },
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
        const next = {
          ...s.books,
          [book.id]: {
            ...prev,
            // Keep whatever landed; a cancelled or failed download is partial,
            // never complete.
            status: cancelled
              ? statusFor(prev.chapterIds.length, prev.totalChapters)
              : ('error' as DownloadStatus),
            progress: prev.chapterIds.length / prev.totalChapters,
            errorMessage: cancelled ? undefined : ((e as Error)?.message ?? 'Download failed'),
          },
        };
        persist(next);
        return { books: next };
      });
      void get().refreshUsage();
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
      // Older manifests stored only display fields and no chapter list. There is
      // no way to recover the chapter URLs from them, so drop the entry and let
      // the user re-download rather than showing a book that cannot play.
      if (!entry.book?.chapters?.length) {
        console.warn('[Download] dropping legacy manifest without a chapter list:', bookId);
        continue;
      }

      // Verify against the port rather than trusting the manifest — a browser
      // can evict cached audio at any time to reclaim space.
      const present: string[] = [];
      for (const chapterId of entry.chapterIds) {
        if (await downloads().isChapterDownloaded(bookId, chapterId)) present.push(chapterId);
      }
      if (present.length === 0) continue;

      books[bookId] = {
        status: statusFor(present.length, entry.book.chapters.length),
        progress: present.length / entry.book.chapters.length,
        chapterIds: present,
        totalChapters: entry.book.chapters.length,
        book: entry.book,
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
