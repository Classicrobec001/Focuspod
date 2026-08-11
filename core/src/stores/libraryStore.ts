import { create } from 'zustand';
import { Book } from '../types';
import {
  fetchBook,
  fetchBooks,
  isHydrated,
  type GenreKey,
  type SortOption,
} from '../services/archiveService';
import { readCatalogCache, writeCatalogCache } from '../services/storage';
// Downloads are the offline source of truth for a book. downloadStore has no
// dependency on this module, so the import is one-directional.
import { useDownloadStore } from './downloadStore';
import { hydratePodcast, isPodcast } from '../services/podcastService';
// AbortError is thrown both by the 15 s request timeout and by cancelling a
// superseded search; neither should ever surface to the user as an error.
import { isAbortError, isNetworkError } from '../utils/errors';

const PAGE_SIZE = 50;
const MORE_SIZE = 20;

/** Kept outside zustand state so replacing it never triggers a re-render. */
let searchController: AbortController | null = null;

/**
 * Catalog requests fail for one reason far more often than any other: no
 * connection. Raw fetch errors ("Failed to fetch", "NetworkError") tell the user
 * nothing and hide the fact that their downloads still work.
 */
function catalogError(e: unknown): string {
  return isNetworkError(e)
    ? 'Could not reach the library. Downloaded books still work offline.'
    : ((e as Error)?.message || 'Something went wrong loading the library.');
}

interface LibraryState {
  books: Book[];
  /** Active browse filters. Changing either refetches from the first page. */
  genre: GenreKey;
  sort: SortOption;
  searchResults: Book[];
  selectedBook: Book | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  hasMore: boolean;
  offset: number;

  loadBooks: () => Promise<void>;
  loadMore: () => Promise<void>;
  setGenre: (genre: GenreKey) => Promise<void>;
  setSort: (sort: SortOption) => Promise<void>;
  searchBooks: (query: string) => Promise<void>;
  selectBook: (bookId: string) => Promise<void>;
  /** Show a book we already hold in full — podcasts arrive hydrated. */
  setSelectedBook: (book: Book) => void;
  /**
   * Open any book from any source: a favourite, a podcast, a downloaded copy or
   * a catalog entry. Shows what is known immediately, then fills in chapters
   * from whichever source can supply them.
   */
  openBook: (book: Book) => Promise<void>;
  clearSearch: () => void;
  clearError: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  genre: '',
  sort: 'popular',
  searchResults: [],
  selectedBook: null,
  isLoading: false,
  error: null,
  searchQuery: '',
  hasMore: true,
  offset: 0,

