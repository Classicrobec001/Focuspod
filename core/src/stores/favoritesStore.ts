/**
 * favoritesStore — books and shows the listener wants to come back to.
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
 */

import { create } from 'zustand';
import { Book } from '../types';
import { loadFavorites, saveFavorites, PersistedFavorite } from '../services/storage';

/** Guards localStorage, which is a few megabytes for the whole app. */
const MAX_FAVORITES = 300;

interface FavoritesState {
  /** bookId → the stripped record, newest first when listed. */
  items: Record<string, PersistedFavorite>;
  isLoaded: boolean;

  load: () => Promise<void>;
  isFavorite: (bookId: string) => boolean;
  toggle: (book: Book) => Promise<boolean>;
  remove: (bookId: string) => Promise<void>;
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
  isLoaded: false,

  load: async () => {
    set({ items: await loadFavorites(), isLoaded: true });
  },

  isFavorite: bookId => Boolean(get().items[bookId]),

  /** Returns the new state, so a caller can report what just happened. */
  toggle: async book => {
    const items = { ...get().items };
    const nowFavorite = !items[book.id];

    if (nowFavorite) {
      items[book.id] = { book: strip(book), addedAt: Date.now() };
      // Drop the oldest rather than refusing, so the action always succeeds.
      const ids = Object.keys(items);
      if (ids.length > MAX_FAVORITES) {
        const oldest = ids.sort((a, b) => items[a].addedAt - items[b].addedAt)[0];
        delete items[oldest];
      }
    } else {
      delete items[book.id];
    }

    set({ items });
    await saveFavorites(items);
    return nowFavorite;
  },

  remove: async bookId => {
    const items = { ...get().items };
    delete items[bookId];
    set({ items });
    await saveFavorites(items);
  },
}));

/** Favourites newest first — the one just added should be at the top. */
export function listFavorites(items: Record<string, PersistedFavorite>): Book[] {
  return Object.values(items)
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(entry => entry.book);
}
