/**
 * readAlongStore — the printed text shown alongside playback.
 *
 * Position is an *estimate*. LibriVox publishes no word or line timings, so
 * there is nothing to sync against: the only available signal is how far
 * through the recording you are. Mapping elapsed time onto the text linearly
 * tracks a plain reading closely and drifts around intros, music and long
 * pauses. The reader can always scroll, and doing so takes over from the
 * estimate until they ask to follow again.
 */

import { create } from 'zustand';
import { Book } from '../types';
import {
  BookText,
  TextSection,
  fetchBookText,
  parseChapterNumber,
} from '../services/textService';
import { isAbortError, isNetworkError } from '../utils/errors';

interface ReadAlongState {
  bookId: string | null;
  text: BookText | null;
  isLoading: boolean;
  /** Set when no open edition could be found — a normal outcome, not a fault. */
  unavailable: boolean;
  error: string | null;
  /** Paragraph index at the top of the view. */
  cursor: number;
  /** Whether the view follows playback or the reader is scrolling themselves. */
  following: boolean;
  /** Audio chapter -> paragraph span. Built once per book. */
  alignment: Array<{ start: number; end: number }> | null;
  /** How the text was matched to the recording, shown to the reader. */
  alignmentQuality: 'chapter' | 'approximate' | null;

  load: (book: Book) => Promise<void>;
  /** Move the view by whole paragraphs; stops following. */
  scrollBy: (delta: number) => void;
  setFollowing: (following: boolean) => void;
  /** Re-centre on the estimated position and resume following. */
  syncTo: (fraction: number) => void;
  /** Re-centre using chapter alignment, which is far more accurate. */
  syncToChapter: (book: Book, chapterIndex: number, positionInChapter: number) => void;
  reset: () => void;
}

let controller: AbortController | null = null;

export const useReadAlongStore = create<ReadAlongState>((set, get) => ({
  bookId: null,
  text: null,
  isLoading: false,
  unavailable: false,
  error: null,
  cursor: 0,
  following: true,
  alignment: null,
  alignmentQuality: null,

  load: async (book: Book) => {
    if (get().bookId === book.id && (get().text || get().unavailable)) return;

    controller?.abort();
    controller = new AbortController();
    set({
      bookId: book.id,
      text: null,
      isLoading: true,
      unavailable: false,
      error: null,
      cursor: 0,
      following: true,
      alignment: null,
      alignmentQuality: null,
    });

    try {
      const text = await fetchBookText(book, controller.signal);
      if (get().bookId !== book.id) return; // superseded by another book
      if (!text) {
        set({ unavailable: true, isLoading: false });
        return;
      }
      // Build the mapping once here rather than on every progress tick.
      const alignment = buildAlignment(book, text);
      const quality: 'chapter' | 'approximate' =
        text.sections.length > 0 ? 'chapter' : 'approximate';
      set({ text, alignment, alignmentQuality: quality, isLoading: false });
    } catch (e) {
      if (isAbortError(e)) return;
      set({
        isLoading: false,
        error: isNetworkError(e)
          ? 'Text needs a connection the first time you open it.'
          : 'Could not load the text for this book.',
      });
    }
  },

  scrollBy: delta => {
    const { text, cursor } = get();
    if (!text) return;
    const next = Math.max(0, Math.min(text.paragraphs.length - 1, cursor + delta));
    set({ cursor: next, following: false });
  },

  setFollowing: following => set({ following }),

  syncToChapter: (book, chapterIndex, positionInChapter) => {
    const { text, alignment } = get();
    if (!text) return;
    set({
      cursor: estimateParagraph(book, text, chapterIndex, positionInChapter, alignment ?? undefined),
      following: true,
    });
  },

  syncTo: fraction => {
    const { text } = get();
    if (!text) return;
    // Weight by characters rather than paragraph count so long paragraphs take
    // proportionally longer, which is closer to how the reading actually runs.
    const target = Math.max(0, Math.min(1, fraction)) * text.length;
    let seen = 0;
    for (let i = 0; i < text.paragraphs.length; i++) {
      seen += text.paragraphs[i].length;
      if (seen >= target) {
        set({ cursor: i, following: true });
        return;
      }
    }
    set({ cursor: text.paragraphs.length - 1, following: true });
  },

  reset: () => {
    controller?.abort();
    controller = null;
    set({
      bookId: null,
      text: null,
      isLoading: false,
      unavailable: false,
      error: null,
      cursor: 0,
      following: true,
      alignment: null,
      alignmentQuality: null,
    });
  },
}));

/**
 * How far through the whole book the playhead is, from the chapter index and
 * position within it. Chapter durations come from the catalog, so this needs no
 * network and works for a downloaded book.
 */