  loadBooks: async () => {
    if (get().books.length > 0) return;

    const { genre, sort } = get();
    // Cache per filter combination, otherwise switching genre would show the
    // previous genre's cached page.
    const cacheKey = `browse:${sort}:${genre}`;

    // Serve cache first so the list is instant on repeat visits, then refresh
    // in the background.
    const cached = await readCatalogCache<Book[]>(cacheKey);
    if (cached && cached.length > 0) {
      set({ books: cached, offset: cached.length, hasMore: true, isLoading: false });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const books = await fetchBooks({ limit: PAGE_SIZE, offset: 0, genre, sort });
      set({ books, offset: books.length, hasMore: books.length === PAGE_SIZE });
      void writeCatalogCache(cacheKey, books);
    } catch (e) {
      if (isAbortError(e)) {
        console.warn('[Library] loadBooks timed out — will retry on next visit');
      } else {
        set({ error: catalogError(e) });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const { isLoading, hasMore, offset, books, searchQuery } = get();
    if (isLoading || !hasMore || searchQuery) return;
    set({ isLoading: true });
    try {
      const { genre, sort } = get();
      const next = await fetchBooks({ limit: MORE_SIZE, offset, genre, sort });
      // The Archive paginates by page number, so a partial final page can
      // repeat items already held; drop those rather than showing duplicates.
      const known = new Set(books.map(b => b.id));
      const fresh = next.filter(b => !known.has(b.id));
      set({
        books: [...books, ...fresh],
        offset: offset + next.length,
        hasMore: next.length === MORE_SIZE,
      });
    } catch (e) {
      if (!isAbortError(e)) set({ error: catalogError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  searchBooks: async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      set({ searchQuery: '', searchResults: [] });
      return;
    }

    const cached = await readCatalogCache<Book[]>(`search:${trimmed}`);
    if (cached) {
      set({ searchResults: cached, searchQuery: trimmed, isLoading: false });
      return;
    }

    // Cancel any in-flight search so a slow earlier response can't overwrite
    // fresher results.
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;

    set({ searchQuery: trimmed, isLoading: true, error: null });
    try {
      const results = await fetchBooks({ search: trimmed, limit: MORE_SIZE }, controller.signal);
      set({ searchResults: results });
      void writeCatalogCache(`search:${trimmed}`, results);
    } catch (e) {
      if (isAbortError(e)) return; // superseded by a newer query
      set({ error: catalogError(e) });
    } finally {
      if (searchController === controller) set({ isLoading: false });
    }
  },

  /**
   * Loads full detail for a book. Browse and search results carry no chapter
   * list (the Archive's search endpoint doesn't return file lists), so a
   * cached entry still needs hydrating before it can be played.
   *
   * A downloaded book is served from its offline manifest and never hits the
   * network — that is what makes downloads work with the radio off.
   */
  selectBook: async (bookId: string) => {
    const offline = useDownloadStore.getState().getOfflineBook(bookId);
    if (offline) {
      set({ selectedBook: offline, isLoading: false, error: null });
      return;
    }

    const { books, searchResults } = get();
    const known =
      books.find(b => b.id === bookId) ?? searchResults.find(b => b.id === bookId) ?? null;

    // Show what we have immediately; the chapter list arrives a moment later.
    set({ selectedBook: known });
    if (known && isHydrated(known)) return;

    set({ isLoading: true });
    try {
      const full = await fetchBook(bookId);
      if (!full) {
        set({ error: 'This book is no longer available.' });
        return;
      }
      set({ selectedBook: full });
      // Replace the placeholder in whichever list it came from so the chapter
      // list survives navigating away and back.
      set(s => ({
        books: s.books.map(b => (b.id === bookId ? full : b)),
        searchResults: s.searchResults.map(b => (b.id === bookId ? full : b)),
      }));
    } catch (e) {
      if (isAbortError(e)) return;
      // Reaching here with no offline copy means the catalog is unreachable —
      // usually no connection. Say what the user can still do about it.
      set({ error: catalogError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  setGenre: async genre => {
    if (get().genre === genre) return;
    set({ genre, books: [], offset: 0, hasMore: true, error: null });
    await get().loadBooks();
  },

  setSort: async sort => {
    if (get().sort === sort) return;
    set({ sort, books: [], offset: 0, hasMore: true, error: null });
    await get().loadBooks();
  },

  setSelectedBook: book => set({ selectedBook: book, isLoading: false, error: null }),

  openBook: async book => {
    // Show the card straight away; chapters follow.
    set({ selectedBook: book, error: null });
    if (isHydrated(book)) return;

    const offline = useDownloadStore.getState().getOfflineBook(book.id);
    if (offline) {
      set({ selectedBook: offline, isLoading: false });
      return;
    }

    set({ isLoading: true });
    try {
      // Podcasts have no metadata endpoint to look a show up by id, so they are
      // re-read from the feed url carried on the record itself.
      const full = isPodcast(book.id)
        ? await hydratePodcast(book)
        : await fetchBook(book.id);
      if (!full) {
        set({ error: 'This is no longer available.' });
        return;
      }
      set({ selectedBook: full });
    } catch (e) {
      if (isAbortError(e)) return;
      set({ error: catalogError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  clearSearch: () => {
    searchController?.abort();
    set({ searchQuery: '', searchResults: [] });
  },

  clearError: () => set({ error: null }),
}));
