/**
 * archiveService — LibriVox catalog access via the Internet Archive.
 *
 * Why not librivox.org/api/feed/audiobooks?
 * ────────────────────────────────────────
 * That endpoint sends no `Access-Control-Allow-Origin` header, so a browser
 * blocks every request to it. The Internet Archive hosts the same LibriVox
 * collection and *does* send `access-control-allow-origin: *` on both of the
 * endpoints used here, plus on the mp3 files themselves (with `accept-ranges`,
 * so streaming and range-based downloads both work). That keeps FocusPod a
 * fully static app with no proxy or backend.
 *
 * Two endpoints, two stages
 * ─────────────────────────
 *   advancedsearch.php  → browse/search results. Cheap, paginated, but returns
 *                         no file list, so books arrive with `chapters: []`.
 *   metadata/<id>       → the item's file list, which becomes the chapters.
 *
 * A browse page therefore costs one request, not one-per-book; chapters are
 * hydrated lazily when the user opens a book. Call `isHydrated()` before
 * relying on `book.chapters`.
 */

import { Book, Chapter } from '../types';
import { isNetworkError } from '../utils/errors';

const SEARCH_URL = 'https://archive.org/advancedsearch.php';
const METADATA_URL = 'https://archive.org/metadata';
const DOWNLOAD_URL = 'https://archive.org/download';
const COVER_URL = 'https://archive.org/services/img';
const COLLECTION = 'librivoxaudio';
const REQUEST_TIMEOUT_MS = 15_000;
/** Pause before the single retry, to let a transient failure clear. */
const RETRY_DELAY_MS = 800;

/**
 * How the browse list is ordered.
 *
 * 'popular' alone is why the library felt tiny: the collection holds ~21,700
 * titles, but the most-downloaded page is always the same few dozen classics.
 * 'recent' surfaces newly recorded titles, and genre browsing opens the rest.
 */
export type SortOption = 'popular' | 'recent' | 'title';

const SORT_FIELDS: Record<SortOption, string> = {
  popular: 'downloads desc',
  // publicdate is when the recording was published to the Archive, so this is
  // "newly recorded", not "newly written".
  recent: 'publicdate desc',
  title: 'titleSorter asc',
};

export const SORT_LABELS: Record<SortOption, string> = {
  popular: 'Most popular',
  recent: 'Recently added',
  title: 'Title A–Z',
};

/**
 * Browsable categories.
 *
 * Most are a single `subject` tag, but faiths need more than that: LibriVox
 * tags the Pickthall and Rodwell translations under "koran"/"quran" rather than
 * "islam", so a lone subject match finds almost nothing and the category looks
 * empty when the books are actually there. `query` overrides the default
 * `subject:("key")` for those.
 *
 * Faiths are listed individually rather than folded into one "Religion" bucket.
 * That bucket is ~1,050 Christian titles out of ~1,200, so everything else is
 * buried past any page a reader would scroll to.
 */
export const GENRES = [
  { key: '', label: 'All books' },
  { key: 'fiction', label: 'Fiction' },
  { key: 'poetry', label: 'Poetry' },
  { key: 'history', label: 'History' },
  { key: 'children', label: "Children's" },
  { key: 'romance', label: 'Romance' },
  { key: 'adventure', label: 'Adventure' },
  { key: 'philosophy', label: 'Philosophy' },
  {
    key: 'islam',
    label: 'Islam',
    query:
      'subject:(islam) OR subject:(islamic) OR subject:(quran) OR subject:(koran) ' +
      'OR subject:(muslim) OR subject:(sufi) OR title:(koran) OR title:(quran)',
  },
  {
    key: 'christianity',
    label: 'Christianity',
    query: 'subject:(christianity) OR subject:(christian) OR subject:(bible)',
  },
  {
    key: 'judaism',
    label: 'Judaism',
    query: 'subject:(judaism) OR subject:(jewish) OR subject:(talmud) OR subject:(torah)',
  },
  {
    key: 'buddhism',
    label: 'Buddhism',
    query: 'subject:(buddhism) OR subject:(buddhist) OR subject:(buddha)',
  },
  {
    key: 'hinduism',
    label: 'Hinduism',
    query:
      'subject:(hinduism) OR subject:(hindu) OR subject:(vedanta) OR subject:(upanishad)',
  },
  { key: 'mythology', label: 'Mythology' },
  { key: 'war', label: 'War' },
  { key: 'mystery', label: 'Mystery' },
  { key: 'short stories', label: 'Short stories' },
  { key: 'humor', label: 'Humour' },
  { key: 'science fiction', label: 'Science fiction' },
  { key: 'travel', label: 'Travel' },
  { key: 'biography', label: 'Biography' },
  { key: 'fantasy', label: 'Fantasy' },
  { key: 'drama', label: 'Drama' },
  { key: 'horror', label: 'Horror' },
] as const;