export function bookFraction(
  book: Book,
  chapterIndex: number,
  positionInChapter: number,
): number {
  const total = book.chapters.reduce((sum, c) => sum + (c.duration || 0), 0);
  if (total <= 0) return 0;
  const before = book.chapters
    .slice(0, chapterIndex)
    .reduce((sum, c) => sum + (c.duration || 0), 0);
  return Math.max(0, Math.min(1, (before + positionInChapter) / total));
}

// ─── Aligning the recording to the page ───────────────────────────────────

/**
 * Chapter numbers announced by an audio chapter's title.
 *
 * LibriVox names sections after what they contain, and one recorded section
 * often covers several printed chapters — "1 Laying Plans - 2 Waging War"
 * spans two. Reading the numbers out is what lets a section be matched to the
 * right span of text rather than guessed at.
 */
export function audioChapterNumbers(title: string): number[] {
  const numbers: number[] = [];
  const pattern = /(?:^|[\s\-–—(])(?:chapter|chap\.?|part|book|section)?\s*([0-9]{1,3}|[IVXLCDM]{1,7})(?=[\s.:,\-–—)]|$)/gi;
  for (const match of title.matchAll(pattern)) {
    const value = parseChapterNumber(match[1]);
    // Above ~200 it is a year or a page reference, not a chapter.
    if (value !== null && value > 0 && value <= 200) numbers.push(value);
  }
  return [...new Set(numbers)];
}

/** Places an unmatched chapter evenly between the nearest matched neighbours. */
function interpolateAnchor(
  anchors: Array<number | null>,
  index: number,
  bodyStart: number,
  total: number,
): number {
  let before = index - 1;
  while (before >= 0 && anchors[before] === null) before--;
  let after = index + 1;
  while (after < anchors.length && anchors[after] === null) after++;

  const from = before >= 0 ? anchors[before]! : bodyStart;
  const to = after < anchors.length ? anchors[after]! : total;
  const steps = after - before;
  return Math.round(from + ((to - from) * (index - before)) / Math.max(1, steps));
}

/** Significant words of a title, for comparing an audio chapter to a heading. */
function titleWords(raw: string): string[] {
  return raw
    .toLowerCase()
    // Drop the production prefixes LibriVox adds: "01 - ", "Part 2", "Chapter 4".
    .replace(/^[\s\d\-–—.]+/, '')
    .replace(/\b(?:chapter|chap|part|section|book|pt)\b\.?\s*[\divxlcdm]*/gi, ' ')
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'his', 'her', 'its',
  'was', 'were', 'are', 'has', 'had', 'you', 'not', 'but', 'all', 'one', 'two',
]);

