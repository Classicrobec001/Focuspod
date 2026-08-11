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
  useReadAlongStore,
  useSessionStore,
  useSettingsStore,
  FOCUS_DURATIONS,
  PLAYBACK_RATES,
  GENRES,
  SORT_LABELS,
} from '@focuspod/core';
import MenuList, { MenuItem } from '../components/MenuList';

// ─── Home ─────────────────────────────────────────────────────────────────

export const HOME_ITEMS = [
  { key: 'audiobooks', label: 'Audiobooks' },
  { key: 'genres', label: 'Genres' },
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
  const { books, isLoading, error, genre, sort } = useLibraryStore();
  const genreLabel = GENRES.find(g => g.key === genre)?.label ?? 'All books';

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
    <>
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
      {/* The active filter has to be visible, or a genre browse looks like the
          whole library has shrunk. */}
      <div className="status" style={{ padding: '2px 8px' }}>
        {genreLabel} · {SORT_LABELS[sort]}
        {isLoading ? ' · loading…' : ''}
      </div>
    </>
  );
}

// ─── Genres ───────────────────────────────────────────────────────────────

export function GenresView({ cursor }: { cursor: number }) {
  const genre = useLibraryStore(s => s.genre);
  return (
    <MenuList
      cursor={cursor}
      items={GENRES.map<MenuItem>(g => ({
        key: g.key || 'all',
        label: g.label,
        meta: g.key === genre ? '•' : undefined,
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

export const BOOK_ACTIONS = [
  'Play',
  'Start Focus Session',
  'Download',
  'Chapters',
  'Read Along',
] as const;

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
        <div className="status">Centre: read along · rotate: scrub</div>
      </div>
    </div>
  );
}

// ─── Read along ───────────────────────────────────────────────────────────

/**
 * The printed text beside the recording.
 *
 * Deliberately not presented as a synced lyrics view: LibriVox has no word or
 * line timings, so the position is an estimate from elapsed time. Saying so is
 * better than a highlight that is confidently in the wrong place — and the
 * reader can scroll, which switches the estimate off until they resync.
 */
export function ReadAlongView() {
  const { text, isLoading, unavailable, error, cursor, following, alignmentQuality } =
    useReadAlongStore();
  const book = usePlaybackStore(s => s.currentBook);

  if (isLoading) {
    return (
      <div className="panel__center">
        <span className="panel__subtitle">Looking for the text…</span>
        <span className="panel__note">Searching public-domain editions.</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="panel__center">
        <span className="panel__title">Text unavailable</span>
        <span className="panel__note">{error}</span>
      </div>
    );
  }
  if (unavailable || !text) {
    return (
      <div className="panel__center">
        <span className="panel__title">No text found</span>
        <span className="panel__note">
          No freely-readable edition of “{book?.title ?? 'this book'}” is available to read along
          with.
        </span>
      </div>
    );
  }

  // Render a window of paragraphs; the LCD clips the rest.
  const visible = text.paragraphs.slice(cursor, cursor + 6);
  const percent = Math.round((cursor / Math.max(1, text.paragraphs.length - 1)) * 100);

  return (
    <div className="reader">
      <div className="reader__body">
        {visible.map((paragraph, i) => (
          <p key={cursor + i} className={i === 0 ? 'reader__p reader__p--current' : 'reader__p'}>
            {paragraph}
          </p>
        ))}
      </div>
      <div className="reader__footer">
        <span>
          {following
            ? alignmentQuality === 'chapter'
              ? 'Following · chapter-aligned'
              : 'Following · approximate'
            : 'Manual scroll'}
        </span>
        <span>{percent}%</span>
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

export const SETTINGS_ROWS = [
  'haptics',
  'keepAwake',
  'rate',
  'sort',
  'duration',
  'storage',
] as const;

export function SettingsView({ cursor }: { cursor: number }) {
  const prefs = useSettingsStore(s => s.preferences);
  const sort = useLibraryStore(s => s.sort);
  const { usedBytes, quotaBytes } = useDownloadStore();

  const storageMeta =
    quotaBytes && quotaBytes > 0
      ? `${(usedBytes / 1024 / 1024).toFixed(0)} / ${(quotaBytes / 1024 / 1024 / 1024).toFixed(1)} GB`
      : `${(usedBytes / 1024 / 1024).toFixed(0)} MB`;

  const items: MenuItem[] = [
    { key: 'haptics', label: 'Wheel clicks', meta: prefs.haptics ? 'On' : 'Off' },
    { key: 'keepAwake', label: 'Keep screen awake', meta: prefs.keepAwake ? 'On' : 'Off' },
    { key: 'rate', label: 'Playback speed', meta: `${prefs.playbackRate}×` },
    { key: 'sort', label: 'Browse order', meta: SORT_LABELS[sort] },
    { key: 'duration', label: 'Default session', meta: `${prefs.defaultSessionDuration}m` },
    { key: 'storage', label: 'Offline storage', meta: storageMeta },
  ];

  return <MenuList cursor={cursor} items={items} />;
}

export { PLAYBACK_RATES };
