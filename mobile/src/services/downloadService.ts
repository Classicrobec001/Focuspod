/**
 * downloadService — chapter-level MP3 downloads using react-native-fs.
 *
 * File layout on device:
 *   {DocumentDirectoryPath}/focuspod_books/{bookId}/{chapterId}.mp3
 *
 * Each chapter is downloaded individually so:
 *   • Progress can be reported per-chapter.
 *   • Partial downloads survive app restarts (re-download only missing chapters).
 *   • Playback can start on chapter 1 while later chapters are still downloading.
 *
 * NOTE: react-native-fs uses module.exports (CJS default), NOT named exports.
 * Always import as the default object to avoid named-import interop issues on Hermes.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RNFS = require('react-native-fs');

import { Book, Chapter } from '../types';

// ─── Verify the native module is available ────────────────────────────────────
// Logged once at module load time so the first logcat session shows it.
console.log(
  '[Download] RNFS module type:', typeof RNFS,
  '| DocumentDirectoryPath:', RNFS?.DocumentDirectoryPath ?? 'MISSING',
  '| downloadFile type:', typeof RNFS?.downloadFile,
  '| mkdir type:', typeof RNFS?.mkdir,
  '| exists type:', typeof RNFS?.exists,
);

const DocumentDirectoryPath: string = RNFS.DocumentDirectoryPath;
const BOOKS_DIR = `${DocumentDirectoryPath}/focuspod_books`;

// ─── Path helpers ─────────────────────────────────────────────────────────────

export function bookDir(bookId: string): string {
  return `${BOOKS_DIR}/${bookId}`;
}

export function chapterPath(bookId: string, chapterId: string): string {
  return `${bookDir(bookId)}/${chapterId}.mp3`;
}

/** file:// URI suitable for react-native-track-player */
export function chapterFileUri(bookId: string, chapterId: string): string {
  return `file://${chapterPath(bookId, chapterId)}`;
}

// ─── Existence checks ─────────────────────────────────────────────────────────

export async function isChapterDownloaded(bookId: string, chapterId: string): Promise<boolean> {
  try {
    return await RNFS.exists(chapterPath(bookId, chapterId));
  } catch {
    return false;
  }
}

export async function isBookFullyDownloaded(book: Book): Promise<boolean> {
  if (book.chapters.length === 0) return false;
  const checks = await Promise.all(
    book.chapters.map((ch: Chapter) => isChapterDownloaded(book.id, ch.id)),
  );
  return checks.every(Boolean);
}

// ─── Active download jobs ─────────────────────────────────────────────────────
// Keyed by chapterId so we can cancel individual chapters.

const activeJobIds = new Map<string, number>();

// ─── Ensure a directory exists ────────────────────────────────────────────────

async function ensureDir(dir: string): Promise<void> {
  try {
    const dirExists: boolean = await RNFS.exists(dir);
    console.log(`[Download] ensureDir: path="${dir}" exists=${dirExists}`);
    if (!dirExists) {
      await RNFS.mkdir(dir);
      console.log(`[Download] ensureDir: created "${dir}"`);
    }
  } catch (e: any) {
    console.error(`[Download] ensureDir ERROR: path="${dir}" ${e?.name} ${e?.message}`);
    throw e;
  }
}

// ─── Download a single chapter ────────────────────────────────────────────────

export async function downloadChapter(
  book: Book,
  chapter: Chapter,
  onProgress: (chapterId: string, fraction: number) => void,
): Promise<string> {
  const toFile = chapterPath(book.id, chapter.id);
  console.log(
    `[Download] downloadChapter START` +
    ` | bookId=${book.id}` +
    ` | chapterId=${chapter.id}` +
    ` | url=${chapter.audioUrl}` +
    ` | toFile=${toFile}`,
  );

  // Skip if already on disk.
  let alreadyExists = false;
  try {
    alreadyExists = await RNFS.exists(toFile);
  } catch (e: any) {
    console.warn(`[Download] exists() check failed: ${e?.message}`);
  }

  if (alreadyExists) {
    console.log(`[Download] downloadChapter: file already on disk, skipping`);
    onProgress(chapter.id, 1);
    return toFile;
  }

  // Ensure the book directory exists before writing.
  await ensureDir(bookDir(book.id));

  console.log(`[Download] calling RNFS.downloadFile...`);

  let jobId: number;
  let promise: Promise<{ statusCode: number; bytesWritten: number }>;
  try {
    const result = RNFS.downloadFile({
      fromUrl: chapter.audioUrl,
      toFile,
      readTimeout: 30_000,
      connectionTimeout: 15_000,
      begin: (res: { statusCode: number; contentLength: number }) => {
        console.log(
          `[Download] download began: jobId=${jobId}` +
          ` statusCode=${res.statusCode}` +
          ` contentLength=${res.contentLength}`,
        );
      },
      progress: (res: { contentLength: number; bytesWritten: number }) => {
        if (res.contentLength > 0) {
          onProgress(chapter.id, res.bytesWritten / res.contentLength);
        }
      },
      progressDivider: 5,
    });
    jobId = result.jobId;
    promise = result.promise;
  } catch (e: any) {
    console.error(`[Download] RNFS.downloadFile() threw immediately: ${e?.name} ${e?.message}`);
    throw e;
  }

  console.log(`[Download] downloadFile jobId=${jobId}`);
  activeJobIds.set(chapter.id, jobId);

  try {
    const res = await promise;
    activeJobIds.delete(chapter.id);
    console.log(
      `[Download] chapter done: jobId=${jobId}` +
      ` statusCode=${res.statusCode}` +
      ` bytesWritten=${res.bytesWritten}`,
    );
    if (res.statusCode !== 200) {
      await RNFS.unlink(toFile).catch(() => {});
      throw new Error(`HTTP ${res.statusCode} downloading "${chapter.title}"`);
    }
    onProgress(chapter.id, 1);
    return toFile;
  } catch (e: any) {
    activeJobIds.delete(chapter.id);
    console.error(
      `[Download] downloadChapter FAILED: jobId=${jobId}` +
      ` name=${e?.name} message=${e?.message}`,
    );
    await RNFS.unlink(toFile).catch(() => {}); // remove partial file
    throw e;
  }
}

// ─── Download all chapters sequentially ──────────────────────────────────────

export async function downloadBook(
  book: Book,
  onChapterProgress: (chapterId: string, fraction: number) => void,
  onChapterDone: (chapterId: string, localPath: string) => void,
  signal: AbortSignal,
): Promise<void> {
  console.log(
    `[Download] downloadBook: bookId=${book.id}` +
    ` title="${book.title}"` +
    ` chapters=${book.chapters.length}`,
  );
  await ensureDir(bookDir(book.id));

  for (const chapter of book.chapters) {
    if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
    console.log(`[Download] downloadBook: starting chapter ${chapter.id} url=${chapter.audioUrl}`);
    const path = await downloadChapter(book, chapter, onChapterProgress);
    onChapterDone(chapter.id, path);
  }
  console.log(`[Download] downloadBook: all chapters complete for bookId=${book.id}`);
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelBookDownload(book: Book): Promise<void> {
  for (const chapter of book.chapters) {
    const jobId = activeJobIds.get(chapter.id);
    if (jobId !== undefined) {
      RNFS.stopDownload(jobId);
      activeJobIds.delete(chapter.id);
    }
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteBookDownload(bookId: string): Promise<void> {
  const dir = bookDir(bookId);
  if (await RNFS.exists(dir)) {
    await RNFS.unlink(dir);
  }
}
