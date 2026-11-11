/**
 * Reader samples — 30 seconds of a recording before committing to it.
 *
 * LibriVox is volunteer-read, and a narrator the listener can't stand is the
 * main reason a LibriVox book gets abandoned. Until now the only way to find
 * out was to start the book. A sample answers it in half a minute, from Other
 * Recordings (▶❙❙ on any reader) or "Hear a Sample" on a book.
 *
 * A separate element from the book player (webAudio), so a sample never
 * disturbs the loaded queue, position or downloads: the book is paused while a
 * sample plays and resumed afterwards if it was playing.
 *
 * The sample starts past the LibriVox notice — where that has been measured,
 * exactly; otherwise at 25 s, later than any notice measured (9–24 s). Starting
 * on the notice would be a sample of the notice, which every reader says the
 * same way.
 */

import { create } from 'zustand';
import { archiveService, introEndsFor, usePlaybackStore, type Book } from '@focuspod/core';

const SAMPLE_SECONDS = 30;
const FALLBACK_START = 25;
/** Chapters shorter than this are prefaces or title cards — sample the next one. */
const MIN_CHAPTER_SECONDS = 90;

export type SampleStatus = 'idle' | 'loading' | 'playing' | 'error';

interface SampleState {
  status: SampleStatus;
  /** Which recording the sample belongs to. */
  bookId: string | null;
  /** Seconds left, for the countdown on the row. */
  remaining: number;
  message: string | null;
}

export const useSampleStore = create<SampleState>(() => ({
  status: 'idle',
  bookId: null,
  remaining: 0,
  message: null,
}));

let element: HTMLAudioElement | null = null;
let unlocked = false;
let stopAt = 0;
/** Resume the book afterwards — only if the sample interrupted it. */
let resumeBook = false;
/** Bumped on every start/stop so a slow fetch can't start a cancelled sample. */
let generation = 0;

function audio(): HTMLAudioElement {
  if (element) return element;
  const el = new Audio();
  el.preload = 'auto';
  el.addEventListener('timeupdate', () => {
    if (useSampleStore.getState().status !== 'playing') return;
    const left = Math.max(0, Math.ceil(stopAt - el.currentTime));
    if (left !== useSampleStore.getState().remaining) useSampleStore.setState({ remaining: left });
    if (el.currentTime >= stopAt) void stopSample();
  });
  el.addEventListener('ended', () => void stopSample());
  el.addEventListener('error', () => {
    if (useSampleStore.getState().status === 'idle') return;
    useSampleStore.setState({
      status: 'error',
      message: navigator.onLine === false ? 'Samples need a connection' : 'Sample unavailable',
    });
    void finish();
  });
  element = el;
  return el;
}

/**
 * Bless the sample element inside a user gesture. iOS only lets an element
 * play without a gesture once it has played from one, and a sample starts
 * after a network fetch, well outside the gesture. Call from the same global
 * gesture listener that unlocks the book player; repeat calls are free.
 */
export function primeSample(): void {
  if (unlocked) return;
  const el = audio();
  if (el.currentSrc) {
    unlocked = true;
    return;
  }
  el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';
  el.play()
    .then(() => {
      unlocked = true;
    })
    .catch(() => undefined)
    .finally(() => {
      el.pause();
      el.removeAttribute('src');
      el.load();
    });
}

function pickChapter(book: Book) {
  return (
    book.chapters.find(c => c.duration === 0 || c.duration >= MIN_CHAPTER_SECONDS) ??
    book.chapters[0]
  );
}

/** Start a sample of `book`, or stop it if that sample is already going. */
export async function toggleSample(book: Book): Promise<void> {
  const { status, bookId } = useSampleStore.getState();
  if (bookId === book.id && (status === 'playing' || status === 'loading')) {
    await stopSample();
    return;
  }
  await startSample(book);
}

async function startSample(book: Book): Promise<void> {
  const run = ++generation;
  const el = audio();
  el.pause();

  useSampleStore.setState({ status: 'loading', bookId: book.id, remaining: SAMPLE_SECONDS, message: null });

  // Pause the book first, and remember to bring it back — but only the first
  // time: switching from one sample to another must not forget it was playing.
  const playback = usePlaybackStore.getState();
  if (playback.status === 'playing') {
    resumeBook = true;
    await playback.pause();
  }

  try {
    // Browse and version rows arrive without chapters.
    const full = book.chapters.length > 0 ? book : await archiveService.fetchBook(book.id);
    if (run !== generation) return;
    const chapter = full ? pickChapter(full) : undefined;
    if (!chapter) throw new Error('no chapters');

    const [introEnd] = await introEndsFor([chapter]);
    if (run !== generation) return;
    let start = introEnd > 0 ? introEnd : FALLBACK_START;
    if (chapter.duration > 0 && start + SAMPLE_SECONDS > chapter.duration) start = 0;

    el.src = chapter.audioUrl;
    el.currentTime = 0;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        el.removeEventListener('loadedmetadata', done);
        el.removeEventListener('error', fail);
        resolve();
      };
      const fail = () => {
        el.removeEventListener('loadedmetadata', done);
        reject(new Error('load failed'));
      };
      el.addEventListener('loadedmetadata', done);
      el.addEventListener('error', fail, { once: true });
      el.load();
    });
    if (run !== generation) return;
    el.currentTime = start;
    stopAt = start + SAMPLE_SECONDS;
    await el.play();
    if (run !== generation) {
      el.pause();
      return;
    }
    useSampleStore.setState({ status: 'playing', remaining: SAMPLE_SECONDS });
  } catch {
    if (run !== generation) return;
    useSampleStore.setState({
      status: 'error',
      message: navigator.onLine === false ? 'Samples need a connection' : 'Sample unavailable',
    });
    await finish();
  }
}

/**
 * Stop any sample and give the book back. Safe to call when nothing plays.
 * `resume: false` when something else is about to play — Play on a new book
 * must not first bring the old one back for a moment.
 */
export async function stopSample({ resume = true }: { resume?: boolean } = {}): Promise<void> {
  if (!resume) resumeBook = false;
  const { status } = useSampleStore.getState();
  if (status === 'idle') return;
  generation++;
  element?.pause();
  useSampleStore.setState({ status: 'idle', bookId: null, remaining: 0, message: null });
  await finish();
}

async function finish(): Promise<void> {
  element?.pause();
  if (resumeBook) {
    resumeBook = false;
    await usePlaybackStore.getState().play().catch(() => undefined);
  }
}
