/**
 * podcastService — the second catalog source.
 *
 * Why podcasts
 * ────────────
 * LibriVox is public domain only, so it has no modern non-fiction: nothing on
 * business, finance, marketing, design or psychology written in the last
 * century. Those books exist only as copyrighted commercial audiobooks. The
 * Internet Archive's non-LibriVox audio was evaluated and is not a substitute —
 * outside LibriVox it is user uploads, ringtones and old radio, not a library.
 *
 * Podcasts are the free, legal, current material on exactly those subjects.
 *
 * How it works without a backend
 * ──────────────────────────────
 *   Discovery — the iTunes Search API. No key, and it reflects the requesting
 *               Origin in its CORS header, so a browser can call it directly.
 *   Episodes  — the show's own RSS feed.
 *
 * Roughly 40% of feeds send no CORS header and simply cannot be read from a
 * page; megaphone, anchor/Spotify, simplecast, captivate and podbean do send
 * one, acast, art19 and spreaker do not. Shows whose feed cannot be read are
 * dropped from results rather than listed and left broken — see
 * `fetchPodcastEpisodes` returning null.
 *
 * A show is modelled as a Book and its episodes as chapters, so every existing
 * screen — detail, chapters, now playing, downloads, focus sessions — works on
 * podcasts with no changes.
 */

import { Book, Chapter } from '../types';

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const REQUEST_TIMEOUT_MS = 15_000;
/** Episodes shown per show. Feeds can carry thousands; nobody scrolls that far. */
const MAX_EPISODES = 60;

/** Prefix marking a Book as a podcast, so ids can never collide with LibriVox. */
export const PODCAST_ID_PREFIX = 'podcast:';

export function isPodcast(bookId: string): boolean {
  return bookId.startsWith(PODCAST_ID_PREFIX);
}

/**
 * Topics, mapped to the search terms that actually return good shows.
 *
 * These are search terms rather than iTunes genre ids on purpose: the genre
 * taxonomy is coarse ("Business" is one bucket), while a term like "behavioral
 * economics" surfaces the specific, high-quality shows a listener wants.
 */
export const PODCAST_TOPICS = [
  { key: 'business', label: 'Business', term: 'business strategy' },
  { key: 'finance', label: 'Finance', term: 'personal finance investing' },
  { key: 'marketing', label: 'Marketing', term: 'marketing' },
  { key: 'design', label: 'Design', term: 'product design' },
  { key: 'psychology', label: 'Psychology', term: 'psychology' },
  { key: 'startups', label: 'Startups', term: 'startup founders' },
  { key: 'economics', label: 'Economics', term: 'economics' },
  { key: 'leadership', label: 'Leadership', term: 'leadership management' },
  { key: 'technology', label: 'Technology', term: 'software engineering' },
  { key: 'science', label: 'Science', term: 'science research' },
  { key: 'history', label: 'History', term: 'history' },
  { key: 'health', label: 'Health', term: 'health habits' },
] as const;

export type PodcastTopic = (typeof PODCAST_TOPICS)[number]['key'];

// ─── iTunes discovery ─────────────────────────────────────────────────────

interface ItunesResult {
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  trackCount?: number;
}

