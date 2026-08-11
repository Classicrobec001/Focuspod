/**
 * podcastStore — discovery for the podcast source.
 *
 * Shows are verified before they are listed. Around 40% of feeds send no CORS
 * header and cannot be read from a page at all, and there is no way to tell
 * which from the search results alone. Listing them and failing on open would
 * make roughly two in five taps a dead end, so the feed is fetched up front and
 * only shows that actually loaded are offered.
 *
 * Verification doubles as hydration: the fetch that proves a feed readable also
 * returns its episodes, so opening a show costs nothing further.
 */

import { create } from 'zustand';
import { Book } from '../types';
import { hydratePodcast, searchPodcasts, PODCAST_TOPICS } from '../services/podcastService';
import { isAbortError } from '../utils/errors';

/** Shows requested per topic, before unreadable feeds are filtered out. */
const SEARCH_LIMIT = 18;
/** Feeds fetched at once. Enough to be quick without stalling a phone. */
const VERIFY_CONCURRENCY = 6;

interface PodcastState {
  topic: string | null;
  shows: Book[];
  isLoading: boolean;
  /** Shows verified so far, for progress while a topic loads. */
  checked: number;
  total: number;
  error: string | null;

  loadTopic: (topicKey: string) => Promise<void>;
  searchShows: (term: string) => Promise<void>;
  clear: () => void;
}

let controller: AbortController | null = null;

/** Fetches each feed, keeping the shows that came back readable. */
async function verifyShows(
  candidates: Book[],
  signal: AbortSignal,
  onProgress: (checked: number) => void,
): Promise<Book[]> {
  const readable: Book[] = [];
  let checked = 0;

  for (let i = 0; i < candidates.length; i += VERIFY_CONCURRENCY) {
    if (signal.aborted) break;
    const batch = candidates.slice(i, i + VERIFY_CONCURRENCY);
    const results = await Promise.all(
      batch.map(show =>
        hydratePodcast(show, signal)
          .catch(() => null)
          .then(full => {
            checked++;
            onProgress(checked);
            return full;
          }),
      ),
    );
    readable.push(...results.filter((b): b is Book => b !== null && b.chapters.length > 0));
  }
  return readable;
}

export const usePodcastStore = create<PodcastState>((set, get) => ({
  topic: null,
  shows: [],
  isLoading: false,
  checked: 0,
  total: 0,
  error: null,

  loadTopic: async topicKey => {
    if (get().topic === topicKey && get().shows.length > 0) return;
    const topic = PODCAST_TOPICS.find(t => t.key === topicKey);
    if (!topic) return;

    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;

    set({ topic: topicKey, shows: [], isLoading: true, error: null, checked: 0, total: 0 });
    try {
      const candidates = await searchPodcasts({ term: topic.term, limit: SEARCH_LIMIT }, signal);
      if (signal.aborted) return;
      set({ total: candidates.length });

      const shows = await verifyShows(candidates, signal, checked => set({ checked }));
      if (signal.aborted) return;
      set({ shows, isLoading: false });
    } catch (e) {
      if (isAbortError(e)) return;
      set({ isLoading: false, error: 'Could not load podcasts. Check your connection.' });
    }
  },

  searchShows: async term => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;

    set({ topic: null, shows: [], isLoading: true, error: null, checked: 0, total: 0 });
    try {
      const candidates = await searchPodcasts({ term, limit: SEARCH_LIMIT }, signal);
      if (signal.aborted) return;
      set({ total: candidates.length });
      const shows = await verifyShows(candidates, signal, checked => set({ checked }));
      if (signal.aborted) return;
      set({ shows, isLoading: false });
    } catch (e) {
      if (isAbortError(e)) return;
      set({ isLoading: false, error: 'Could not search podcasts.' });
    }
  },

  clear: () => {
    controller?.abort();
    controller = null;
    set({ topic: null, shows: [], isLoading: false, error: null, checked: 0, total: 0 });
  },
}));
