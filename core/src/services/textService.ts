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

/** A detected chapter in the printed text. */
export interface TextSection {
  heading: string;
  /** Chapter number when one could be read from the heading. */
  number: number | null;
  /** Paragraph index of the heading. */
  start: number;
  /** Paragraph index after the last paragraph of this section. */
  end: number;
}

export interface BookText {
  /** Archive identifier the text came from, for attribution. */
  identifier: string;
  /** 'gutenberg' (clean transcription) or 'scan' (OCR, may contain errors). */
  quality: 'gutenberg' | 'scan';
  paragraphs: string[];
  /** Total characters, used to estimate reading position. */
  length: number;
  /** Chapters found in the text. Empty when none could be detected. */
  sections: TextSection[];
  /**
   * Paragraph index where the book proper begins. Everything before it is
   * front matter — title page, dedication, translator's preface — which the
   * narrator usually skips and which otherwise skews the whole estimate.
   */
  bodyStart: number;
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

// ─── Chapter detection ────────────────────────────────────────────────────

const ROMAN = /^[IVXLCDM]+$/i;
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

function romanToInt(roman: string): number | null {
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const upper = roman.toUpperCase();
  let total = 0;
  for (let i = 0; i < upper.length; i++) {
    const current = values[upper[i]];
    const next = values[upper[i + 1]];
    if (current === undefined) return null;
    total += next && next > current ? -current : current;
  }
  return total > 0 && total < 400 ? total : null;
}

/** Reads a chapter number from "IV", "12", "Seven" or a bare numeral. */
export function parseChapterNumber(token: string): number | null {
  const clean = token.trim().replace(/[.:—–-]+$/, '');
  if (/^\d{1,3}$/.test(clean)) return Number(clean);
  if (ROMAN.test(clean)) return romanToInt(clean);
  const word = WORD_NUMBERS[clean.toLowerCase()];
  return word ?? null;
}

/**
 * Headings are short lines that announce a chapter. Kept deliberately strict:
 * a false heading in the middle of prose would split a section and throw the
 * alignment off worse than having no sections at all.
 */
const HEADING_PATTERNS: RegExp[] = [
  // "Chapter IV", "BOOK 2", "Canto the First" — the word makes it unambiguous.
  /^(?:chapter|chap\.?|letter|canto|book|part|act|scene|stave|lecture)\s+([0-9]{1,3}|[ivxlcdm]+|[a-z]+)\b/i,
  // "IV. TACTICAL DISPOSITIONS" — a numeral followed by a short title. The
  // trailing anchor is what keeps it from swallowing "I. Sun Tzu said: ..."
  // and every other numbered line of prose.
  /^([ivxlcdm]{1,7})[.:]?\s+[A-Z][A-Za-z'’\- ]{2,60}$/,
  // A numeral alone on its own line.
  /^([ivxlcdm]{1,7})\.?$/i,
  /^([0-9]{1,3})\.?$/,
];

/**
 * Deliberately does NOT treat "3. Some prose…" as a heading.
 *
 * Numbered verses and paragraphs are everywhere in translated and scriptural
 * texts — The Art of War is numbered throughout — and matching them produced 66
 * "chapters" in a 13-chapter book, which threw the alignment off by hundreds of
 * paragraphs. A heading has to be a short standalone line.
 */
function detectHeading(paragraph: string): { number: number | null } | null {
  if (paragraph.length > 90) return null;
  for (const pattern of HEADING_PATTERNS) {
    const match = paragraph.match(pattern);
    if (match) return { number: parseChapterNumber(match[1] ?? '') };
  }
  return null;
}

/**
 * Chapter numbers should climb. If the detected ones don't, the detector has
 * latched onto something that merely looks like numbering, and the numbers are
 * worse than useless — they would actively mis-map chapters. Dropping them
 * falls back to order-based or proportional alignment, which degrade gracefully.
 */
function numbersLookLikeChapters(sections: TextSection[]): boolean {
  const numbered = sections.filter(s => s.number !== null);
  if (numbered.length < 3) return false;
  let ascending = 0;
  for (let i = 1; i < numbered.length; i++) {
    if (numbered[i].number! > numbered[i - 1].number!) ascending++;
  }
  // Allow a few resets for books divided into parts, but the trend must hold.
  return ascending / (numbered.length - 1) >= 0.8 && numbered[0].number! <= 3;
}

function detectSections(paragraphs: string[]): TextSection[] {
  const found: Array<{ heading: string; number: number | null; start: number }> = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const heading = detectHeading(paragraphs[i]);
    if (heading) found.push({ heading: paragraphs[i], number: heading.number, start: i });
  }

  // Gutenberg texts repeat every chapter heading in a table of contents. Those
  // copies sit close together near the front; the real ones are spread through
  // the book. Dropping runs of headings with almost no prose between them
  // removes the contents block without needing to recognise it.
  const spaced = found.filter((section, i) => {
    const next = found[i + 1];
    return !next || next.start - section.start > 2;
  });

  const sections = spaced.map((section, i) => ({
    heading: section.heading,
    number: section.number,
    start: section.start,
    end: spaced[i + 1]?.start ?? paragraphs.length,
  }));

  // Keep the numbering only when it behaves like chapter numbering.
  return numbersLookLikeChapters(sections)
    ? sections
    : sections.map(s => ({ ...s, number: null }));
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

        const sections = detectSections(paragraphs);
        return {
          identifier,
          quality,
          paragraphs,
          length: paragraphs.reduce((total, p) => total + p.length, 0),
          sections,
          // Anything before the first chapter is front matter the narrator
          // generally doesn't read.
          bodyStart: sections[0]?.start ?? 0,
        };
      }
    }
    return null;
  }, signal);
}
