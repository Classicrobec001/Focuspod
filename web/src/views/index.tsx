/**
 * The LCD views.
 *
 * Each view is a pure renderer: it reads store state and draws, and never
 * handles input. All input arrives at the wheel and is routed centrally in
 * IpodDevice, exactly as on the mobile build — that keeps the "one wheel, one
 * dispatcher" model intact and means a view can never disagree with the wheel
 * about what the cursor selects.
 */

import { useEffect, useMemo, useRef } from 'react';
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
  PODCAST_TOPICS,
  usePodcastStore,
  useFavoritesStore,
  listFavorites,
  listFavoriteChapters,
  useAuthStore,
  useStreakStore,
  recentDays,
  DAILY_GOAL_SECONDS,
  MILESTONES,
  THEMES,
  themeMeta,
} from '@focuspod/core';
import type { Book } from '@focuspod/core';
import MenuList, { MenuItem } from '../components/MenuList';
import { RELEASE_NOTES, hasUnreadNotes } from '../releaseNotes';
import { analyticsConfigured } from '../analytics';
import { accountsConfigured } from '../ports';

// ─── Home ─────────────────────────────────────────────────────────────────

export const HOME_ITEMS = [
  { key: 'audiobooks', label: 'Audiobooks' },
  { key: 'genres', label: 'Genres' },
  { key: 'podcast-topics', label: 'Podcasts' },
  { key: 'search', label: 'Search' },
  { key: 'favorites', label: 'Favourites' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'now-playing', label: 'Now Playing' },
  { key: 'focus', label: 'Focus Session' },
  { key: 'sessions', label: 'Past Sessions' },
  { key: 'streak', label: 'Streak' },
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

// ─── Podcasts ─────────────────────────────────────────────────────────────

export function PodcastTopicsView({ cursor }: { cursor: number }) {
  return (
    <>
      <MenuList
        cursor={cursor}
        items={PODCAST_TOPICS.map<MenuItem>(t => ({ key: t.key, label: t.label, arrow: true }))}
      />
      <div className="status" style={{ padding: '2px 8px' }}>
        Current shows on modern subjects
      </div>
    </>
  );
}

export function PodcastShowsView({ cursor }: { cursor: number }) {
  const { shows, isLoading, error, checked, total } = usePodcastStore();

  if (error) {
    return (
      <div className="panel__center">
        <span className="panel__title">Couldn't load podcasts</span>
        <span className="panel__note">{error}</span>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="panel__center">
        <span className="panel__subtitle">Finding shows…</span>
        {total > 0 && (
          <span className="panel__note">
            checked {checked} of {total}
          </span>
        )}
        {/* Explains the wait, and why some shows never appear. */}
        <span className="panel__note">Only shows that can play here are listed.</span>
      </div>
    );
  }

  return (
    <>
      <MenuList
        cursor={cursor}
        emptyMessage="No playable shows found"
        items={shows.map<MenuItem>(s => ({
          key: s.id,
          label: s.title,
          meta: s.chapters.length ? `${s.chapters.length}` : undefined,
          arrow: true,
        }))}
      />
      {shows.length > 0 && (
        <div className="status" style={{ padding: '2px 8px' }}>
          {shows.length} shows · episodes newest last
        </div>
      )}
    </>
  );
}

// ─── Search ───────────────────────────────────────────────────────────────

/**
 * Search uses a real text field.
 *
 * The wheel-alphabet approach was authentic to the device and miserable to use:
 * spelling "psychology" meant eleven separate rotate-and-click sequences. A
 * focused <input> brings up the phone's own keyboard, which is what people
 * expect and what makes the far larger catalog actually searchable.
 */
export function SearchView({
  query,
  onQueryChange,
  onSubmit,
  scope,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  scope: 'books' | 'podcasts';
}) {
  const { searchResults, isLoading, searchQuery } = useLibraryStore();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on entry so the keyboard appears without a second tap. iOS only
  // raises it for a focus that happens inside a user gesture, and arriving here
  // is one (the centre button press).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="panel">
      <input
        ref={inputRef}
        className="search__input"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        onKeyDown={e => {
          // Keep the device keys working while typing; everything else is text.
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
          e.stopPropagation();
        }}
        placeholder={scope === 'podcasts' ? 'Search podcasts' : 'Search title or author'}
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-label={scope === 'podcasts' ? 'Search podcasts' : 'Search audiobooks'}
      />
      <span className="panel__note">
        {scope === 'podcasts' ? 'Podcasts' : 'Audiobooks'} · press Enter or ▶▶ to search
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
          <span className="panel__note">Results appear here.</span>
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

// ─── Favourites ───────────────────────────────────────────────────────────

/**
 * Rows that sit above the favourited books.
 *
 * Shown even when there are no favourite chapters, and exported as a constant
 * rather than a computed offset for two reasons: a list whose first row appears
 * and disappears shifts everything under the cursor, and a permanent row is how
 * anyone finds out chapters can be favourited at all.
 */
export const FAVORITES_HEADER_ROWS = 1;

export function FavoritesView({ cursor }: { cursor: number }) {
  const items = useFavoritesStore(s => s.items);
  const chapters = useFavoritesStore(s => s.chapters);
  // Derive here rather than in a selector: listFavorites builds a new array
  // every call, which as a selector would re-render without end.
  const favorites = useMemo(() => listFavorites(items), [items]);
  const chapterCount = Object.keys(chapters).length;
  const downloads = useDownloadStore(s => s.books);

  const header: MenuItem[] = [
    {
      key: '__chapters',
      label: 'Favourite Chapters',
      meta: chapterCount > 0 ? `${chapterCount}` : '0',
      arrow: true,
    },
  ];

  return (
    <>
      <MenuList
        cursor={cursor}
        items={header.concat(favorites.map<MenuItem>(b => ({
          key: b.id,
          label: b.title,
          // A favourite is only playable offline if it was also downloaded, so
          // say which ones those are rather than letting it be discovered by
          // tapping one on a train.
          meta: downloads[b.id]?.status === 'done' ? '✓' : b.narrator,
          arrow: true,
        })))}
      />
      <div className="status" style={{ padding: '2px 8px' }}>
        {favorites.length > 0
          ? `${favorites.length} saved · ✓ available offline`
          : 'No favourite books yet — ● Favourite on any book.'}
      </div>
    </>
  );
}

/**
 * Individual chapters saved for replay.
 *
 * Each row shows the book it came from, because a chapter title on its own
 * ("Chapter 14") is not enough to tell two saved chapters apart.
 */
export function FavoriteChaptersView({ cursor }: { cursor: number }) {
  const chapters = useFavoritesStore(s => s.chapters);
  const list = useMemo(() => listFavoriteChapters(chapters), [chapters]);
  const downloads = useDownloadStore(s => s.books);

  return (
    <>
      <MenuList
        cursor={cursor}
        emptyMessage="No saved chapters — press ▶▶ on a chapter to save it"
        items={list.map<MenuItem>(entry => ({
          key: entry.chapter.id,
          label: entry.chapter.title,
          meta: downloads[entry.bookId]?.chapterIds?.includes(entry.chapter.id)
            ? '✓'
            : entry.bookTitle,
        }))}
      />
      {list.length > 0 && (
        <div className="status" style={{ padding: '2px 8px' }}>
          {list.length} saved · ✓ available offline
        </div>
      )}
    </>
  );
}

// ─── Book detail ──────────────────────────────────────────────────────────

export const BOOK_ACTIONS = [
  'Play',
  'Favourite',
  'Start Focus Session',
  'Download',
  'Chapters',
  'Other Recordings',
  'Read Along',
] as const;

export function BookDetailView({ cursor }: { cursor: number }) {
  const book = useLibraryStore(s => s.selectedBook);
  const isLoading = useLibraryStore(s => s.isLoading);
  const download = useDownloadStore(s => (book ? s.books[book.id] : undefined));
  const isFavorite = useFavoritesStore(s => (book ? Boolean(s.items[book.id]) : false));

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
          <div className="panel__subtitle">
            {book.author}
            {book.narrator ? ` · read by ${book.narrator}` : ''}
          </div>
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
          items={BOOK_ACTIONS.map<MenuItem>(action => ({
            key: action,
            label:
              action === 'Download'
                ? downloadLabel
                : action === 'Favourite'
                  ? isFavorite
                    ? 'Remove from Favourites'
                    : 'Add to Favourites'
                  : action,
            meta: action === 'Favourite' && isFavorite ? '★' : undefined,
            arrow: action === 'Chapters' || action === 'Other Recordings',
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

/**
 * The chapter list, where a chapter can also be saved.
 *
 * The centre button plays — that is what it does everywhere else and changing
 * it would be worse than not having the feature. Saving is on ▶▶ instead,
 * following the precedent already set on the search screen, where the transport
 * buttons submit and backspace rather than skipping tracks. The footer says so
 * outright: a repurposed button nobody knows about is a button that does not
 * exist.
 */
export function ChaptersView({ cursor }: { cursor: number }) {
  const book = useLibraryStore(s => s.selectedBook);
  const saved = useFavoritesStore(s => s.chapters);
  if (!book) return null;
  return (
    <>
      <MenuList
        cursor={cursor}
        emptyMessage="No chapters"
        items={book.chapters.map<MenuItem>(c => ({
          key: c.id,
          label: saved[c.id] ? `♥ ${c.title}` : c.title,
          meta: c.duration > 0 ? formatTime(c.duration) : undefined,
        }))}
      />
      {book.chapters.length > 0 && (
        <div className="status" style={{ padding: '2px 8px' }}>
          ● play · ▶▶ save chapter
        </div>
      )}
    </>
  );
}

// ─── Other recordings ─────────────────────────────────────────────────────

/**
 * Alternate readings of the same book.
 *
 * LibriVox is volunteer-read, so voice, pace and audio quality vary enormously
 * between recordings of the same title — this is how a listener finds one they
 * can actually live with for eight hours.
 */
export function VersionsView({
  cursor,
  versions,
  isLoading,
}: {
  cursor: number;
  versions: Book[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="panel__center">
        <span className="panel__subtitle">Looking for other recordings…</span>
      </div>
    );
  }
  return (
    <>
      <MenuList
        cursor={cursor}
        emptyMessage="This is the only recording"
        items={versions.map<MenuItem>(v => ({
          key: v.id,
          // The reader is the reason to switch, so it leads where it is known.
          label: v.narrator ?? v.title,
          meta: v.duration > 0 ? formatDuration(v.duration) : undefined,
          arrow: true,
        }))}
      />
      {versions.length > 0 && (
        <div className="status" style={{ padding: '2px 8px' }}>
          {versions.length} other recording{versions.length === 1 ? '' : 's'}
        </div>
      )}
    </>
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

// ─── What's New ───────────────────────────────────────────────────────────

export function WhatsNewView() {
  return (
    <div className="reader">
      <div className="reader__body">
        {RELEASE_NOTES.map(note => (
          <div key={note.version} style={{ marginBottom: '0.8em' }}>
            <div className="panel__title">
              {note.version} · <span className="panel__subtitle">{note.date}</span>
            </div>
            {note.items.map(item => (
              <p key={item} className="reader__p reader__p--current" style={{ marginBottom: '0.3em' }}>
                • {item}
              </p>
            ))}
          </div>
        ))}
      </div>
      <div className="reader__footer">
        <span>Rotate or swipe to read more</span>
      </div>
    </div>
  );
}

// ─── About ────────────────────────────────────────────────────────────────

const LINKS = [
  { label: 'X / Twitter', href: 'https://x.com/KingRobec' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/rokeeb-abdul-41a253144/' },
  { label: 'Instagram', href: 'https://www.instagram.com/classicrobec/' },
  { label: 'Email', href: 'mailto:uxrobec@gmail.com' },
];

export function AboutView() {
  return (
    <div className="reader">
      <div className="reader__body">
        <p className="reader__p reader__p--current">
          Hey there! I'm Rokeeb, a product designer who blends UX design, systems thinking and
          technical execution.
        </p>
        <p className="reader__p reader__p--current">
          I also dabble in vibe coding, and I help startups move fast.
        </p>
        <ul className="about__links">
          {LINKS.map(link => {
            // Profiles open in a new context so playback is never interrupted
            // by navigating the app away. mailto: hands off to the mail client
            // and must not, or the browser is left holding an empty tab.
            const external = !link.href.startsWith('mailto:');
            return (
              <li key={link.label}>
                <a
                  href={link.href}
                  {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {link.label} ›
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="reader__footer">
        <span>FocusPod</span>
        <span>Public-domain audiobooks &amp; podcasts</span>
      </div>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────


// ─── Themes ───────────────────────────────────────────────────────────────

/**
 * The palette picker.
 *
 * Locked themes stay visible and stay selectable-looking, marked with a small
 * lock. Hiding them would be tidier and much less useful: nobody signs in for a
 * feature they have never seen. Selecting one when signed out routes to the
 * account screen rather than silently doing nothing.
 */
export function ThemesView({ cursor }: { cursor: number }) {
  const current = useSettingsStore(s => s.preferences.theme);
  const allThemes = useAuthStore(s => s.entitlements().allThemes);

  return (
    <>
      <MenuList
        cursor={cursor}
        items={THEMES.map<MenuItem>(theme => ({
          key: theme.id,
          label: theme.label,
          accent: theme.swatch,
          meta: theme.id === current ? '✓' : theme.locked && !allThemes ? '🔒' : undefined,
        }))}
      />
      {!allThemes && (
        <div className="status" style={{ padding: '2px 8px' }}>
          🔒 unlocks with an email · Settings › Account
        </div>
      )}
    </>
  );
}

// ─── Streak ───────────────────────────────────────────────────────────────

const STREAK_CHART_DAYS = 14;

/**
 * The listening streak.
 *
 * Fourteen days of bars, each capped at the daily goal rather than at the
 * largest day on record: the question this chart answers is "did I clear ten
 * minutes", not "which day did I listen most", and scaling to the maximum
 * makes a good week look like a bad one next to a single binge.
 */
export function StreakView() {
  const enabled = useSettingsStore(s => s.preferences.streakEnabled);
  const days = useStreakStore(s => s.days);
  const current = useStreakStore(s => s.current);
  const longest = useStreakStore(s => s.longest);
  const retention = useAuthStore(s => s.entitlements().streakHistoryDays);
  const signedIn = useAuthStore(s => s.account !== null);

  // recentDays builds a fresh array on every call, so it must be memoised
  // rather than used as a selector — see the note in FavoritesView.
  const chart = useMemo(() => recentDays(days, STREAK_CHART_DAYS), [days]);
  const today = chart[chart.length - 1]?.seconds ?? 0;
  const todayMinutes = Math.floor(today / 60);
  const goalMinutes = Math.round(DAILY_GOAL_SECONDS / 60);

  if (!enabled) {
    return (
      <div className="panel__center">
        <span className="panel__subtitle">Streak is off</span>
        <span className="panel__note">Turn it back on in Settings.</span>
      </div>
    );
  }

  const totalDays = Object.values(days).filter(s => s >= DAILY_GOAL_SECONDS).length;

  return (
    <div className="streak">
      <div className="streak__hero">
        <span className="streak__count">{current}</span>
        <span className="streak__unit">
          day{current === 1 ? '' : 's'} in a row
        </span>
      </div>

      <div className="streak__bars" role="img" aria-label={`Listening over the last ${STREAK_CHART_DAYS} days`}>
        {chart.map((day, i) => {
          const fraction = Math.min(1, day.seconds / DAILY_GOAL_SECONDS);
          const met = day.seconds >= DAILY_GOAL_SECONDS;
          return (
            <div
              key={day.key}
              className={`streak__bar${met ? ' streak__bar--met' : ''}${
                i === chart.length - 1 ? ' streak__bar--today' : ''
              }`}
              title={`${day.key}: ${Math.floor(day.seconds / 60)}m`}
            >
              {/* A hair of height for a day with any listening at all, so
                  "started but fell short" is distinguishable from "nothing". */}
              <span style={{ height: `${day.seconds > 0 ? Math.max(8, fraction * 100) : 0}%` }} />
            </div>
          );
        })}
      </div>
      <div className="streak__scale">
        <span>{STREAK_CHART_DAYS}d ago</span>
        <span>today</span>
      </div>

      <div className="streak__stats">
        <span>
          Today <b>{todayMinutes}m</b> / {goalMinutes}m
        </span>
        <span>
          Best <b>{longest}</b>
        </span>
        <span>
          Total <b>{totalDays}</b> days
        </span>
      </div>

      <div className="streak__badges">
        {MILESTONES.map(milestone => (
          <span
            key={milestone}
            className={`badge${longest >= milestone ? ' badge--earned' : ''}`}
          >
            {milestone}d
          </span>
        ))}
      </div>

      <span className="panel__note">
        {today >= DAILY_GOAL_SECONDS
          ? 'Today counts. See you tomorrow.'
          : `${Math.max(0, goalMinutes - todayMinutes)}m more today to keep it going.`}
        {!signedIn && ` · History kept ${retention} days without an account.`}
      </span>
    </div>
  );
}

// ─── Account ──────────────────────────────────────────────────────────────

/**
 * Email sign-in.
 *
 * Three states worth drawing: signed out (an address field), waiting for a link
 * that was sent to an email client this app cannot observe, and signed in. The
 * middle one is the reason this is a screen and not a settings toggle — without
 * it, "nothing happened yet" and "it failed" look identical.
 *
 * The copy is deliberately specific about what the address is for. An email
 * asked for with no stated purpose is the kind of thing people give a throwaway
 * address to, and a throwaway address is worth nothing to either side.
 */
export function AccountView({
  email,
  onEmailChange,
  onSubmit,
  syncLabel,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: () => void;
  syncLabel: string;
}) {
  const status = useAuthStore(s => s.status);
  const account = useAuthStore(s => s.account);
  const error = useAuthStore(s => s.error);
  const pendingEmail = useAuthStore(s => s.pendingEmail);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === 'signed-out') inputRef.current?.focus();
  }, [status]);

  if (status === 'unavailable') {
    return (
      <div className="panel__center">
        <span className="panel__subtitle">Accounts are off in this build</span>
        <span className="panel__note">Everything else works exactly the same.</span>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="panel__center">
        <span className="panel__subtitle">Checking…</span>
      </div>
    );
  }

  if (status === 'signed-in' && account) {
    return (
      <div className="panel">
        <span className="panel__title">Signed in</span>
        <span className="account__email">{account.email}</span>
        <span className="panel__note">{syncLabel}</span>
        <ul className="account__perks">
          <li>Favourites and streak on every device</li>
          <li>All {THEMES.length} themes</li>
          <li>Streak history kept for a year</li>
          <li>300 favourites and 300 saved chapters</li>
        </ul>
        <span className="panel__note">Press ● to sign out. Your local library stays.</span>
      </div>
    );
  }

  if (status === 'link-sent') {
    return (
      <div className="panel">
        <span className="panel__title">Check your email</span>
        <span className="account__email">{pendingEmail}</span>
        <span className="panel__note">
          Open the link on this device to finish signing in. It expires in an hour.
        </span>
        <span className="panel__note">Press ● to send it again.</span>
      </div>
    );
  }

  return (
    <div className="panel">
      <input
        ref={inputRef}
        className="search__input"
        type="email"
        value={email}
        onChange={e => onEmailChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
          e.stopPropagation();
        }}
        placeholder="you@example.com"
        enterKeyHint="send"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Email address"
      />
      {error ? (
        <span className="status status--warning">{error}</span>
      ) : (
        <span className="panel__note">No password. We email you a link.</span>
      )}
      <ul className="account__perks">
        <li>Sync favourites and streak across devices</li>
        <li>Unlock the {THEMES.filter(t => t.locked).length} locked themes</li>
        <li>Keep a year of streak history</li>
      </ul>
      <span className="panel__note">
        Used for sign-in and occasional news about FocusPod. Nothing else, ever.
      </span>
    </div>
  );
}

export type SettingsRow =
  | 'theme'
  | 'haptics'
  | 'tap'
  | 'keepAwake'
  | 'rate'
  | 'sort'
  | 'duration'
  | 'streak'
  | 'storage'
  | 'account'
  | 'analytics'
  | 'whatsnew'
  | 'about';

/**
 * The rows actually rendered, in order.
 *
 * A function rather than a constant because the analytics row only exists when
 * a measurement id was configured at build time. The view and the wheel
 * dispatcher both read this, so a row can never be shown at one index and acted
 * on at another.
 */
export function settingsRows(): SettingsRow[] {
  const rows: SettingsRow[] = [
    'theme',
    'haptics',
    'tap',
    'keepAwake',
    'rate',
    'sort',
    'duration',
    'streak',
    'storage',
  ];
  // Same rule as the analytics row: a build with no provider configured must
  // not show a door that opens onto nothing.
  if (accountsConfigured) rows.push('account');
  if (analyticsConfigured) rows.push('analytics');
  rows.push('whatsnew', 'about');
  return rows;
}

export function SettingsView({ cursor }: { cursor: number }) {
  const prefs = useSettingsStore(s => s.preferences);
  const sort = useLibraryStore(s => s.sort);
  const { usedBytes, quotaBytes } = useDownloadStore();
  const authStatus = useAuthStore(s => s.status);
  const streakCurrent = useStreakStore(s => s.current);

  const storageMeta =
    quotaBytes && quotaBytes > 0
      ? `${(usedBytes / 1024 / 1024).toFixed(0)} / ${(quotaBytes / 1024 / 1024 / 1024).toFixed(1)} GB`
      : `${(usedBytes / 1024 / 1024).toFixed(0)} MB`;

  const ROW_CONTENT: Record<SettingsRow, MenuItem> = {
    theme: {
      key: 'theme',
      label: 'Theme',
      meta: themeMeta(prefs.theme).label,
      accent: themeMeta(prefs.theme).swatch,
      arrow: true,
    },
    streak: {
      key: 'streak',
      label: 'Listening streak',
      meta: prefs.streakEnabled ? `${streakCurrent}d` : 'Off',
    },
    account: {
      key: 'account',
      label: 'Account',
      meta:
        authStatus === 'signed-in'
          ? 'Signed in'
          : authStatus === 'link-sent'
            ? 'Check email'
            : 'Sign in',
      arrow: true,
    },
    haptics: { key: 'haptics', label: 'Wheel clicks', meta: prefs.haptics ? 'On' : 'Off' },
    tap: { key: 'tap', label: 'Tap to select', meta: prefs.tapToSelect ? 'On' : 'Off' },
    keepAwake: { key: 'keepAwake', label: 'Keep screen awake', meta: prefs.keepAwake ? 'On' : 'Off' },
    rate: { key: 'rate', label: 'Playback speed', meta: `${prefs.playbackRate}×` },
    sort: { key: 'sort', label: 'Browse order', meta: SORT_LABELS[sort] },
    duration: { key: 'duration', label: 'Default session', meta: `${prefs.defaultSessionDuration}m` },
    storage: { key: 'storage', label: 'Offline storage', meta: storageMeta },
    analytics: {
      key: 'analytics',
      label: 'Usage analytics',
      meta: prefs.analyticsConsent ? 'On' : 'Off',
    },
    whatsnew: {
      key: 'whatsnew',
      label: "What's New",
      // A dot rather than a count: it only needs to say "there is something".
      meta: hasUnreadNotes(prefs.lastSeenVersion) ? '•' : undefined,
      arrow: true,
    },
    about: { key: 'about', label: 'About the builder', arrow: true },
  };

  const items: MenuItem[] = settingsRows().map(row => ROW_CONTENT[row]);

  return <MenuList cursor={cursor} items={items} />;
}

export { PLAYBACK_RATES };
