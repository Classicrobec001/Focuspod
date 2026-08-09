/**
 * IpodDevice — the shell, and the single place wheel input is interpreted.
 *
 * Ported from mobile/src/components/IpodDevice.tsx. Views render; this routes.
 * Every wheel event lands here, is resolved against the current screen, and is
 * turned into a store action. Adding a screen means adding a case to
 * `itemCount`, `title` and `handleSelect` — nothing else changes.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  FOCUS_DURATIONS,
  PLAYBACK_RATES,
  useDownloadStore,
  useIpodNavStore,
  useLibraryStore,
  usePlaybackStore,
  useSessionStore,
  useSettingsStore,
  type ScreenId,
} from '@focuspod/core';
import ClickWheel from './ClickWheel';
import Lcd from './Lcd';
import {
  AudiobooksView,
  BookDetailView,
  BOOK_ACTIONS,
  ChaptersView,
  DownloadsView,
  FocusView,
  HomeMenuView,
  HOME_ITEMS,
  NowPlayingView,
  SearchResultsView,
  SearchView,
  SEARCH_ALPHABET,
  SessionsView,
  SettingsView,
  SETTINGS_ROWS,
} from '../views';
import { webFocusGuard } from '../ports';

/** Seconds of audio a single wheel detent scrubs on the Now Playing screen. */
const SEEK_PER_DETENT = 10;

/**
 * Fire an async handler from a DOM event without letting a rejection escape as
 * an unhandled promise. A failed action should log, not take down the page.
 */
function run(action: () => Promise<unknown>): void {
  action().catch(error => console.warn('[Device] action failed:', error));
}

