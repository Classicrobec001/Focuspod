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
  useReadAlongStore,
  useSessionStore,
  useSettingsStore,
  GENRES,
  PODCAST_TOPICS,
  usePodcastStore,
  useFavoritesStore,
  listFavorites,
  listFavoriteChapters,
  chapterFavoriteAsBook,
  useAuthStore,
  useStreakStore,
  THEMES,
  scheduleSync,
  onSyncStatus,
  isPodcast,
  fetchVersions,
  type Book,
  type GenreKey,
  type SortOption,
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
  FavoritesView,
  FocusView,
  GenresView,
  HomeMenuView,
  PodcastShowsView,
  PodcastTopicsView,
  HOME_ITEMS,
  NowPlayingView,
  ReadAlongView,
  SearchResultsView,
  SearchView,
  SessionsView,
  SettingsView,
  VersionsView,
  settingsRows,
  WhatsNewView,
  AboutView,
  ThemesView,
  StreakView,
  AccountView,
  FavoriteChaptersView,
  FAVORITES_HEADER_ROWS,
} from '../views';
import { TapProvider } from './TapContext';
import { analytics, setAnalyticsConsent } from '../analytics';
import { CURRENT_VERSION } from '../releaseNotes';
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
  const readAlong = useReadAlongStore();
  const podcasts = usePodcastStore();
  const favorites = useFavoritesStore();
  const auth = useAuthStore();

  /** Search text is transient UI state — it never needs to outlive the screen. */
  const [searchQuery, setSearchQuery] = useState('');
  /** Alternate recordings of the open book; fetched on demand. */
  const [versions, setVersions] = useState<Book[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  /** Email being typed on the account screen — transient, like the search box. */
  const [emailDraft, setEmailDraft] = useState('');
  /** Human-readable sync state, pushed from core rather than polled. */
  const [syncLabel, setSyncLabel] = useState('Synced to your account');

  useEffect(
    () =>
      onSyncStatus(status => {
        setSyncLabel(
          status === 'syncing'
            ? 'Syncing…'
            : status === 'error'
              ? 'Last sync failed — it will retry.'
              : status === 'offline'
                ? 'Offline — will sync when you reconnect.'
                : 'Synced to your account',
        );
      }),
    [],
  );

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
        case 'genres':
          return GENRES.length;
        case 'podcast-topics':
          return PODCAST_TOPICS.length;
        case 'podcast-shows':
          return podcasts.shows.length;
        case 'search':
          return 0; // a text field, not a cursor list
        case 'search-results':
          return library.searchResults.length;
        case 'favorites':
          return FAVORITES_HEADER_ROWS + Object.keys(favorites.items).length;
        case 'favorite-chapters':
          return Object.keys(favorites.chapters).length;
        case 'themes':
          return THEMES.length;
        case 'downloads':
          return downloads.downloadedBooks().length;
        case 'book-detail':
          return BOOK_ACTIONS.length;
        case 'chapters':
          return library.selectedBook?.chapters.length ?? 0;
        case 'versions':
          return versions.length;
        case 'sessions':
          return session.sessions.length;
        case 'settings':
          return settingsRows().length;
        case 'focus':
          if (session.currentSession) return 0;
          if (session.focusSetupStep === 'duration') return FOCUS_DURATIONS.length;
          if (session.focusSetupStep === 'book') return library.books.slice(0, 40).length + 1;
          return 0;
        case 'now-playing':
        case 'read-along':
        case 'streak':
        case 'account':
          return 0; // rotation scrubs / scrolls instead of moving a cursor
        default:
          return 0;
      }
    },
    [
      library.books,
      library.searchResults,
      library.selectedBook,
      downloads,
      session,
      podcasts.shows,
      versions,
      favorites.items,
      favorites.chapters,
    ],
  );

  // ─── Titles ───────────────────────────────────────────────────────────

  const title = useCallback((): string => {
    switch (screen.id) {
      case 'home':
        return 'FocusPod';
      case 'audiobooks':
        return 'Audiobooks';
      case 'genres':
        return 'Genres';
      case 'podcast-topics':
        return 'Podcasts';
      case 'podcast-shows':
        return PODCAST_TOPICS.find(t => t.key === podcasts.topic)?.label ?? 'Shows';
      case 'search':
        return 'Search';
      case 'search-results':
        return `Results (${library.searchResults.length})`;
      case 'favorites':
        return 'Favourites';
      case 'favorite-chapters':
        return 'Saved Chapters';
      case 'themes':
        return 'Theme';
      case 'streak':
        return 'Streak';
      case 'account':
        return 'Account';
      case 'downloads':
        return 'Downloads';
      case 'book-detail':
        return library.selectedBook?.title ?? 'Book';
      case 'chapters':
        return 'Chapters';
      case 'versions':
        return 'Other Recordings';
      case 'now-playing':
        return 'Now Playing';
      case 'read-along':
        return 'Read Along';
      case 'focus':
        return session.currentSession ? 'Focus' : 'New Session';
      case 'sessions':
        return 'Past Sessions';
      case 'settings':
        return 'Settings';
      case 'whats-new':
        return "What's New";
      case 'about':
        return 'About';
      default:
        return 'FocusPod';
    }
  }, [screen.id, library.searchResults.length, library.selectedBook, session.currentSession, podcasts.topic]);

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

  /**
   * Acts on a row. `atIndex` lets a tap act on the row that was touched rather
   * than the one the cursor happens to sit on; the wheel passes nothing and
   * gets the cursor, exactly as before.
   */
  const handleSelect = useCallback(async (atIndex?: number) => {
    const index = atIndex ?? cursor;
    switch (screen.id) {
      case 'home': {
        const target = HOME_ITEMS[index]?.key as ScreenId | undefined;
        if (!target) return;
        if (target === 'focus') session.resetFocusSetup();
        if (target === 'search') setSearchQuery('');
        nav.resetCursor(target);
        nav.push(target);
        return;
      }

      case 'audiobooks': {
        const book = library.books[index];
        if (book) await openBook(book.id);
        return;
      }

      case 'genres': {
        const genre = GENRES[index];
        if (!genre) return;
        // Navigate first, then fetch. Awaiting the network before pushing left
        // the wheel looking dead for several seconds; this way the list screen
        // appears at once and shows its own loading state.
        nav.resetCursor('audiobooks');
        nav.push('audiobooks');
        analytics.browseGenre(genre.key);
        await library.setGenre(genre.key as GenreKey);
        return;
      }

      case 'search-results': {
        const book = library.searchResults[index];
        if (book) await openBook(book.id);
        return;
      }

      // The search screen is a text field; the centre button submits it.
      case 'search':
        await handleNext();
        return;

      case 'podcast-topics': {
        const topic = PODCAST_TOPICS[index];
        if (!topic) return;
        nav.resetCursor('podcast-shows');
        nav.push('podcast-shows');
        analytics.browsePodcastTopic(topic.key);
        await podcasts.loadTopic(topic.key);
        return;
      }

      case 'podcast-shows': {
        const show = podcasts.shows[index];
        if (!show) return;
        // Shows arrive already hydrated by the verification pass, so the detail
        // screen can be shown straight away with no second fetch.
        library.setSelectedBook(show);
        nav.resetCursor('book-detail');
        nav.push('book-detail');
        return;
      }

      case 'favorites': {
        // Row 0 is the saved-chapters list; the books start below it.
        if (index < FAVORITES_HEADER_ROWS) {
          nav.resetCursor('favorite-chapters');
          nav.push('favorite-chapters');
          return;
        }
        const favorite = listFavorites(favorites.items)[index - FAVORITES_HEADER_ROWS];
        if (!favorite) return;
        nav.resetCursor('book-detail');
        nav.push('book-detail');
        // openBook resolves chapters from downloads, the feed or the catalog,
        // whichever applies to this record.
        await library.openBook(favorite);
        return;
      }

      case 'favorite-chapters': {
        const saved = listFavoriteChapters(favorites.chapters)[index];
        if (!saved) return;
        // Plays from the stored record without fetching the book first — the
        // whole point of saving a chapter. See chapterFavoriteAsBook.
        analytics.play(isPodcast(saved.bookId) ? 'podcast' : 'book', saved.bookId);
        await playback.loadBook(chapterFavoriteAsBook(saved), 0);
        await playback.play();
        nav.push('now-playing');
        return;
      }

      case 'themes': {
        const theme = THEMES[index];
        if (!theme) return;
        if (theme.locked && !auth.entitlements().allThemes) {
          // Route to the thing that unlocks it rather than refusing silently.
          nav.resetCursor('account');
          nav.push('account');
          analytics.themeLocked(theme.id);
          return;
        }
        await settings.update({ theme: theme.id });
        analytics.themeChange(theme.id);
        scheduleSync();
        return;
      }

      case 'account': {
        if (auth.status === 'signed-in') {
          await auth.signOut();
          analytics.signOut();
          return;
        }
        // Resending is the only useful action while waiting for a link.
        const address = auth.status === 'link-sent' ? (auth.pendingEmail ?? '') : emailDraft;
        if (!address) return;
        const sent = await auth.sendLink(address);
        if (sent) analytics.signInRequested();
        return;
      }

      case 'downloads': {
        const entry = downloads.downloadedBooks()[index];
        if (entry) await openBook(entry.bookId);
        return;
      }

      case 'versions': {
        const chosen = versions[index];
        if (!chosen) return;
        // Replace the open book with the chosen reading and return to detail,
        // so Play/Download/Read Along all act on the recording just picked.
        nav.pop();
        nav.resetCursor('book-detail');
        await library.selectBook(chosen.id);
        return;
      }

      case 'chapters': {
        const book = library.selectedBook;
        if (!book || book.chapters.length === 0) return;
        await playback.loadBook(book, index);
        await playback.play();
        nav.push('now-playing');
        return;
      }

      case 'book-detail': {
        const book = library.selectedBook;
        if (!book) return;

        switch (BOOK_ACTIONS[index]) {
          case 'Play': {
            if (book.chapters.length === 0) return; // still hydrating
            analytics.play(isPodcast(book.id) ? 'podcast' : 'book', book.id);
            await playback.loadBook(book, 0);
            await playback.play();
            nav.push('now-playing');
            return;
          }
          case 'Favourite': {
            const nowFavorite = await favorites.toggle(book);
            analytics.favorite(nowFavorite, isPodcast(book.id) ? 'podcast' : 'book');
            scheduleSync();
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
            else {
              analytics.downloadStart(book.chapters.length);
              await downloads.startDownload(book);
            }
            return;
          }
          case 'Read Along': {
            // Reading needs a loaded book: the estimate is derived from the
            // playhead, so start it if this book isn't the one playing.
            if (playback.currentBook?.id !== book.id) {
              if (book.chapters.length === 0) return;
              await playback.loadBook(book, 0);
            }
            nav.push('read-along');
            await readAlong.load(book);
            return;
          }
          case 'Other Recordings': {
            // Podcasts have no alternate readings — there is one recording.
            if (isPodcast(book.id)) return;
            nav.resetCursor('versions');
            nav.push('versions');
            setVersionsLoading(true);
            try {
              setVersions(await fetchVersions(book));
            } catch {
              setVersions([]);
            } finally {
              setVersionsLoading(false);
            }
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

      // On the real device Select cycles through the Now Playing views while
      // play/pause stays on the wheel's own button — which is also what frees
      // the centre press for the reader.
      case 'now-playing': {
        if (!playback.currentBook) return;
        nav.push('read-along');
        await readAlong.load(playback.currentBook);
        analytics.readAlongOpen(useReadAlongStore.getState().alignmentQuality ?? 'none');
        return;
      }

      // Centre re-centres on the estimated position and resumes following after
      // the reader has scrolled away.
      case 'read-along': {
        const book = playback.currentBook;
        if (!book) return;
        readAlong.syncToChapter(book, playback.currentChapterIndex, playback.position);
        return;
      }

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
          session.setSelectedDuration(FOCUS_DURATIONS[index]);
          const next = session.advanceSetupStep();
          if (next === 'confirm') await startSession();
          else nav.resetCursor('focus');
          return;
        }

        if (session.focusSetupStep === 'book') {
          // Row 0 is "no audiobook"; the rest map to the browse list.
          const book = index === 0 ? null : library.books.slice(0, 40)[index - 1];
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
        const row = settingsRows()[index];
        if (row === 'haptics') await settings.update({ haptics: !settings.preferences.haptics });
        if (row === 'tap') await settings.update({ tapToSelect: !settings.preferences.tapToSelect });
        if (row === 'analytics') {
          const consent = !settings.preferences.analyticsConsent;
          setAnalyticsConsent(consent);
          await settings.update({ analyticsConsent: consent });
        }
        if (row === 'whatsnew') {
          nav.push('whats-new');
          // Reading it clears the marker.
          await settings.update({ lastSeenVersion: CURRENT_VERSION });
        }
        if (row === 'about') nav.push('about');
        if (row === 'theme') {
          nav.resetCursor('themes');
          nav.push('themes');
        }
        if (row === 'account') {
          setEmailDraft('');
          nav.push('account');
        }
        if (row === 'streak') {
          const streakEnabled = !settings.preferences.streakEnabled;
          // Stop crediting immediately rather than at the next status change,
          // so turning it off mid-chapter really does stop the counter.
          if (!streakEnabled) await useStreakStore.getState().suspend();
          await settings.update({ streakEnabled });
        }
        if (row === 'keepAwake') {
          const keepAwake = !settings.preferences.keepAwake;
          webFocusGuard.setKeepAwake(keepAwake);
          await settings.update({ keepAwake });
        }
        if (row === 'sort') {
          const order: SortOption[] = ['popular', 'recent', 'title'];
          const next = order[(order.indexOf(library.sort) + 1) % order.length];
          await library.setSort(next);
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
    // `podcasts` and `readAlong` are read for data here, not just actions, so
    // they must be dependencies — omitting them left handleSelect closing over
    // an empty show list, and selecting a podcast did nothing.
  }, [screen.id, cursor, library, playback, session, downloads, settings, nav, openBook, podcasts, readAlong, versions, favorites, auth, emailDraft]);

  /**
   * A tapped row. The cursor moves there first so the highlight matches what
   * was touched, then the same dispatcher runs — tapping and the wheel can
   * never diverge because there is only one implementation of "select".
   */
  const handlePick = useCallback(
    (index: number) => {
      nav.setCursor(screen.id, index);
      run(() => handleSelect(index));
    },
    [nav, screen.id, handleSelect],
  );

  /** Creates and starts a session, and begins the chosen book if there is one. */
  const startSession = useCallback(async () => {
    const bookId = session.focusSetupBookId;
    const created = session.createSession({
      duration: session.selectedDuration,
      blockedApps: session.selectedAppsForSession,
      bookId,
    });
    await session.startSession(created.id);
    analytics.focusStart(session.selectedDuration);

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
      analytics.focusEnd(
        session.currentSession.duration,
        'cancelled',
        session.currentSession.distractions.length,
      );
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
    // On the chapter list ▶▶ saves the highlighted chapter instead of skipping
    // tracks — the same repurposing the search screen already does, and the
    // footer there says so. Nothing is playing on this screen for a skip to
    // act on anyway.
    if (screen.id === 'chapters') {
      const book = library.selectedBook;
      const chapter = book?.chapters[cursor];
      if (!book || !chapter) return;
      const saved = await favorites.toggleChapter(book, chapter);
      analytics.favoriteChapter(saved);
      scheduleSync();
      return;
    }
    // Removing is the one thing worth doing to an already-saved chapter.
    if (screen.id === 'favorite-chapters') {
      const saved = listFavoriteChapters(favorites.chapters)[cursor];
      if (!saved) return;
      await favorites.removeChapter(saved.chapter.id);
      analytics.favoriteChapter(false);
      scheduleSync();
      return;
    }
    if (screen.id === 'account') {
      await handleSelect();
      return;
    }
    if (screen.id === 'search') {
      if (!searchQuery.trim()) return;
      await library.searchBooks(searchQuery);
      analytics.search('books', useLibraryStore.getState().searchResults.length);
      nav.resetCursor('search-results');
      nav.push('search-results');
      return;
    }
    await playback.skipToNext();
  }, [screen.id, searchQuery, library, nav, playback, cursor, favorites, handleSelect]);

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
      // In the reader it turns pages. Scrolling by hand hands control to the
      // reader; the centre button gives it back to the estimate.
      if (screen.id === 'read-along') {
        readAlong.scrollBy(direction);
        return;
      }
      const count = itemCount(screen.id);
      if (count > 0) nav.moveCursor(screen.id, count, direction);
    },
    [screen.id, playback, itemCount, nav, readAlong],
  );

  // ─── Follow the audio in the reader ───────────────────────────────────

  useEffect(() => {
    if (screen.id !== 'read-along') return;
    const { currentBook, currentChapterIndex, position } = playback;
    if (!currentBook || !readAlong.following || !readAlong.text) return;
    // The estimate only needs to move about as often as a paragraph is read;
    // re-deriving it on every progress tick would fight the reader's scrolling.
    readAlong.syncToChapter(currentBook, currentChapterIndex, position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    screen.id,
    playback.currentChapterIndex,
    Math.floor(playback.position / 15),
    readAlong.following,
    readAlong.text,
  ]);

  // ─── Keyboard (desktop + accessibility) ───────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While a text field has focus the keyboard belongs to it. Without this,
      // typing would be duplicated into the search buffer and Backspace would
      // be swallowed as a Back action, making the field impossible to edit.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return;

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
          e.preventDefault();
          run(() => handleSelect());
          break;
        // Space is the play/pause key everywhere else on the web, and the
        // centre button no longer pauses now that it opens the reader.
        case ' ':
          e.preventDefault();
          run(handlePlayPause);
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
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleRotate, handleSelect, handleMenu, handleNext, handlePrevious, handlePlayPause, screen.id]);

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
      case 'genres':
        return <GenresView cursor={cursor} />;
      case 'podcast-topics':
        return <PodcastTopicsView cursor={cursor} />;
      case 'podcast-shows':
        return <PodcastShowsView cursor={cursor} />;
      case 'search':
        return (
          <SearchView
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onSubmit={() => run(handleNext)}
            scope="books"
          />
        );
      case 'search-results':
        return <SearchResultsView cursor={cursor} />;
      case 'favorites':
        return <FavoritesView cursor={cursor} />;
      case 'favorite-chapters':
        return <FavoriteChaptersView cursor={cursor} />;
      case 'themes':
        return <ThemesView cursor={cursor} />;
      case 'streak':
        return <StreakView />;
      case 'account':
        return (
          <AccountView
            email={emailDraft}
            onEmailChange={setEmailDraft}
            onSubmit={() => run(() => handleSelect())}
            syncLabel={syncLabel}
          />
        );
      case 'downloads':
        return <DownloadsView cursor={cursor} />;
      case 'book-detail':
        return <BookDetailView cursor={cursor} />;
      case 'chapters':
        return <ChaptersView cursor={cursor} />;
      case 'versions':
        return <VersionsView cursor={cursor} versions={versions} isLoading={versionsLoading} />;
      case 'now-playing':
        return <NowPlayingView />;
      case 'read-along':
        return <ReadAlongView />;
      case 'focus':
        return <FocusView cursor={cursor} capability={webFocusGuard.capability} />;
      case 'sessions':
        return <SessionsView cursor={cursor} />;
      case 'settings':
        return <SettingsView cursor={cursor} />;
      case 'whats-new':
        return <WhatsNewView />;
      case 'about':
        return <AboutView />;
      default:
        return null;
    }
  };

  const statusGlyph =
    playback.status === 'playing' ? '▶' : playback.status === 'buffering' ? '⋯' : null;

  return (
    <TapProvider value={{ enabled: settings.preferences.tapToSelect, onPick: handlePick }}>
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
        onSelect={() => run(() => handleSelect())}
        onMenu={() => run(handleMenu)}
        onNext={() => run(handleNext)}
        onPrevious={() => run(handlePrevious)}
        onPlayPause={() => run(handlePlayPause)}
        onRotate={handleRotate}
      />

        <div className="brand">FocusPod</div>
      </div>
    </TapProvider>
  );
}
