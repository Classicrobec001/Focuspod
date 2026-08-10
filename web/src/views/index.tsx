/**
 * The LCD views.
 *
 * Each view is a pure renderer: it reads store state and draws, and never
 * handles input. All input arrives at the wheel and is routed centrally in
 * IpodDevice, exactly as on the mobile build — that keeps the "one wheel, one
 * dispatcher" model intact and means a view can never disagree with the wheel
 * about what the cursor selects.
 */

import { useMemo } from 'react';
import {
  formatDuration,
  formatTime,
  totalDistractionMs,
  useDownloadStore,
  useLibraryStore,
  usePlaybackStore,
  useSessionStore,
  useSettingsStore,
  FOCUS_DURATIONS,
  PLAYBACK_RATES,
} from '@focuspod/core';
import MenuList, { MenuItem } from '../components/MenuList';

// ─── Home ─────────────────────────────────────────────────────────────────

export const HOME_ITEMS = [
  { key: 'audiobooks', label: 'Audiobooks' },
  { key: 'search', label: 'Search' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'now-playing', label: 'Now Playing' },
  { key: 'focus', label: 'Focus Session' },
  { key: 'sessions', label: 'Past Sessions' },
  { key: 'settings', label: 'Settings' },
] as const;

export function HomeMenuView({ cursor }: { cursor: number }) {
  return (
    <MenuList
      cursor={cursor}
      items={HOME_ITEMS.map(i => ({ key: i.key, label: i.label, arrow: true }))}
    />
  );
}

// ─── Audiobooks ───────────────────────────────────────────────────────────

export function AudiobooksView({ cursor }: { cursor: number }) {
  const { books, isLoading, error } = useLibraryStore();

  if (error) {
    return (
      <div className="panel__center">
        <span className="panel__title">Couldn't load books</span>
        <span className="panel__note">{error}</span>
        <span className="panel__note">Press MENU to go back.</span>
      </div>
    );
  }
  if (isLoading && books.length === 0) {
    return (
      <div className="panel__center">
        <span className="panel__subtitle">Loading library…</span>
      </div>
    );
  }

  return (
    <MenuList
      cursor={cursor}
      emptyMessage="No books found"
      items={books.map<MenuItem>(b => ({
        key: b.id,
        label: b.title,
        meta: b.duration > 0 ? formatDuration(b.duration) : undefined,
        arrow: true,
      }))}
    />
  );
}

// ─── Search ───────────────────────────────────────────────────────────────

/**
 * Search is typed on a hardware keyboard where one exists, and otherwise built
 * a letter at a time with the wheel — rotate to move through the alphabet,
 * centre to commit. The original iPod did exactly this.
 */
export const SEARCH_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';

export function SearchView({ cursor, query }: { cursor: number; query: string }) {
  const { searchResults, isLoading, searchQuery } = useLibraryStore();
  const letter = SEARCH_ALPHABET[cursor % SEARCH_ALPHABET.length];

  return (
    <div className="panel">
      <div>
        <span className="panel__title">{query || '…'}</span>
        <span className="panel__subtitle"> {letter === ' ' ? '␣' : letter}</span>
      </div>
      <span className="panel__note">
        Rotate for letters · centre adds · ▶▶ searches · ◀◀ deletes
      </span>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <span className="panel__subtitle">Searching…</span>
        ) : searchQuery ? (
          <MenuList
            cursor={-1}
            emptyMessage={`No results for "${searchQuery}"`}
            items={searchResults.slice(0, 8).map<MenuItem>(b => ({
              key: b.id,
              label: b.title,
              meta: b.author,
            }))}
          />
        ) : (
          <span className="panel__note">Type a title or author, then press ▶▶.</span>
        )}
      </div>
    </div>
  );
}

/** Results list shown after a search commits, so the wheel can pick one. */
export function SearchResultsView({ cursor }: { cursor: number }) {
  const { searchResults, isLoading, searchQuery } = useLibraryStore();
  if (isLoading) {
    return (
      <div className="panel__center">
        <span className="panel__subtitle">Searching…</span>
      </div>
    );
  }
  return (
    <MenuList
      cursor={cursor}
      emptyMessage={`No results for "${searchQuery}"`}
      items={searchResults.map<MenuItem>(b => ({
        key: b.id,
        label: b.title,
        meta: b.author,
        arrow: true,
      }))}
    />
  );
}

// ─── Downloads ────────────────────────────────────────────────────────────

