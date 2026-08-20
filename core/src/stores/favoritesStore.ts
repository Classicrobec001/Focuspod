/**
 * favoritesStore — books, shows and individual chapters worth coming back to.
 *
 * A favourite is a *pointer*, not a copy. Only the small descriptive fields are
 * stored — never the chapter list, which for a 60-episode podcast is most of
 * the record. Favouriting is meant to be cheap and unlimited; downloading is
 * what makes something available offline, and the two are deliberately
 * different commitments.
 *
 * The consequence, stated plainly: opening a favourite that was never
 * downloaded needs a connection, and says so. A favourite that *has* been
 * downloaded resolves from the download manifest and works offline.
 *
 * `feedUrl` is kept because a podcast cannot be re-fetched without it — there
 * is no metadata endpoint to look a show up by id.
 *
 * Chapters are the exception to the pointer rule, and are stored whole. A
 * favourite chapter exists to be one press from playing — see
 * `PersistedChapterFavorite` in storage.ts.
 */

import { create } from 'zustand';
import { Book, Chapter } from '../types';
import {
  loadFavorites,
  saveFavorites,
  loadFavoriteChapters,
  saveFavoriteChapters,
  PersistedFavorite,
  PersistedChapterFavorite,
} from '../services/storage';
import { useAuthStore } from './authStore';

/** Caps come from the account tier; see services/entitlements.ts. */
const limits = () => useAuthStore.getState().entitlements();

interface FavoritesState {
  /** bookId → the stripped record, newest first when listed. */
  items: Record<string, PersistedFavorite>;
  /** chapterId → the whole chapter plus the book fields needed to list it. */
  chapters: Record<string, PersistedChapterFavorite>;
  isLoaded: boolean;

  load: () => Promise<void>;
  isFavorite: (bookId: string) => boolean;
  toggle: (book: Book) => Promise<boolean>;
  remove: (bookId: string) => Promise<void>;

  isChapterFavorite: (chapterId: string) => boolean;
  toggleChapter: (book: Book, chapter: Chapter) => Promise<boolean>;
  removeChapter: (chapterId: string) => Promise<void>;

  /** Wholesale replace, for a sync pull. Skips the caps — the server won. */
  replaceAll: (
    items: Record<string, PersistedFavorite>,
    chapters: Record<string, PersistedChapterFavorite>,
  ) => Promise<void>;
}

/**
 * Drops the oldest entries until the map fits.
 *
 * Evicting rather than refusing, so favouriting always succeeds: being told
 * "your list is full" mid-chapter is worse than quietly losing the thing you
 * saved months ago and never went back to.
 */
function enforceCap<T extends { addedAt: number }>(
  items: Record<string, T>,
  cap: number,
): Record<string, T> {
  const ids = Object.keys(items);
  if (ids.length <= cap) return items;
  const byAge = ids.sort((a, b) => items[a].addedAt - items[b].addedAt);
  const trimmed = { ...items };
  for (const id of byAge.slice(0, ids.length - cap)) delete trimmed[id];
  return trimmed;
}

/** Everything needed to list and re-open a book, minus the bulk. */
function strip(book: Book): Book {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    narrator: book.narrator,
    description: book.description.slice(0, 300),
    coverUrl: book.coverUrl,
    categories: book.categories.slice(0, 3),
    duration: book.duration,
    feedUrl: book.feedUrl,
    chapters: [],
  };
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  items: {},
  chapters: {},
  isLoaded: false,

  load: async () => {
    const [items, chapters] = await Promise.all([loadFavorites(), loadFavoriteChapters()]);
    set({ items, chapters, isLoaded: true });
  },

  isFavorite: bookId => Boolean(get().items[bookId]),

  /** Returns the new state, so a caller can report what just happened. */
  toggle: async book => {
    const items = { ...get().items };
    const nowFavorite = !items[book.id];

    if (nowFavorite) {
      items[book.id] = { book: strip(book), addedAt: Date.now() };
    } else {
      delete items[book.id];
    }

    const capped = enforceCap(items, limits().maxFavorites);
    set({ items: capped });
    await saveFavorites(capped);
    return nowFavorite;
  },

  remove: async bookId => {
    const items = { ...get().items };
    delete items[bookId];
    set({ items });
    await saveFavorites(items);
  },

  // ─── Chapters ───────────────────────────────────────────────────────────

  isChapterFavorite: chapterId => Boolean(get().chapters[chapterId]),

  toggleChapter: async (book, chapter) => {
    const chapters = { ...get().chapters };
    const nowFavorite = !chapters[chapter.id];

    if (nowFavorite) {
      chapters[chapter.id] = {
        chapter,
        bookId: book.id,
        bookTitle: book.title,
        author: book.author,
        coverUrl: book.coverUrl,
        addedAt: Date.now(),
      };
    } else {
      delete chapters[chapter.id];
    }

    const capped = enforceCap(chapters, limits().maxFavoriteChapters);
    set({ chapters: capped });
    await saveFavoriteChapters(capped);
    return nowFavorite;
  },

  removeChapter: async chapterId => {
    const chapters = { ...get().chapters };
    delete chapters[chapterId];
    set({ chapters });
    await saveFavoriteChapters(chapters);
  },

  replaceAll: async (items, chapters) => {
    set({ items, chapters });
    await Promise.all([saveFavorites(items), saveFavoriteChapters(chapters)]);
  },
}));

/** Favourite chapters newest first, same ordering rule as books. */
export function listFavoriteChapters(
  chapters: Record<string, PersistedChapterFavorite>,
): PersistedChapterFavorite[] {
  return Object.values(chapters).sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * A one-chapter Book, so a favourite chapter can be handed straight to
 * `playbackStore.loadBook` without fetching the rest of the title first.
 *
 * The trade is that the queue holds only this chapter: pressing next at the end
 * stops rather than continuing into chapter twelve. That is the right behaviour
 * for something saved to be replayed on its own, and opening the book proper is
 * still one press away from the chapter's own detail row.
 */
export function chapterFavoriteAsBook(favorite: PersistedChapterFavorite): Book {
  return {
    id: favorite.bookId,
    title: favorite.bookTitle,
    author: favorite.author,
    description: '',
    coverUrl: favorite.coverUrl,
    categories: [],
    chapters: [favorite.chapter],
    duration: favorite.chapter.duration,
  };
}

/** Favourites newest first — the one just added should be at the top. */
export function listFavorites(items: Record<string, PersistedFavorite>): Book[] {
  return Object.values(items)
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(entry => entry.book);
}
