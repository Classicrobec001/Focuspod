/**
 * introService — where each LibriVox chapter's spoken disclaimer ends.
 *
 * Almost every LibriVox chapter opens with the same notice ("This is a LibriVox
 * recording. All LibriVox recordings are in the public domain…"), 9–24 s long
 * depending on the reader. Hearing it at the top of every chapter is one of the
 * most common complaints about LibriVox listening.
 *
 * The skip points are measured offline, not guessed: a script transcribes each
 * chapter's opening and records the moment "librivox.org" is said
 * (scripts/intro-skips/). The reader credit and chapter title that follow are
 * kept, so the listener still hears who is reading and where they are.
 *
 * Data shape: one small JSON file per book, fetched only when that book plays,
 * so the catalogue can grow without the app's start-up cost growing with it.
 *
 *     <source>/<identifier>.json → {"v": 1, "skips": {"<file base>": seconds}}
 *
 * 0 means "checked, no notice heard". A missing book or chapter means "not
 * checked". Either way the chapter plays from the start — failing safe matters
 * more than coverage, because skipping into the story is worse than not
 * skipping the notice.
 */

import type { Chapter } from '../types';

/** Where the per-book files live. null = this build ships no skip data. */
let source: string | null = null;

const cache = new Map<string, Record<string, number> | null>();
const inflight = new Map<string, Promise<Record<string, number> | null>>();

/** No notice measured so far ended later than ~24 s; anything past this is bad data. */
const MAX_SKIP_SECONDS = 45;

/**
 * Point the service at the skip data. The web build serves it as static files
 * next to the app; a platform without the data simply never calls this.
 */
export function setIntroSource(baseUrl: string | null): void {
  source = baseUrl ? baseUrl.replace(/\/?$/, '/') : null;
  cache.clear();
  inflight.clear();
}

const ARCHIVE_AUDIO = /^https?:\/\/archive\.org\/download\/([^/]+)\/(.+)$/;

/**
 * The book identifier and file key for an archive.org chapter URL, or null for
 * anything else (podcasts). Keyed on the URL rather than the Book so it works
 * identically for a catalogue book, a downloaded copy and a saved single
 * chapter. Must match base_name() in scripts/intro-skips/build_intro_skips.py.
 */
export function introKey(audioUrl: string): { identifier: string; key: string } | null {
  const match = ARCHIVE_AUDIO.exec(audioUrl);
  if (!match) return null;
  try {
    const identifier = decodeURIComponent(match[1]);
    const file = decodeURIComponent(match[2]).split('/').pop() ?? '';
    const key = file.replace(/(_(64|128)kb|_vbr)?\.mp3$/i, '');
    return key ? { identifier, key } : null;
  } catch {
    return null; // malformed escape in the URL
  }
}

/** Fetch (once) the skip table for one book. Never throws. */
export function loadIntroSkips(identifier: string): Promise<Record<string, number> | null> {
  if (!source) return Promise.resolve(null);
  if (cache.has(identifier)) return Promise.resolve(cache.get(identifier) ?? null);
  const pending = inflight.get(identifier);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch(`${source}${encodeURIComponent(identifier)}.json`);
      // 404 is the normal answer for a book that hasn't been processed yet.
      if (!response.ok) {
        cache.set(identifier, null);
        return null;
      }
      const data = (await response.json()) as { v?: number; skips?: Record<string, unknown> };
      const skips: Record<string, number> = {};
      for (const [key, value] of Object.entries(data.skips ?? {})) {
        if (typeof value === 'number' && value >= 0 && value <= MAX_SKIP_SECONDS) skips[key] = value;
      }
      cache.set(identifier, skips);
      return skips;
    } catch {
      // Offline or a bad file: play from the start, and try again next time
      // rather than remembering the failure.
      return null;
    } finally {
      inflight.delete(identifier);
    }
  })();
  inflight.set(identifier, request);
  return request;
}

/**
 * Seconds to start each chapter at — 0 where there is nothing to skip or the
 * chapter hasn't been measured. Same order as `chapters`.
 */
export async function introEndsFor(chapters: Chapter[]): Promise<number[]> {
  const keys = chapters.map(c => introKey(c.audioUrl));
  const identifiers = [...new Set(keys.filter(Boolean).map(k => k!.identifier))];
  const tables = new Map(
    await Promise.all(identifiers.map(async id => [id, await loadIntroSkips(id)] as const)),
  );
  return chapters.map((chapter, i) => {
    const k = keys[i];
    const seconds = k ? (tables.get(k.identifier)?.[k.key] ?? 0) : 0;
    // Never skip most of a very short chapter on the strength of bad data.
    if (chapter.duration > 0 && seconds > chapter.duration / 2) return 0;
    return seconds;
  });
}