export function DownloadsView({ cursor }: { cursor: number }) {
  // Subscribe to the raw record and derive here. Selecting `s.downloadedBooks()`
  // would hand back a freshly-built array every call, so zustand's reference
  // check never settles and the component re-renders without end.
  const books = useDownloadStore(s => s.books);
  const usedBytes = useDownloadStore(s => s.usedBytes);
  const downloaded = useMemo(
    () =>
      Object.entries(books)
        .filter(([, s]) => s.chapterIds.length > 0)
        .map(([bookId, s]) => ({ bookId, ...s })),
    [books],
  );

  return (
    <>
      <MenuList
        cursor={cursor}
        emptyMessage="No downloads yet"
        items={downloaded.map<MenuItem>(d => ({
          key: d.bookId,
          label: d.book.title,
          // A partial download must never read as complete: it plays only up to
          // the chapters that actually landed.
          meta:
            d.status === 'downloading'
              ? `${Math.round(d.progress * 100)}%`
              : d.status === 'done'
                ? '✓'
                : d.status === 'error'
                  ? '!'
                  : `${d.chapterIds.length}/${d.totalChapters}`,
          arrow: true,
        }))}
      />
      {downloaded.length > 0 && usedBytes > 0 && (
        <div className="status" style={{ padding: '2px 8px' }}>
          {(usedBytes / 1024 / 1024).toFixed(0)} MB stored offline
        </div>
      )}
    </>
  );
}

// ─── Book detail ──────────────────────────────────────────────────────────

export const BOOK_ACTIONS = ['Play', 'Start Focus Session', 'Download', 'Chapters'] as const;

export function BookDetailView({ cursor }: { cursor: number }) {
  const book = useLibraryStore(s => s.selectedBook);
  const isLoading = useLibraryStore(s => s.isLoading);
  const download = useDownloadStore(s => (book ? s.books[book.id] : undefined));

  if (!book) {
    return (
      <div className="panel__center">
        <span className="panel__subtitle">{isLoading ? 'Loading…' : 'No book selected'}</span>
      </div>
    );
  }

  const downloadLabel =
    download?.status === 'downloading'
      ? `Downloading ${Math.round(download.progress * 100)}%`
      : download?.status === 'done'
        ? 'Remove Download'
        : download?.status === 'error'
          ? 'Retry Download'
          : download?.status === 'partial'
            ? `Resume (${download.chapterIds.length}/${download.totalChapters})`
            : 'Download';

  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <BookCover book={book} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="panel__title">{book.title}</div>
          <div className="panel__subtitle">{book.author}</div>
          <div className="status">
            {isLoading && book.chapters.length === 0
              ? 'Loading chapters…'
              : `${book.chapters.length} chapters · ${formatDuration(book.duration)}`}
          </div>
          {download && download.status !== 'done' && download.chapterIds.length > 0 && (
            <div className="status status--warning">
              {download.chapterIds.length} of {download.totalChapters} available offline
            </div>
          )}
          {download?.status === 'done' && <div className="status status--active">Available offline</div>}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MenuList
          cursor={cursor}
          items={BOOK_ACTIONS.map<MenuItem>((action, i) => ({
            key: action,
            label: i === 2 ? downloadLabel : action,
            arrow: i === 3,
          }))}
        />
      </div>
    </div>
  );
}

function BookCover({ book }: { book: { title: string; coverUrl: string } }) {
  return (
    <img
      className="cover"
      src={book.coverUrl}
      alt=""
      loading="lazy"
      // Archive.org returns a generic placeholder for items without artwork and
      // 404s for some; hide rather than showing a broken-image glyph.
      onError={e => {
        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
      }}
    />
  );
}

// ─── Chapters ─────────────────────────────────────────────────────────────

export function ChaptersView({ cursor }: { cursor: number }) {
  const book = useLibraryStore(s => s.selectedBook);
  if (!book) return null;
  return (
    <MenuList
      cursor={cursor}
      emptyMessage="No chapters"
      items={book.chapters.map<MenuItem>(c => ({
        key: c.id,
        label: c.title,
        meta: c.duration > 0 ? formatTime(c.duration) : undefined,
      }))}
    />
  );
}

// ─── Now playing ──────────────────────────────────────────────────────────

