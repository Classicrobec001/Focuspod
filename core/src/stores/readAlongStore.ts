/**
 * readAlongStore — the printed text shown alongside playback.
 *
 * Position is an *estimate*. LibriVox publishes no word or line timings, so
 * there is nothing to sync against: the only available signal is how far
 * through the recording you are. Mapping elapsed time onto the text linearly
 * tracks a plain reading closely and drifts around intros, music and long
 * pauses. The reader can always scroll, and doing so takes over from the
 * estimate until they ask to follow again.
 */

import { create } from 'zustand';
import { Book } from '../types';
import { BookText, fetchBookText } from '../services/textService';
import { isAbortError, isNetworkError } from '../utils/errors';

interface ReadAlongState {
  bookId: string | null;
  text: BookText | null;
  isLoading: boolean;
  /** Set when no open edition could be found — a normal outcome, not a fault. */
  unavailable: boolean;
  error: string | null;
  /** Paragraph index at the top of the view. */
  cursor: number;
  /** Whether the view follows playback or the reader is scrolling themselves. */
  following: boolean;

  load: (book: Book) => Promise<void>;
  /** Move the view by whole paragraphs; stops following. */
  scrollBy: (delta: number) => void;
  setFollowing: (following: boolean) => void;
  /** Re-centre on the estimated position and resume following. */
  syncTo: (fraction: number) => void;
  reset: () => void;
}

let controller: AbortController | null = null;

export const useReadAlongStore = create<ReadAlongState>((set, get) => ({
  bookId: null,
  text: null,
  isLoading: false,
  unavailable: false,
  error: null,
  cursor: 0,
  following: true,

  load: async (book: Book) => {
    if (get().bookId === book.id && (get().text || get().unavailable)) return;

    controller?.abort();
    controller = new AbortController();
    set({
      bookId: book.id,
      text: null,
      isLoading: true,
      unavailable: false,
      error: null,
      cursor: 0,
      following: true,
    });

    try {
      const text = await fetchBookText(book, controller.signal);
      if (get().bookId !== book.id) return; // superseded by another book
      if (!text) {
        set({ unavailable: true, isLoading: false });
        return;
      }
      set({ text, isLoading: false });
    } catch (e) {
      if (isAbortError(e)) return;
      set({
        isLoading: false,
        error: isNetworkError(e)
          ? 'Text needs a connection the first time you open it.'
          : 'Could not load the text for this book.',
      });
    }
  },

  scrollBy: delta => {
    const { text, cursor } = get();
    if (!text) return;
    const next = Math.max(0, Math.min(text.paragraphs.length - 1, cursor + delta));
    set({ cursor: next, following: false });
  },

  setFollowing: following => set({ following }),

  syncTo: fraction => {
    const { text } = get();
    if (!text) return;
    // Weight by characters rather than paragraph count so long paragraphs take
    // proportionally longer, which is closer to how the reading actually runs.
    const target = Math.max(0, Math.min(1, fraction)) * text.length;
    let seen = 0;
    for (let i = 0; i < text.paragraphs.length; i++) {
      seen += text.paragraphs[i].length;
      if (seen >= target) {
        set({ cursor: i, following: true });
        return;
      }
    }
    set({ cursor: text.paragraphs.length - 1, following: true });
  },

  reset: () => {
    controller?.abort();
    controller = null;
    set({
      bookId: null,
      text: null,
      isLoading: false,
      unavailable: false,
      error: null,
      cursor: 0,
      following: true,
    });
  },
}));

/**
 * How far through the whole book the playhead is, from the chapter index and
 * position within it. Chapter durations come from the catalog, so this needs no
 * network and works for a downloaded book.
 */
export function bookFraction(
  book: Book,
  chapterIndex: number,
  positionInChapter: number,
): number {
  const total = book.chapters.reduce((sum, c) => sum + (c.duration || 0), 0);
  if (total <= 0) return 0;
  const before = book.chapters
    .slice(0, chapterIndex)
    .reduce((sum, c) => sum + (c.duration || 0), 0);
  return Math.max(0, Math.min(1, (before + positionInChapter) / total));
}
