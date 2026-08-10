/**
 * textService — finds the printed text of a book so it can be read while it
 * plays.
 *
 * Where the text comes from
 * ─────────────────────────
 * Not from the LibriVox audio item: its only text files are OCR of the CD
 * insert and are usually empty. Not from gutenberg.org either — it sends no
 * CORS headers, so a browser cannot read it.
 *
 * The Internet Archive mirrors Project Gutenberg (identifiers ending `gut`) and
 * serves it with `access-control-allow-origin: *`. That is the same source
 * LibriVox volunteers read from, so the wording matches the recording rather
 * than being a different edition, and it is clean text rather than OCR. Scanned
 * public-domain books are the fallback.
 *
 * What this cannot do
 * ───────────────────
 * There is no word- or line-level timing data anywhere in LibriVox, so this
 * cannot highlight the current word the way a lyrics view does. Position is
 * estimated from elapsed time against total duration, which tracks a straight
 * reading well and drifts around long pauses, music, or per-chapter intros.
 * The UI presents it as an estimate and lets the reader take over by scrolling.
 */

import { Book } from '../types';

const SEARCH_URL = 'https://archive.org/advancedsearch.php';
const METADATA_URL = 'https://archive.org/metadata';
const DOWNLOAD_URL = 'https://archive.org/download';
const REQUEST_TIMEOUT_MS = 20_000;
/** Below this a "book" file is a blurb, a table of contents or an empty OCR. */
const MIN_TEXT_BYTES = 20_000;
/** Guards against pulling a 20 MB concordance into a phone's memory. */
const MAX_TEXT_BYTES = 3_000_000;

export interface BookText {
  /** Archive identifier the text came from, for attribution. */
  identifier: string;
  /** 'gutenberg' (clean transcription) or 'scan' (OCR, may contain errors). */
  quality: 'gutenberg' | 'scan';
  paragraphs: string[];
  /** Total characters, used to estimate reading position. */
  length: number;
}

// ─── Requests ─────────────────────────────────────────────────────────────

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function queryString(params: Array<[string, string | number]>): string {
  return params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** Archive search treats these as syntax; a title containing them must escape. */
function escapeLucene(term: string): string {
  return term.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

/**
 * LibriVox titles carry production suffixes the printed edition never has.
 * Stripping them is what makes the title match a catalogue record at all.
 */
function normaliseTitle(title: string): string {
  return title
    .replace(/\((dramatic reading|version \d+|abridged|unabridged)[^)]*\)/gi, '')
    .replace(/\b(version|dramatic reading)\s*\d*\b/gi, '')
    .replace(/[,:;].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Candidate selection ──────────────────────────────────────────────────

interface ArchiveFile {
  name: string;
  format?: string;
  size?: string;
}

/**
 * Gutenberg mirrors bundle a readme, a licence and sometimes an index next to
 * the book. Picking the largest plain-text file that isn't one of those is what
 * separates the novel from its packaging.
 */
const NON_BOOK_FILE = /readme|licen[cs]e|index|_meta|cover|notes?\b|errata/i;

function pickTextFile(files: ArchiveFile[]): ArchiveFile | null {
  const candidates = files
    .filter(f => f.name.toLowerCase().endsWith('.txt'))
    .filter(f => !NON_BOOK_FILE.test(f.name))
    .filter(f => {
      const size = Number(f.size ?? 0);
      return size >= MIN_TEXT_BYTES && size <= MAX_TEXT_BYTES;
    });
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
}

async function searchIdentifiers(query: string, signal: AbortSignal): Promise<string[]> {
  const url =
    `${SEARCH_URL}?` +
    queryString([
      ['q', query],
      ['fl[]', 'identifier'],
      ['rows', 6],
      ['page', 1],
      ['output', 'json'],
    ]);
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as { response?: { docs?: Array<{ identifier: string }> } };
  return (json.response?.docs ?? []).map(d => d.identifier).filter(Boolean);
}

// ─── Text cleaning ────────────────────────────────────────────────────────

/**
 * Project Gutenberg wraps every text in a licence header and footer. Left in,
 * the reader opens on several pages of legal text instead of the book.
 */
function stripGutenbergBoilerplate(raw: string): string {
  let text = raw;
  const start = text.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (start !== -1) {
    text = text.slice(text.indexOf('***', start + 3) + 3);
    const nl = text.indexOf('\n');
    if (nl !== -1) text = text.slice(nl);
  }
  const end = text.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (end !== -1) text = text.slice(0, end);
  return text;
}

function toParagraphs(raw: string): string[] {
  return (
    stripGutenbergBoilerplate(raw)
      .replace(/\r\n?/g, '\n')
      // Hard-wrapped lines: join within a paragraph, keep the blank-line breaks.
      .split(/\n{2,}/)
      .map(block => block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(block => block.length > 0)
      // Plain-text editions use rules of dashes, asterisks or underscores as
      // dividers. As paragraphs they are just noise in a small reading window.
      .filter(block => /[A-Za-z0-9]/.test(block.replace(/[-=_*~.\s]/g, '')))
  );
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Locates and downloads the printed text for a book. Returns null when no
 * freely-readable edition can be found — which is a normal outcome, not an
 * error: plenty of LibriVox recordings have no matching open text.
 */
export async function fetchBookText(
  book: Book,
  signal?: AbortSignal,
): Promise<BookText | null> {
  const title = escapeLucene(normaliseTitle(book.title));
  if (!title) return null;
  const author =
    book.author && book.author !== 'Unknown' ? escapeLucene(book.author.split(',')[0].trim()) : '';

  // Gutenberg first: clean transcription of the same edition the narrator read.
  // Scans are OCR and only worth falling back to.
  const queries: Array<{ q: string; quality: BookText['quality'] }> = [
    { q: `collection:gutenberg AND title:("${title}")`, quality: 'gutenberg' },
    {
      q:
        `mediatype:texts AND format:"DjVuTXT" AND title:("${title}")` +
        (author ? ` AND creator:("${author}")` : '') +
        ' AND -access-restricted-item:true',
      quality: 'scan',
    },
  ];

  return withTimeout(async innerSignal => {
    for (const { q, quality } of queries) {
      const identifiers = await searchIdentifiers(q, innerSignal);

      for (const identifier of identifiers) {
        const metaRes = await fetch(`${METADATA_URL}/${encodeURIComponent(identifier)}`, {
          signal: innerSignal,
        });
        if (!metaRes.ok) continue;
        const meta = (await metaRes.json()) as {
          metadata?: { 'access-restricted-item'?: string | boolean };
          files?: ArchiveFile[];
        };

        // Lending-restricted items answer downloads with an HTML error page,
        // so they must be filtered out here rather than discovered mid-read.
        const restricted = meta.metadata?.['access-restricted-item'];
        if (restricted === true || restricted === 'true') continue;

        const file = pickTextFile(meta.files ?? []);
        if (!file) continue;

        const textRes = await fetch(
          `${DOWNLOAD_URL}/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`,
          { signal: innerSignal },
        );
        if (!textRes.ok) continue;
        // A restriction missed above comes back as an HTML page with a 200.
        const contentType = textRes.headers.get('Content-Type') ?? '';
        if (contentType.includes('html')) continue;

        const paragraphs = toParagraphs(await textRes.text());
        if (paragraphs.length < 10) continue;

        return {
          identifier,
          quality,
          paragraphs,
          length: paragraphs.reduce((total, p) => total + p.length, 0),
        };
      }
    }
    return null;
  }, signal);
}