export default function IpodDevice() {
  const nav = useIpodNavStore();
  const screen = nav.stack[nav.stack.length - 1];
  const cursor = nav.cursors[screen.id] ?? 0;

  const library = useLibraryStore();
  const playback = usePlaybackStore();
  const session = useSessionStore();
  const downloads = useDownloadStore();
  const settings = useSettingsStore();

  /** Search text is transient UI state — it never needs to outlive the screen. */
  const [searchQuery, setSearchQuery] = useState('');

  // ─── Data loading on entry ────────────────────────────────────────────

  useEffect(() => {
    if (screen.id === 'audiobooks' || screen.id === 'focus') void library.loadBooks();
    if (screen.id === 'sessions') void session.loadSessions();
    if (screen.id === 'settings' || screen.id === 'downloads') void downloads.refreshUsage();
    // Store actions are stable; re-running on every store change would refetch
    // on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.id]);

  // ─── Row counts ───────────────────────────────────────────────────────

  const itemCount = useCallback(
    (id: ScreenId): number => {
      switch (id) {
        case 'home':
          return HOME_ITEMS.length;
        case 'audiobooks':
          return library.books.length;
        case 'search':
          return SEARCH_ALPHABET.length;
        case 'search-results':
          return library.searchResults.length;
        case 'downloads':
          return downloads.downloadedBooks().length;
        case 'book-detail':
          return BOOK_ACTIONS.length;
        case 'chapters':
          return library.selectedBook?.chapters.length ?? 0;
        case 'sessions':
          return session.sessions.length;
        case 'settings':
          return SETTINGS_ROWS.length;
        case 'focus':
          if (session.currentSession) return 0;
          if (session.focusSetupStep === 'duration') return FOCUS_DURATIONS.length;
          if (session.focusSetupStep === 'book') return library.books.slice(0, 40).length + 1;
          return 0;
        case 'now-playing':
          return 0; // rotation scrubs instead of moving a cursor
        default:
          return 0;
      }
    },
    [library.books, library.searchResults, library.selectedBook, downloads, session],
  );

  // ─── Titles ───────────────────────────────────────────────────────────

  const title = useCallback((): string => {
    switch (screen.id) {
      case 'home':
        return 'FocusPod';
      case 'audiobooks':
        return 'Audiobooks';
      case 'search':
        return 'Search';
      case 'search-results':
        return `Results (${library.searchResults.length})`;
      case 'downloads':
        return 'Downloads';
      case 'book-detail':
        return library.selectedBook?.title ?? 'Book';
      case 'chapters':
        return 'Chapters';
      case 'now-playing':
        return 'Now Playing';
      case 'focus':
        return session.currentSession ? 'Focus' : 'New Session';
      case 'sessions':
        return 'Past Sessions';
      case 'settings':
        return 'Settings';
      default:
        return 'FocusPod';
    }
  }, [screen.id, library.searchResults.length, library.selectedBook, session.currentSession]);

  // ─── Select (centre button) ───────────────────────────────────────────

  const openBook = useCallback(
    async (bookId: string) => {
      nav.resetCursor('book-detail');
      nav.push('book-detail');
      // Browse and search results carry no chapters; selectBook hydrates them.
      await library.selectBook(bookId);
    },
    [nav, library],
  );

  const handleSelect = useCallback(async () => {
    switch (screen.id) {
      case 'home': {
        const target = HOME_ITEMS[cursor]?.key as ScreenId | undefined;
        if (!target) return;
        if (target === 'focus') session.resetFocusSetup();
        if (target === 'search') setSearchQuery('');
        nav.resetCursor(target);
        nav.push(target);
        return;
      }

      case 'audiobooks': {
        const book = library.books[cursor];
        if (book) await openBook(book.id);
        return;
      }

      case 'search-results': {
        const book = library.searchResults[cursor];
        if (book) await openBook(book.id);
        return;
      }

      case 'search': {
        setSearchQuery(q => (q + SEARCH_ALPHABET[cursor % SEARCH_ALPHABET.length]).slice(0, 40));
        return;
      }

      case 'downloads': {
        const entry = downloads.downloadedBooks()[cursor];
        if (entry) await openBook(entry.bookId);
        return;
      }

      case 'chapters': {
        const book = library.selectedBook;
        if (!book || book.chapters.length === 0) return;
        await playback.loadBook(book, cursor);
        await playback.play();
        nav.push('now-playing');
        return;
      }

      case 'book-detail': {
        const book = library.selectedBook;
        if (!book) return;

        switch (BOOK_ACTIONS[cursor]) {
          case 'Play': {
            if (book.chapters.length === 0) return; // still hydrating
            await playback.loadBook(book, 0);
            await playback.play();
            nav.push('now-playing');
            return;
          }
          case 'Start Focus Session': {
            session.resetFocusSetup();
            session.setFocusSetupBookId(book.id);
            nav.resetCursor('focus');
            nav.push('focus');
            return;
          }
          case 'Download': {
            const state = downloads.books[book.id];
            if (state?.status === 'downloading') downloads.cancelDownload(book.id);
            else if (state?.status === 'done') await downloads.deleteDownload(book.id);
            else await downloads.startDownload(book);
            return;
          }
          case 'Chapters': {
            nav.resetCursor('chapters');
            nav.push('chapters');
            return;
          }
        }
        return;
      }

      case 'now-playing':
        await playback.togglePlayPause();
        return;

      case 'focus': {
        // Active session: centre toggles pause.
        if (session.currentSession) {
          if (session.currentSession.status === 'paused') {
            session.resumeSession();
            await playback.play();
          } else {
            session.pauseSession();
            await playback.pause();
          }
          return;
        }

        if (session.focusSetupStep === 'duration') {
          session.setSelectedDuration(FOCUS_DURATIONS[cursor]);
          const next = session.advanceSetupStep();
          if (next === 'confirm') await startSession();
          else nav.resetCursor('focus');
          return;
        }

        if (session.focusSetupStep === 'book') {
          // Row 0 is "no audiobook"; the rest map to the browse list.
          const book = cursor === 0 ? null : library.books.slice(0, 40)[cursor - 1];
          session.setFocusSetupBookId(book?.id ?? null);
          if (book) await library.selectBook(book.id);
          const next = session.advanceSetupStep();
          if (next === 'confirm') await startSession();
          else nav.resetCursor('focus');
          return;
        }
        return;
      }

      case 'settings': {
        const row = SETTINGS_ROWS[cursor];
        if (row === 'haptics') await settings.update({ haptics: !settings.preferences.haptics });
        if (row === 'keepAwake') {
          const keepAwake = !settings.preferences.keepAwake;
          webFocusGuard.setKeepAwake(keepAwake);
          await settings.update({ keepAwake });
        }
        if (row === 'rate') {
          const i = PLAYBACK_RATES.indexOf(settings.preferences.playbackRate);
          const rate = PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
          await settings.update({ playbackRate: rate });
          await playback.setRate(rate);
        }
        if (row === 'duration') {
          const i = FOCUS_DURATIONS.indexOf(settings.preferences.defaultSessionDuration);
          session.setSelectedDuration(FOCUS_DURATIONS[(i + 1) % FOCUS_DURATIONS.length]);
          await settings.update({
            defaultSessionDuration: FOCUS_DURATIONS[(i + 1) % FOCUS_DURATIONS.length],
          });
        }
        return;
      }

      default:
        return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.id, cursor, library, playback, session, downloads, settings, nav, openBook]);

  /** Creates and starts a session, and begins the chosen book if there is one. */
  const startSession = useCallback(async () => {
    const bookId = session.focusSetupBookId;
    const created = session.createSession({
      duration: session.selectedDuration,
      blockedApps: session.selectedAppsForSession,
      bookId,
    });
    await session.startSession(created.id);

    if (bookId) {
      const book =
        library.selectedBook?.id === bookId
          ? library.selectedBook
          : library.books.find(b => b.id === bookId);
      if (book && book.chapters.length > 0) {
        await playback.loadBook(book, 0);
        await playback.play();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, library, playback]);

  // ─── MENU ─────────────────────────────────────────────────────────────

  const handleMenu = useCallback(async () => {
    // Leaving an active session is destructive — make it deliberate.
    if (screen.id === 'focus' && session.currentSession) {
      const confirmed = window.confirm('End this focus session?');
      if (!confirmed) return;
      await session.endSession('cancelled');
      await playback.pause();
      nav.pop();
      return;
    }
    if (screen.id === 'search' && searchQuery) {
      setSearchQuery('');
      return;
    }
    nav.pop();
  }, [screen.id, session, playback, nav, searchQuery]);

  // ─── Transport buttons ────────────────────────────────────────────────

  const handleNext = useCallback(async () => {
    if (screen.id === 'search') {
      if (!searchQuery.trim()) return;
      await library.searchBooks(searchQuery);
      nav.resetCursor('search-results');
      nav.push('search-results');
      return;
    }
    await playback.skipToNext();
  }, [screen.id, searchQuery, library, nav, playback]);

  const handlePrevious = useCallback(async () => {
    if (screen.id === 'search') {
      setSearchQuery(q => q.slice(0, -1));
      return;
    }
    await playback.skipToPrevious();
  }, [screen.id, playback]);

  const handlePlayPause = useCallback(async () => {
    await playback.togglePlayPause();
  }, [playback]);

  // ─── Rotation ─────────────────────────────────────────────────────────

  const handleRotate = useCallback(
    (degrees: number) => {
      const direction: 1 | -1 = degrees > 0 ? 1 : -1;

      // On Now Playing the wheel scrubs the chapter instead of moving a cursor,
      // matching the device.
      if (screen.id === 'now-playing') {
        void playback.seekBy(direction * SEEK_PER_DETENT);
        return;
      }
      const count = itemCount(screen.id);
      if (count > 0) nav.moveCursor(screen.id, count, direction);
    },
    [screen.id, playback, itemCount, nav],
  );

  // ─── Keyboard (desktop + accessibility) ───────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          handleRotate(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleRotate(-1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          run(handleSelect);
          break;
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          run(handleMenu);
          break;
        case 'ArrowRight':
          e.preventDefault();
          run(handleNext);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          run(handlePrevious);
          break;
        default:
          // Typing goes straight into the search buffer where a real keyboard
          // exists — far quicker than spelling with the wheel.
          if (screen.id === 'search' && e.key.length === 1) {
            e.preventDefault();
            setSearchQuery(q => (q + e.key.toUpperCase()).slice(0, 40));
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleRotate, handleSelect, handleMenu, handleNext, handlePrevious, screen.id]);

  // ─── Persist playback position ────────────────────────────────────────

  useEffect(() => {
    const save = () => void playback.persistPosition();
    // pagehide is the only event iOS reliably fires before discarding a tab.
    window.addEventListener('pagehide', save);
    const interval = setInterval(save, 15_000);
    return () => {
      window.removeEventListener('pagehide', save);
      clearInterval(interval);
    };
  }, [playback]);

  // ─── Render ───────────────────────────────────────────────────────────

  const renderContent = () => {
    switch (screen.id) {
      case 'home':
        return <HomeMenuView cursor={cursor} />;
      case 'audiobooks':
        return <AudiobooksView cursor={cursor} />;
      case 'search':
        return <SearchView cursor={cursor} query={searchQuery} />;
      case 'search-results':
        return <SearchResultsView cursor={cursor} />;
      case 'downloads':
        return <DownloadsView cursor={cursor} />;
      case 'book-detail':
        return <BookDetailView cursor={cursor} />;
      case 'chapters':
        return <ChaptersView cursor={cursor} />;
      case 'now-playing':
        return <NowPlayingView />;
      case 'focus':
        return <FocusView cursor={cursor} capability={webFocusGuard.capability} />;
      case 'sessions':
        return <SessionsView cursor={cursor} />;
      case 'settings':
        return <SettingsView cursor={cursor} />;
      default:
        return null;
    }
  };

  const statusGlyph =
    playback.status === 'playing' ? '▶' : playback.status === 'buffering' ? '⋯' : null;

  return (
    <div className="device">
      <Lcd
        title={title()}
        status={
          <>
            {session.currentSession && <span>◷</span>}
            {statusGlyph && <span>{statusGlyph}</span>}
          </>
        }
      >
        {renderContent()}
      </Lcd>

      <ClickWheel
        onSelect={() => run(handleSelect)}
        onMenu={() => run(handleMenu)}
        onNext={() => run(handleNext)}
        onPrevious={() => run(handlePrevious)}
        onPlayPause={() => run(handlePlayPause)}
        onRotate={handleRotate}
      />

      <div className="brand">FocusPod</div>
    </div>
  );
}