/** Fraction of the title's words that appear in the candidate paragraph. */
function titleOverlap(title: string[], paragraph: string): number {
  if (title.length === 0) return 0;
  const words = new Set(paragraph.toLowerCase().match(/[a-z']{3,}/g) ?? []);
  let hits = 0;
  for (const word of title) if (words.has(word)) hits++;
  return hits / title.length;
}

/**
 * Maps each audio chapter onto a span of text paragraphs.
 *
 * Four strategies, strongest first:
 *
 *  1. Match each audio chapter's *title* to a heading in the text, scanning
 *     forward only so matches stay in order. This is the most reliable signal
 *     by a distance: LibriVox names sections after the chapter or story they
 *     contain ("A Scandal in Bohemia", "Laying Plans"), and titles survive
 *     editions that renumber or omit chapters.
 *  2. Match the numbers announced in the title to numbered headings.
 *  3. If the counts line up, map chapter *i* to section *i*.
 *  4. Otherwise spread the audio proportionally over the body, skipping front
 *     matter.
 *
 * The point of 1–3 is that error is bounded *within* a chapter instead of
 * accumulating across the whole book, which is what made the old whole-book
 * estimate drift so badly by the later chapters.
 */
export function buildAlignment(
  book: Book,
  text: BookText,
): Array<{ start: number; end: number }> {
  return enforceForward(buildAlignmentRaw(book, text), text.paragraphs.length);
}

/**
 * Last line of defence: a reader must never go backwards as the audio moves
 * forwards. Any strategy that produces a non-advancing map has misread the
 * book, and jumping back mid-chapter is the single most disorienting thing this
 * screen can do — worse than being a little off.
 */
function enforceForward(
  spans: Array<{ start: number; end: number }>,
  total: number,
): Array<{ start: number; end: number }> {
  let floor = 0;
  return spans.map(span => {
    const start = Math.max(floor, Math.min(span.start, total - 1));
    const end = Math.max(start + 1, Math.min(span.end, total));
    floor = start;
    return { start, end };
  });
}

function buildAlignmentRaw(
  book: Book,
  text: BookText,
): Array<{ start: number; end: number }> {
  const chapterCount = book.chapters.length;
  const { sections, paragraphs, bodyStart } = text;

  const proportional = (index: number) => {
    const span = paragraphs.length - bodyStart;
    return {
      start: bodyStart + Math.floor((span * index) / chapterCount),
      end: bodyStart + Math.floor((span * (index + 1)) / chapterCount),
    };
  };

  // Strategy 1 — anchor on chapter titles, scanning forward only.
  const anchors: Array<number | null> = [];
  let searchFrom = bodyStart;
  let anchored = 0;
  for (const chapter of book.chapters) {
    const words = titleWords(chapter.title);
    let best: { index: number; score: number } | null = null;
    if (words.length >= 2) {
      for (let i = searchFrom; i < paragraphs.length; i++) {
        // Headings are short. Scoring long prose would match any paragraph that
        // happens to reuse the title's words.
        if (paragraphs[i].length > 120) continue;
        const score = titleOverlap(words, paragraphs[i]);
        if (score >= 0.6 && (!best || score > best.score)) {
          best = { index: i, score };
          if (score === 1) break;
        }
      }
    }
    if (best) {
      anchors.push(best.index);
      searchFrom = best.index + 1;
      anchored++;
    } else {
      anchors.push(null);
    }
  }

  // A third is enough to pin the shape of the book. Recordings routinely split
  // one chapter across several files ("A Scandal in Bohemia, Part 1/2"), and
  // only the first part carries a findable title — demanding a high hit rate
  // would reject exactly the books this strategy handles best.
  if (anchored >= Math.max(2, Math.ceil(chapterCount * 0.33))) {
    return anchors.map((start, i) => {
      const from = start ?? interpolateAnchor(anchors, i, bodyStart, paragraphs.length);
      let nextIndex = i + 1;
      while (nextIndex < chapterCount && anchors[nextIndex] === null) nextIndex++;
      const to =
        nextIndex < chapterCount
          ? anchors[nextIndex]!
          : paragraphs.length;
      return { start: from, end: Math.max(from + 1, to) };
    });
  }

  if (sections.length === 0) {
    return book.chapters.map((_, i) => proportional(i));
  }

  const byNumber = new Map<number, TextSection>();
  for (const section of sections) {
    if (section.number !== null && !byNumber.has(section.number)) {
      byNumber.set(section.number, section);
    }
  }

  // Strategy 1 — match on announced chapter numbers.
  const matched = book.chapters.map(chapter => {
    const numbers = audioChapterNumbers(chapter.title).filter(n => byNumber.has(n));
    if (numbers.length === 0) return null;
    const first = byNumber.get(Math.min(...numbers))!;
    const last = byNumber.get(Math.max(...numbers))!;
    return { start: first.start, end: last.end };
  });

  const hits = matched.filter(Boolean) as Array<{ start: number; end: number }>;
  const matchedCount = hits.length;
  // Matches must advance through the book and land in distinct places. Without
  // this, a book whose text has only a few numbered divisions but whose audio
  // titles are full of small numbers ("Part 1", "Part 2") matches them all onto
  // the same two or three sections — 24 chapters collapsing onto one paragraph.
  const advancing = hits.every((h, i) => i === 0 || h.start > hits[i - 1].start);
  const distinct = new Set(hits.map(h => h.start)).size;

  if (
    matchedCount >= Math.max(3, Math.ceil(chapterCount * 0.6)) &&
    advancing &&
    distinct >= matchedCount * 0.9
  ) {
    // Fill the gaps by interpolating between the neighbours that did match, so
    // an unmatched chapter still lands in roughly the right place.
    return matched.map((span, i) => {
      if (span) return span;
      let before = i - 1;
      while (before >= 0 && !matched[before]) before--;
      let after = i + 1;
      while (after < chapterCount && !matched[after]) after++;
      const from = before >= 0 ? matched[before]!.end : bodyStart;
      const to = after < chapterCount ? matched[after]!.start : paragraphs.length;
      const steps = after - before;
      const width = Math.max(1, Math.floor((to - from) / Math.max(1, steps - 1)));
      const start = from + width * (i - before - 1);
      return { start, end: Math.min(to, start + width) };
    });
  }

  // Strategy 2 — equal counts, so assume they correspond in order.
  if (sections.length === chapterCount) {
    return sections.map(s => ({ start: s.start, end: s.end }));
  }

  // Strategy 3 — proportional over the body.
  return book.chapters.map((_, i) => proportional(i));
}

/**
 * The paragraph the narrator is most likely on: locate the chapter's span,
 * then interpolate within it by how far through that chapter the audio is.
 */
export function estimateParagraph(
  book: Book,
  text: BookText,
  chapterIndex: number,
  positionInChapter: number,
  alignment?: Array<{ start: number; end: number }>,
): number {
  const spans = alignment ?? buildAlignment(book, text);
  const span = spans[chapterIndex];
  if (!span) return 0;

  const duration = book.chapters[chapterIndex]?.duration || 0;
  const through = duration > 0 ? Math.max(0, Math.min(1, positionInChapter / duration)) : 0;
  const width = Math.max(0, span.end - span.start - 1);
  return Math.max(0, Math.min(text.paragraphs.length - 1, span.start + Math.round(width * through)));
}
