/**
 * webDownloads — DownloadPort backed by the Cache Storage API.
 *
 * Chapters are stored as whole Responses under a synthetic key. Cache Storage
 * is the right home for them rather than IndexedDB: it stores Response bodies
 * without deserialising them, has no practical per-entry size limit, and counts
 * against the same origin quota the user can inspect and clear.
 *
 * Cached entries are not addressable by a normal URL, so resolveUrl() returns a
 * `focuspod-cache:` pseudo-URL. WebAudioPort recognises the scheme and turns it
 * into a blob URL for the one chapter that is actually playing.
 */

import type { Chapter, DownloadPort } from '@focuspod/core';

const CACHE_NAME = 'focuspod-audio-v1';
export const CACHE_URL_SCHEME = 'focuspod-cache:';

/** Minimum gap between download-progress callbacks. */
const PROGRESS_INTERVAL_MS = 250;

function cacheKey(bookId: string, chapterId: string): string {
  // A same-origin path keeps Cache Storage happy; it is never fetched.
  return `/__focuspod_audio__/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}`;
}

function pseudoUrl(bookId: string, chapterId: string): string {
  return `${CACHE_URL_SCHEME}${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}`;
}

function parsePseudoUrl(url: string): { bookId: string; chapterId: string } | null {
  if (!url.startsWith(CACHE_URL_SCHEME)) return null;
  const [bookId, chapterId] = url.slice(CACHE_URL_SCHEME.length).split('/');
  if (!bookId || !chapterId) return null;
  return { bookId: decodeURIComponent(bookId), chapterId: decodeURIComponent(chapterId) };
}

async function openCache(): Promise<Cache | null> {
  if (!('caches' in globalThis)) return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // Private browsing in some engines disallows Cache Storage entirely.
    return null;
  }
}

/** Used by WebAudioPort to turn a `focuspod-cache:` URL into playable bytes. */
export async function readCachedChapter(url: string): Promise<Blob | null> {
  const parsed = parsePseudoUrl(url);
  if (!parsed) return null;
  const cache = await openCache();
  if (!cache) return null;
  const response = await cache.match(cacheKey(parsed.bookId, parsed.chapterId));
  return response ? await response.blob() : null;
}

/**
 * Ask the browser to exempt our storage from eviction under disk pressure.
 * Without this, downloaded books are "best effort" and can vanish silently.
 * Chromium grants it based on engagement heuristics; Firefox prompts; Safari
 * ignores it. Failure is non-fatal — loadSaved() re-verifies what survived.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export class WebDownloadPort implements DownloadPort {
  async resolveUrl(bookId: string, chapterId: string, remoteUrl: string): Promise<string> {
    return (await this.isChapterDownloaded(bookId, chapterId))
      ? pseudoUrl(bookId, chapterId)
      : remoteUrl;
  }

  async isChapterDownloaded(bookId: string, chapterId: string): Promise<boolean> {
    const cache = await openCache();
    if (!cache) return false;
    return (await cache.match(cacheKey(bookId, chapterId))) !== undefined;
  }

  async downloadChapter(
    bookId: string,
    chapter: Chapter,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const cache = await openCache();
    if (!cache) throw new Error('Offline storage is unavailable in this browser.');

    const response = await fetch(chapter.audioUrl, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Could not download "${chapter.title}" (${response.status})`);
    }

    // Content-Length is present on archive.org responses; without it we still
    // download correctly but can only report indeterminate progress.
    const total = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    // A chapter arrives in thousands of chunks. Reporting each one would push a
    // store update — and a full re-render — per chunk, which starves the read
    // loop badly enough to stall the download outright. Report on a time budget
    // instead; the bar still moves smoothly.
    let lastReportAt = 0;
    const report = (fraction: number, force = false) => {
      const now = performance.now();
      if (!force && now - lastReportAt < PROGRESS_INTERVAL_MS) return;
      lastReportAt = now;
      onProgress(fraction);
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal.aborted) {
          throw Object.assign(new Error('Download cancelled'), { name: 'AbortError' });
        }
        chunks.push(value);
        received += value.length;
        if (total > 0) report(received / total);
      }
    } finally {
      reader.releaseLock();
    }

    const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
    try {
      await cache.put(
        cacheKey(bookId, chapter.id),
        new Response(blob, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(blob.size),
          },
        }),
      );
    } catch (error) {
      // QuotaExceededError is the common case here and deserves a message the
      // user can act on rather than a raw DOMException.
      if ((error as Error)?.name === 'QuotaExceededError') {
        throw new Error('Not enough space. Delete a downloaded book and try again.');
      }
      throw error;
    }
    onProgress(1);
  }

  async deleteBook(bookId: string, chapterIds: string[]): Promise<void> {
    const cache = await openCache();
    if (!cache) return;
    await Promise.all(chapterIds.map(id => cache.delete(cacheKey(bookId, id))));
  }

  async usage(): Promise<{ usedBytes: number; quotaBytes: number | null }> {
    if (!navigator.storage?.estimate) return { usedBytes: 0, quotaBytes: null };
    const { usage, quota } = await navigator.storage.estimate();
    return { usedBytes: usage ?? 0, quotaBytes: quota ?? null };
  }
}

export const webDownloads = new WebDownloadPort();