export function NowPlayingView() {
  const { currentBook, currentChapterIndex, position, duration, status, playbackRate, notice } =
    usePlaybackStore();

  if (!currentBook) {
    return (
      <div className="panel__center">
        <span className="panel__title">Nothing playing</span>
        <span className="panel__note">Pick a book from Audiobooks to start listening.</span>
      </div>
    );
  }

  const chapter = currentBook.chapters[currentChapterIndex];
  const fraction = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <BookCover book={currentBook} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="panel__title">{chapter?.title ?? currentBook.title}</div>
          <div className="panel__subtitle">{currentBook.author}</div>
          <div className="status">
            {currentChapterIndex + 1} of {currentBook.chapters.length}
            {playbackRate !== 1 && ` · ${playbackRate}×`}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {notice && <div className="status status--warning">{notice}</div>}
        <div className="progress">
          <div className="progress__fill" style={{ width: `${fraction * 100}%` }} />
        </div>
        <div className="progress__labels">
          <span>{formatTime(position)}</span>
          <span>
            {status === 'buffering' ? 'Buffering…' : status === 'playing' ? '▶' : '❙❙'}
          </span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Focus ────────────────────────────────────────────────────────────────

export function FocusView({ cursor, capability }: { cursor: number; capability: string }) {
  const { currentSession, remainingSeconds, focusSetupStep, selectedDuration, awaySince } =
    useSessionStore();
  const books = useLibraryStore(s => s.books);

  // ── Active session ──
  if (currentSession && currentSession.status !== 'not_started') {
    const total = currentSession.duration * 60;
    const elapsed = total - remainingSeconds;
    const distractionMs = totalDistractionMs(currentSession.distractions);

    return (
      <div className="panel__center">
        <span className="countdown">{formatTime(remainingSeconds)}</span>
        <div className="progress" style={{ width: '80%' }}>
          <div
            className="progress__fill"
            style={{ width: `${total > 0 ? (elapsed / total) * 100 : 0}%` }}
          />
        </div>
        <span className={`status ${currentSession.status === 'paused' ? '' : 'status--active'}`}>
          {currentSession.status === 'paused' ? 'Paused' : 'Focusing'}
        </span>
        {awaySince !== null ? (
          <span className="status status--warning">You left the app — come back</span>
        ) : distractionMs > 0 ? (
          <span className="status status--warning">
            {currentSession.distractions.filter(d => d.durationMs > 0).length} distraction
            {currentSession.distractions.filter(d => d.durationMs > 0).length === 1 ? '' : 's'} ·{' '}
            {formatTime(distractionMs / 1000)} away
          </span>
        ) : (
          <span className="status">No distractions yet</span>
        )}
        <span className="panel__note">Centre pauses · MENU ends the session</span>
      </div>
    );
  }

  // ── Setup: duration ──
  if (focusSetupStep === 'duration') {
    return (
      <>
        <MenuList
          cursor={cursor}
          items={FOCUS_DURATIONS.map<MenuItem>(m => ({
            key: String(m),
            label: `${m} minutes`,
            meta: m === selectedDuration ? '•' : undefined,
          }))}
        />
        {capability === 'soft-guard' && (
          <div className="status" style={{ padding: '2px 8px' }}>
            Screen stays awake · leaving the app is logged
          </div>
        )}
      </>
    );
  }

  // ── Setup: book ──
  if (focusSetupStep === 'book') {
    return (
      <MenuList
        cursor={cursor}
        emptyMessage="Open Audiobooks first"
        items={[
          { key: '__none', label: 'No audiobook (silent)' },
          ...books.slice(0, 40).map<MenuItem>(b => ({ key: b.id, label: b.title, arrow: true })),
        ]}
      />
    );
  }

  // ── Setup: apps (mobile only; never reached under soft-guard) ──
  return (
    <div className="panel__center">
      <span className="panel__title">App blocking</span>
      <span className="panel__note">
        Blocking other apps needs the native app. This session will keep the screen awake and
        record any time you spend away.
      </span>
    </div>
  );
}

// ─── Past sessions ────────────────────────────────────────────────────────

export function SessionsView({ cursor }: { cursor: number }) {
  const sessions = useSessionStore(s => s.sessions);

  return (
    <MenuList
      cursor={cursor}
      emptyMessage="No sessions yet"
      items={sessions.map<MenuItem>(s => {
        const when = s.startTime ? new Date(s.startTime) : null;
        const away = totalDistractionMs(s.distractions);
        return {
          key: s.id,
          label: when
            ? `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${s.duration}m`
            : `${s.duration}m`,
          meta:
            s.status === 'completed'
              ? away > 0
                ? `✓ ${Math.round(away / 60000)}m away`
                : '✓ clean'
              : s.status,
        };
      })}
    />
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────

export const SETTINGS_ROWS = ['haptics', 'keepAwake', 'rate', 'duration', 'storage'] as const;

export function SettingsView({ cursor }: { cursor: number }) {
  const prefs = useSettingsStore(s => s.preferences);
  const { usedBytes, quotaBytes } = useDownloadStore();

  const storageMeta =
    quotaBytes && quotaBytes > 0
      ? `${(usedBytes / 1024 / 1024).toFixed(0)} / ${(quotaBytes / 1024 / 1024 / 1024).toFixed(1)} GB`
      : `${(usedBytes / 1024 / 1024).toFixed(0)} MB`;

  const items: MenuItem[] = [
    { key: 'haptics', label: 'Wheel clicks', meta: prefs.haptics ? 'On' : 'Off' },
    { key: 'keepAwake', label: 'Keep screen awake', meta: prefs.keepAwake ? 'On' : 'Off' },
    { key: 'rate', label: 'Playback speed', meta: `${prefs.playbackRate}×` },
    { key: 'duration', label: 'Default session', meta: `${prefs.defaultSessionDuration}m` },
    { key: 'storage', label: 'Offline storage', meta: storageMeta },
  ];

  return <MenuList cursor={cursor} items={items} />;
}

export { PLAYBACK_RATES };
