import { Book, Chapter } from '../types';

const API_BASE = 'https://librivox.org/api/feed/audiobooks';
const RSS_TIMEOUT = 15_000;

interface LibrivoxSection {
  section_number: string;
  title: string;
  listen_url: string;
  duration: string; // "HH:MM:SS"
}

interface LibrivoxAuthor {
  first_name: string;
  last_name: string;
}

// The LibriVox API uses `false` (boolean) for absent optional fields instead
// of null/undefined.  All fields that might be missing are typed as `| false`
// so the compiler reminds us to guard them before using array/string methods.
interface LibrivoxRaw {
  id: string;
  title: string;
  description: string | false;
  url_zip_file: string;
  url_rss: string;
  totaltimesecs: number;
  authors: LibrivoxAuthor[] | false;
  genres: { name: string }[] | false;
  sections: LibrivoxSection[] | false;
}

function parseDuration(hhmmss: string | undefined | null): number {
  if (!hhmmss) return 0;
  const parts = hhmmss.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function authorName(raw: LibrivoxRaw): string {
  if (!Array.isArray(raw.authors) || raw.authors.length === 0) return 'Unknown';
  const a = raw.authors[0];
  return [a.first_name, a.last_name].filter(Boolean).join(' ');
}

function coverUrl(bookId: string): string {
  return `https://archive.org/services/img/librivox_${bookId}`;
}

function mapBook(raw: LibrivoxRaw): Book {
  const chapters: Chapter[] = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter(s => s.listen_url)
    .map(s => ({
      id: `${raw.id}_${s.section_number}`,
      bookId: raw.id,
      title: s.title || `Chapter ${s.section_number}`,
      audioUrl: s.listen_url,
      duration: parseDuration(s.duration),
    }));

  return {
    id: raw.id,
    title: raw.title,
    author: authorName(raw),
    description: typeof raw.description === 'string'
      ? raw.description.replace(/<[^>]*>/g, '').trim()
      : '',
    coverUrl: coverUrl(raw.id),
    categories: Array.isArray(raw.genres) ? raw.genres.map(g => g.name) : [],
    chapters,
    duration: raw.totaltimesecs,
  };
}

const FIELDS =
  'id,title,description,url_zip_file,url_rss,totaltimesecs,authors,genres,sections';

// Build a query string manually — Hermes does not implement URLSearchParams.set.
function buildQuery(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function apiFetch(
  query: Record<string, string | number>,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const url = `${API_BASE}?${buildQuery(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RSS_TIMEOUT);

  // Chain an external cancel signal (e.g. from libraryStore.searchController)
  // into the internal controller so the fetch is aborted immediately when the
  // caller cancels, rather than waiting for the 8-second timeout.
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBooks(
  params: {
    search?: string;
    genre?: string;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal,
): Promise<Book[]> {
  const query: Record<string, string | number> = {
    format: 'json',
    fields: FIELDS,
    extended: '1',
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
  };
  if (params.search) query.title = `^${params.search}`;
  if (params.genre) query.genre = params.genre;

  const res = await apiFetch(query, signal);
  if (!res.ok) throw new Error(`Librivox API error: ${res.status}`);

  const json = await res.json();
  const books: LibrivoxRaw[] = Array.isArray(json.books) ? json.books : [];
  return books.map(mapBook);
}

export async function fetchBook(id: string, signal?: AbortSignal): Promise<Book | null> {
  const res = await apiFetch(
    { format: 'json', fields: FIELDS, extended: '1', id },
    signal,
  );
  if (!res.ok) return null;

  const json = await res.json();
  const books: LibrivoxRaw[] = Array.isArray(json.books) ? json.books : [];
  return books.length ? mapBook(books[0]) : null;
}