async function getWithTimeout(url: string, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function showToBook(result: ItunesResult): Book | null {
  if (!result.feedUrl || !result.collectionName) return null;
  return {
    id: `${PODCAST_ID_PREFIX}${result.collectionId ?? result.feedUrl}`,
    title: result.collectionName,
    author: result.artistName ?? 'Unknown',
    description: '',
    coverUrl: result.artworkUrl600 ?? result.artworkUrl100 ?? '',
    categories: result.primaryGenreName ? [result.primaryGenreName] : [],
    chapters: [],
    duration: 0,
    // Carried so the episode list can be fetched later.
    feedUrl: result.feedUrl,
  } as Book & { feedUrl: string };
}

/**
 * Shows for a topic or free-text query. Results are unhydrated — episodes
 * arrive from `fetchPodcastEpisodes`.
 */
export async function searchPodcasts(
  params: { term: string; limit?: number },
  signal?: AbortSignal,
): Promise<Book[]> {
  const url =
    `${ITUNES_SEARCH}?` +
    `media=podcast&entity=podcast&limit=${params.limit ?? 25}` +
    `&term=${encodeURIComponent(params.term)}`;

  const response = await getWithTimeout(url, signal);
  if (!response.ok) throw new Error(`Podcast search failed: ${response.status}`);
  const json = (await response.json()) as { results?: ItunesResult[] };
  return (json.results ?? []).map(showToBook).filter((b): b is Book => b !== null);
}

// ─── RSS ──────────────────────────────────────────────────────────────────

/**
 * A deliberately small RSS reader.
 *
 * DOMParser is not used because core has to run under React Native too, where
 * it does not exist. Feeds are far from uniform, so this reads the handful of
 * fields that matter and tolerates everything else rather than trying to be a
 * general XML parser.
 */
function stripCdata(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagContent(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? stripCdata(match[1]) : null;
}

function attribute(xml: string, tag: string, attr: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*"([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

/** "1:02:33", "62:33" or a bare count of seconds. */
function parseEpisodeDuration(raw: string | null): number {
  if (!raw) return 0;
  const value = raw.trim();
  if (value.includes(':')) {
    const parts = value.split(':').map(Number);
    if (parts.some(Number.isNaN)) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds) : 0;
}

export interface PodcastFeed {
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  episodes: Chapter[];
}

/**
 * Reads a show's feed.
 *
 * Returns null when the feed cannot be read from a browser — most often a
 * missing CORS header, which no amount of retrying will fix. Callers drop those
 * shows instead of offering something that cannot play.
 */
export async function fetchPodcastEpisodes(
  bookId: string,
  feedUrl: string,
  signal?: AbortSignal,
): Promise<PodcastFeed | null> {
  let xml: string;
  try {
    const response = await getWithTimeout(feedUrl, signal);
    if (!response.ok) return null;
    xml = await response.text();
  } catch {
    // Any failure here means the show is unusable: a CORS rejection is an
    // opaque network error indistinguishable from being offline, and a feed
    // that times out or 500s is no more listable. Returning null lets the
    // caller drop it rather than offering something that cannot play.
    return null;
  }

  const channel = xml.split(/<item[\s>]/i)[0];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];

  const episodes: Chapter[] = [];
  for (const item of items) {
    // The enclosure is the audio file; an item without one is a text post.
    const url = attribute(item, 'enclosure', 'url');
    if (!url) continue;
    const type = attribute(item, 'enclosure', 'type') ?? '';
    // Video podcasts would load but not behave like an audiobook.
    if (type && !type.startsWith('audio')) continue;

    episodes.push({
      id: `${bookId}_${episodes.length}`,
      bookId,
      title: tagContent(item, 'title') ?? `Episode ${episodes.length + 1}`,
      audioUrl: url,
      duration: parseEpisodeDuration(
        tagContent(item, 'itunes:duration') ?? tagContent(item, 'duration'),
      ),
    });
    if (episodes.length >= MAX_EPISODES) break;
  }

  if (episodes.length === 0) return null;

  // Feeds list newest first; an audiobook-style player should start at the
  // beginning of what it holds, so play in chronological order.
  episodes.reverse();
  episodes.forEach((episode, index) => {
    episode.id = `${bookId}_${index}`;
  });

  return {
    title: tagContent(channel, 'title') ?? 'Podcast',
    author: tagContent(channel, 'itunes:author') ?? tagContent(channel, 'managingEditor') ?? '',
    description: (tagContent(channel, 'description') ?? '').slice(0, 600),
    coverUrl:
      attribute(channel, 'itunes:image', 'href') ??
      tagContent(channel, 'url') ??
      '',
    episodes,
  };
}

/** Fills in a show's episodes, or returns null if its feed is unreadable. */
export async function hydratePodcast(
  book: Book & { feedUrl?: string },
  signal?: AbortSignal,
): Promise<Book | null> {
  if (!book.feedUrl) return null;
  const feed = await fetchPodcastEpisodes(book.id, book.feedUrl, signal);
  if (!feed) return null;

  return {
    ...book,
    description: feed.description || book.description,
    coverUrl: book.coverUrl || feed.coverUrl,
    chapters: feed.episodes,
    duration: feed.episodes.reduce((total, e) => total + e.duration, 0),
  };
}
