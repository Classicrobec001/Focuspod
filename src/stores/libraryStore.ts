import { create } from 'zustand';
import { Book } from '../types';
import { fetchBooks, fetchBook } from '../services/librivoxService';

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
    set({ isLoading: true, error: null });
    try {
      const books = await fetchBooks({ limit: 20, offset: 0 });
      set({ books, offset: 20, hasMore: books.length === 20 });
    } catch (e) {
      set({ error: (e as Error).message });
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
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  searchBooks: async (query: string) => {
    set({ searchQuery: query, isLoading: true, error: null });
    try {
      const results = await fetchBooks({ search: query, limit: 20 });
      set({ searchResults: results });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  selectBook: async (bookId: string) => {
    const existing = get().books.find(b => b.id === bookId);
    if (existing) {
      set({ selectedBook: existing });
      return;
    }
    set({ isLoading: true });
    try {
      const book = await fetchBook(bookId);
      set({ selectedBook: book });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [] }),
  clearError: () => set({ error: null }),
}));