export type GenreKey = (typeof GENRES)[number]['key'];

// ─── Raw response shapes ──────────────────────────────────────────────────
// The Archive returns single-valued fields as a bare string and multi-valued
// fields as an array of strings, with no way to know which in advance.

type MaybeList = string | string[] | undefined;

interface SearchDoc {
  identifier: string;
  title?: MaybeList;
  creator?: MaybeList;
  description?: MaybeList;
  subject?: MaybeList;
  runtime?: MaybeList;
}

interface MetadataFile {
  name: string;
  format?: string;
  title?: string;
  track?: string;
  length?: string;
  size?: string;
}

interface MetadataResponse {
  metadata?: {
    identifier?: string;
    title?: MaybeList;
    creator?: MaybeList;
    description?: MaybeList;
    subject?: MaybeList;
    runtime?: MaybeList;
  };
  files?: MetadataFile[];
}

// ─── Field coercion ───────────────────────────────────────────────────────

function first(value: MaybeList): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function list(value: MaybeList): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  // Single-valued subject fields are often a comma-separated string.
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Archive durations come in two shapes: "MM:SS" / "H:MM:SS" on derived audio
 * files and item runtimes, or a bare float of seconds ("506.19") on others.
 */
function parseDuration(raw: string | undefined): number {
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

// ─── Chapter extraction ───────────────────────────────────────────────────

/**
 * Preference order for the audio derivative to stream. LibriVox items always
 * carry a 64 kbps derivative — the smallest, which matters most for offline
 * downloads over mobile data — and fall back to the other MP3 derivatives.
 * Ogg is deliberately excluded: Safari cannot decode it.
 */
const MP3_FORMATS = ['64Kbps MP3', 'VBR MP3', '128Kbps MP3', 'MP3'];

function pickAudioFiles(files: MetadataFile[]): MetadataFile[] {
  for (const format of MP3_FORMATS) {
    const matches = files.filter(f => f.format === format && f.name.endsWith('.mp3'));
    if (matches.length > 0) return matches;
  }
  return [];
}

function trackNumber(file: MetadataFile): number {
  // `track` is sometimes "3" and sometimes "3/12".
  const raw = file.track?.split('/')[0];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function sortChapterFiles(files: MetadataFile[]): MetadataFile[] {
  return [...files].sort((a, b) => {
    const byTrack = trackNumber(a) - trackNumber(b);
    if (byTrack !== 0 && Number.isFinite(byTrack)) return byTrack;
    // Items without track metadata are named with a zero-padded index, so a
    // plain lexicographic compare puts them in reading order.
    return a.name.localeCompare(b.name);
  });
}

function toChapters(bookId: string, files: MetadataFile[]): Chapter[] {
  return sortChapterFiles(pickAudioFiles(files)).map((file, index) => ({
    id: `${bookId}_${index}`,
    bookId,
    title: file.title?.trim() || `Chapter ${index + 1}`,
    audioUrl: `${DOWNLOAD_URL}/${encodeURIComponent(bookId)}/${encodeURIComponent(file.name)}`,
    duration: parseDuration(file.length),
  }));
}

// ─── Requests ─────────────────────────────────────────────────────────────

async function getJsonOnce<T>(url: string, externalSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Internet Archive request failed: ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The Archive drops a noticeable share of connections under load — measured at
 * roughly one in three timing out during sustained use. A single retry turns
 * most of those from a visible "couldn't reach the library" into a slightly
 * slower load.
 *
 * Only connection-level failures are retried. A 4xx/5xx or a caller
 * cancellation is left alone, since repeating those achieves nothing.
 */
async function getJson<T>(url: string, externalSignal?: AbortSignal): Promise<T> {
  try {
    return await getJsonOnce<T>(url, externalSignal);
  } catch (error) {
    // The caller cancelled (a superseded search): never retry.
    if (externalSignal?.aborted) throw error;

    // Retry a timeout or a dropped connection; an HTTP error status would only
    // repeat itself.
    const worthRetrying = (error as Error)?.name === 'AbortError' || isNetworkError(error);
    if (!worthRetrying) throw error;

    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    return getJsonOnce<T>(url, externalSignal);
  }
}

function queryString(params: Array<[string, string | number]>): string {
  return params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** Escape the Lucene syntax characters the Archive's search backend honours. */
function escapeLucene(term: string): string {
  return term.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

function buildQuery(search?: string, genre?: string): string {
  const clauses = [`collection:${COLLECTION}`];

  if (search?.trim()) {
    const term = escapeLucene(search.trim());
    // `subject` is included so a reader can search by what a book is *about*,
    // not only by its name. Searching "islam" or "quran" matched nothing while
    // this was title-and-author only, because the books are called "The Holy
    // Koran" and "The Meaning of the Glorious Koran". Description is left out —
    // it mentions far too much in passing to stay relevant.
    clauses.push(`(title:(${term}) OR creator:(${term}) OR subject:(${term}))`);
  }

  if (genre?.trim()) {
    const key = genre.trim();
    const entry = GENRES.find(g => g.key === key) as { query?: string } | undefined;
    clauses.push(entry?.query ? `(${entry.query})` : `subject:(${escapeLucene(key)})`);
  }

  return clauses.join(' AND ');
}

// ─── Public API ───────────────────────────────────────────────────────────

function searchDocToBook(doc: SearchDoc): Book {
  return {
    id: doc.identifier,
    title: first(doc.title) || doc.identifier,
    author: first(doc.creator) || 'Unknown',
    description: stripHtml(first(doc.description)),
    coverUrl: `${COVER_URL}/${encodeURIComponent(doc.identifier)}`,
    categories: list(doc.subject).slice(0, 6),
    chapters: [],
    duration: parseDuration(first(doc.runtime)),
  };
}

/**
 * True once `fetchBook` has filled in the file list. Browse and search results
 * always come back unhydrated — check this before reading `book.chapters`.
 */
export function isHydrated(book: Book): boolean {
  return book.chapters.length > 0;
}

export async function fetchBooks(
  params: {
    search?: string;
    genre?: string;
    sort?: SortOption;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal,
): Promise<Book[]> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  // advancedsearch.php paginates by 1-based page number rather than by offset.
  const page = Math.floor(offset / limit) + 1;

  const query: Array<[string, string | number]> = [
    ['q', buildQuery(params.search, params.genre)],
    ['fl[]', 'identifier'],
    ['fl[]', 'title'],
    ['fl[]', 'creator'],
    ['fl[]', 'description'],
    ['fl[]', 'subject'],
    ['fl[]', 'runtime'],
  ];

  // A search keeps the backend's relevance ordering; browsing takes the
  // requested sort, defaulting to most-downloaded.
  //
  // `sort[]` must be omitted rather than sent empty: `sort[]=` makes the
  // endpoint return an error envelope with no `response` key at all, which
  // reads as zero results.
  if (!params.search) {
    query.push(['sort[]', SORT_FIELDS[params.sort ?? 'popular']]);
  }

  query.push(['rows', limit], ['page', page], ['output', 'json']);

  const url = `${SEARCH_URL}?${queryString(query)}`;

  const json = await getJson<{ response?: { docs?: SearchDoc[] } }>(url, signal);
  const docs = json.response?.docs ?? [];
  return docs.filter(d => d.identifier).map(searchDocToBook);
}

/**
 * Full detail for one item, including chapters. Safe to call on a book that
 * came from `fetchBooks` — it replaces the unhydrated placeholder.
 */
export async function fetchBook(id: string, signal?: AbortSignal): Promise<Book | null> {
  const json = await getJson<MetadataResponse>(
    `${METADATA_URL}/${encodeURIComponent(id)}`,
    signal,
  );

  // The Archive answers 200 with an empty object for unknown identifiers.
  if (!json.metadata) return null;

  const meta = json.metadata;
  const chapters = toChapters(id, json.files ?? []);
  const runtime = parseDuration(first(meta.runtime));

  return {
    id,
    title: first(meta.title) || id,
    author: first(meta.creator) || 'Unknown',
    description: stripHtml(first(meta.description)),
    coverUrl: `${COVER_URL}/${encodeURIComponent(id)}`,
    categories: list(meta.subject).slice(0, 6),
    chapters,
    duration: runtime || chapters.reduce((total, c) => total + c.duration, 0),
  };
}
