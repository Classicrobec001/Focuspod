import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Book } from '../types';
import { fetchBooks, fetchBook } from '../services/librivoxService';

// ── Local response cache (24-hour TTL) ────────────────────────────────────────
const BOOKS_CACHE_KEY = 'librivox_books_v1';
const SEARCH_CACHE_PREFIX = 'librivox_search_v1_';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function readCache(key: string): Promise<Book[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: Book[]; ts: number };
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: Book[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

// ── Abort helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true for DOMException AbortError — thrown when AbortController.abort()
 * is called, either by our 8-second timeout in apiFetch or by us cancelling a
 * superseded search request.  These should never surface as user-visible errors.
 */
function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/**
 * AbortController for the currently in-flight searchBooks request.
 * Stored outside Zustand state so it doesn't trigger re-renders.
 * Aborted (and replaced) whenever a new search supersedes the previous one.
 */
let searchController: AbortController | null = null;

interface LibraryState {
  books: Book[];
  searchResults: Book[];
  selectedBook: Book | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  hasMore: boolean;
  offset: number;

  loadBooks: () => Promise<void>;
  loadMore: () => Promise<void>;
  searchBooks: (query: string) => Promise<void>;
  selectBook: (bookId: string) => Promise<void>;
  clearSearch: () => void;
  clearError: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  searchResults: [],
  selectedBook: null,
  isLoading: false,
  error: null,
  searchQuery: '',
  hasMore: true,
  offset: 0,

  loadBooks: async () => {
    // Serve from cache first so the list appears instantly on repeat visits.
    const cached = await readCache(BOOKS_CACHE_KEY);
    if (cached && cached.length > 0) {
      set({ books: cached, offset: 50, hasMore: cached.length === 50, isLoading: false });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const books = await fetchBooks({ limit: 50, offset: 0 });
      set({ books, offset: 50, hasMore: books.length === 50 });
      writeCache(BOOKS_CACHE_KEY, books);
    } catch (e) {
      if (isAbortError(e)) {
        // Timeout on initial load — slow connection or emulator lag.
        // Don't surface as a UI error; user can re-enter the screen to retry.
        console.warn('[Library] loadBooks timed out — will retry on next visit');
      } else {
        const err = e as Error;
        console.error('[Library] loadBooks error:', err?.name, err?.message);
        console.error('[Library] loadBooks stack:', err?.stack);
        set({ error: err?.message ?? String(e) });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const { isLoading, hasMore, offset, books, searchQuery } = get();
    if (isLoading || !hasMore) return;
    set({ isLoading: true });
    try {
      const next = await fetchBooks({
        limit: 20,
        offset,
        search: searchQuery || undefined,
      });
      set({
        books: [...books, ...next],
        offset: offset + 20,
        hasMore: next.length === 20,
      });
    } catch (e) {
      if (isAbortError(e)) {
        console.warn('[Library] loadMore timed out');
      } else {
        set({ error: (e as Error).message });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  searchBooks: async (query: string) => {
    // Serve from cache first; a fresh network request runs in the background and
    // updates results if the cache entry is stale.
    const cacheKey = SEARCH_CACHE_PREFIX + query;
    const cached = await readCache(cacheKey);
    if (cached) {
      set({ searchResults: cached, searchQuery: query, isLoading: false });
      return;
    }

    // Cancel any previous in-flight search so stale responses never overwrite
    // fresher results and don't surface spurious "Aborted" errors.
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;

    set({ searchQuery: query, isLoading: true, error: null });
    try {
      const results = await fetchBooks({ search: query, limit: 20 }, controller.signal);
      set({ searchResults: results });
      writeCache(cacheKey, results);
    } catch (e) {
      // AbortError = this request was superseded by a newer debounced query.
      // Silently discard — the newer request will (or already did) set results.
      if (isAbortError(e)) return;
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  selectBook: async (bookId: string) => {
    // Check both the browse list and search results before hitting the network.
    const { books, searchResults } = get();
    const existing = books.find(b => b.id === bookId) ?? searchResults.find(b => b.id === bookId);
    if (existing) {
      set({ selectedBook: existing });
      return;
    }
    set({ isLoading: true });
    try {
      const book = await fetchBook(bookId);
      set({ selectedBook: book });
    } catch (e) {
      if (isAbortError(e)) return;
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [] }),
  clearError: () => set({ error: null }),
}));
