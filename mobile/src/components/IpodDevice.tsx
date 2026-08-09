/**
 * IpodDevice — the physical iPod shell + all wheel event routing.
 *
 * Layout (top → bottom, fills the phone screen):
 *   ┌─────────────────────────────┐
 *   │   device body (off-white)   │
 *   │  ┌───────────────────────┐  │
 *   │  │  dark LCD bezel       │  │
 *   │  │ ┌───────────────────┐ │  │
 *   │  │ │  glass (pale grn) │ │  │
 *   │  │ │  [title bar navy] │ │  │
 *   │  │ │  [content area  ] │ │  │
 *   │  │ └───────────────────┘ │  │
 *   │  └───────────────────────┘  │
 *   │        [click wheel]        │
 *   └─────────────────────────────┘
 *
 * Wheel event routing
 * ───────────────────
 *   MENU      → pop stack (or Alert-confirm if session active)
 *   ▶▶        → skipToNext chapter
 *   ◀◀        → skipToPrevious chapter
 *   ▶/||      → global play / pause toggle
 *   Center    → context-sensitive select (see handleSelect)
 *   Rotate    → move cursor (menu screens) OR seek (NowPlayingView)
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Alert,
  Platform,
  Animated,
} from 'react-native';
import {
  requestAccessibilityPermission,
  requestUsageStatsPermission,
} from '../services/blockingService';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useIpodNavStore, ScreenId } from '../stores/ipodNavStore';
import { usePlaybackStore } from '../stores/playbackStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useDownloadStore } from '../stores/downloadStore';

import IpodWheel from './IpodWheel';
import HomeMenuView from '../screens/ipod/HomeMenuView';
import AudiobooksView from '../screens/ipod/AudiobooksView';
import DownloadsView from '../screens/ipod/DownloadsView';
import BookDetailView from '../screens/ipod/BookDetailView';
import NowPlayingView from '../screens/ipod/NowPlayingView';
import FocusView, { FOCUS_DURATIONS } from '../screens/ipod/FocusView';
import SettingsView from '../screens/ipod/SettingsView';
import SearchView from '../screens/ipod/SearchView';

import { IpodColors } from '../constants/colors';
import { IpodLayout } from '../constants/layout';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the number of cursor-navigable rows on the given screen.
 * Reads directly from the stores via getState() — safe to call from
 * handleRotate which already reads fresh state every event.
 */
function getItemCount(screenId: ScreenId): number {
  switch (screenId) {
    case 'home':        return 6; // Audiobooks, Downloads, Search, Now Playing, Focus, Settings
    case 'audiobooks': {
      const lib = useLibraryStore.getState();
      return Math.max(1, lib.books.length + (lib.hasMore ? 1 : 0));
    }
    case 'downloads': {
      const dl = useDownloadStore.getState();
      const count = Object.values(dl.books).filter(
        s => s.status === 'done' || s.status === 'downloading',
      ).length;
      return Math.max(1, count);
    }
    case 'book-detail': return 3;
    case 'now-playing': return 0; // rotation = seek, not cursor
    case 'focus': {
      const sess = useSessionStore.getState();
      // Active session — rotation unused on the focus screen.
      if (sess.currentSession?.status === 'active' || sess.currentSession?.status === 'paused') {
        return 0;
      }
      if (sess.focusSetupStep === 'apps') {
        // While apps are still loading, return 0 so the wheel can't scroll
        // to the Start row before the list is populated. handleSelect also
        // guards against starting while isLoadingApps is true.
        if (sess.isLoadingApps) return 0;
        // apps list + one "Start Session" row
        return sess.installedApps.length + 1;
      }
      if (sess.focusSetupStep === 'book') {
        const lib = useLibraryStore.getState();
        return Math.max(1, lib.books.length + (lib.hasMore ? 1 : 0));
      }
      return FOCUS_DURATIONS.length; // 'duration' step
    }
    case 'settings':    return Platform.OS === 'android' ? 6 : 4;
    case 'search': {
      const lib = useLibraryStore.getState();
      return lib.searchResults.length; // 0 when no results → cursor stays at 0
    }
    default:            return 0;
  }
}

function getScreenTitle(
  id: ScreenId,
  bookTitle: string | null,
  sessionStatus: string | null,
  focusSetupStep: 'duration' | 'book' | 'apps',
): string {
  switch (id) {
    case 'home':        return 'FocusPod';
    case 'audiobooks':  return 'Audiobooks';
    case 'downloads':   return 'Downloads';
    case 'book-detail': return bookTitle ?? 'Book';
    case 'now-playing': return 'Now Playing';
    case 'focus':
      if (sessionStatus === 'active' || sessionStatus === 'paused') return 'Focus Session';
      if (focusSetupStep === 'apps') return 'Block Apps';
      if (focusSetupStep === 'book') return 'Select Book';
      return 'Focus';
    case 'settings':    return 'Settings';
    case 'search':      return 'Search';
    default:            return '';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function IpodDevice() {
  // ── Store subscriptions (render-relevant slices only) ─────────────────────
  const { stack, cursors, push, pop, moveCursor, resetCursor } = useIpodNavStore();

  // Use separate primitive/stable-reference selectors — never return an inline
  // object literal from a Zustand selector, because useSyncExternalStore calls
  // getSnapshot() multiple times per render cycle and Object.is({}, {}) is always
  // false, causing perpetual "snapshot changed" → re-render → "snapshot changed"…
  const playbackStatus = usePlaybackStore(s => s.status);
  const currentBook    = usePlaybackStore(s => s.currentBook);

  const bookCount = useLibraryStore(s => s.books.length);
  const selectedBookTitle = useLibraryStore(s => s.selectedBook?.title ?? null);

  const sessionStatus   = useSessionStore(s => s.currentSession?.status ?? null);
  const focusSetupStep  = useSessionStore(s => s.focusSetupStep);

  const currentEntry = stack[stack.length - 1];
  const currentId = currentEntry.id;
  const cursor = cursors[currentId] ?? 0;

  // ── Rotation accumulator (not state — no re-render needed) ────────────────
  const rotAccumRef = useRef(0);
  // Reset accumulator when screen changes so a drag on one screen doesn't bleed
  useEffect(() => { rotAccumRef.current = 0; }, [currentId]);

  // ── Screen transition fade ─────────────────────────────────────────────────
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const lastScreenId = useRef(currentId);
  useEffect(() => {
    if (lastScreenId.current === currentId) return;
    lastScreenId.current = currentId;
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [currentId, fadeAnim]);

  // ── Auto-pop back to home when a session ends (timer → 0) ─────────────────
  const prevSessionStatus = useRef(sessionStatus);
  useEffect(() => {
    const was = prevSessionStatus.current;
    prevSessionStatus.current = sessionStatus;
    if (
      (was === 'active' || was === 'paused') &&
      sessionStatus === null &&
      currentId === 'focus'
    ) {
      // Session completed naturally — stay on focus screen (shows setup again)
    }
  }, [sessionStatus, currentId]);

  // ── handleSelect ──────────────────────────────────────────────────────────
  const handleSelect = useCallback(() => {
    // Always read fresh store state inside callbacks to avoid stale closures.
    const nav     = useIpodNavStore.getState();
    const pb      = usePlaybackStore.getState();
    const lib     = useLibraryStore.getState();
    const sess    = useSessionStore.getState();
    const sett    = useSettingsStore.getState();
    const dl      = useDownloadStore.getState();
    const cur     = nav.stack[nav.stack.length - 1];
    const c       = nav.cursors[cur.id] ?? 0;
    console.log(`[Device] SELECT screen=${cur.id} cursor=${c}`);

    switch (cur.id) {
      case 'home':
        switch (c) {
          case 0: nav.push('audiobooks'); break;
          case 1: nav.push('downloads'); break;
          case 2: nav.push('search'); break;
          case 3: nav.push('now-playing'); break;
          case 4: sess.resetFocusSetup(); nav.push('focus'); break;
          case 5: nav.push('settings'); break;
        }
        break;

      case 'audiobooks': {
        const books = lib.books;
        const book = books[c];
        if (!book) {
          // Cursor is on the "Load More" row — trigger pagination.
          if (lib.hasMore && !lib.isLoading) {
            lib.loadMore();
          }
          break;
        }
        lib.selectBook(book.id);
        nav.resetCursor('book-detail');
        nav.push('book-detail', { bookId: book.id });
        // Preload chapters into the player while user browses book detail so the
        // first chapter starts buffering before they press Play.
        if (pb.status !== 'playing') {
          pb.loadBook(book).catch(() => {});
        }
        break;
      }

      case 'downloads': {
        const dlState = useDownloadStore.getState();
        const entries = Object.entries(dlState.books).filter(
          ([, s]) => s.status === 'done' || s.status === 'downloading',
        );
        const entry = entries[c];
        if (!entry) break;
        const [bookId] = entry;
        lib.selectBook(bookId);
        nav.resetCursor('book-detail');
        nav.push('book-detail', { bookId });
        break;
      }

      case 'search': {
        const results = lib.searchResults;
        const book = results[c];
        if (!book) break;
        lib.selectBook(book.id);
        nav.resetCursor('book-detail');
        nav.push('book-detail', { bookId: book.id });
        break;
      }

      case 'book-detail': {
        const book = lib.selectedBook;
        if (!book) break;
        if (c === 0) {
          // Play: load book then navigate to Now Playing
          pb.loadBook(book).then(() => pb.play()).catch(console.error);
          nav.push('now-playing');
        } else if (c === 1) {
          // Focus Session: pre-load the book so it's ready when the session
          // starts, then go to the focus setup screen.
          pb.loadBook(book).catch(console.error);
          sess.resetFocusSetup();
          nav.push('focus', { bookId: book.id });
        } else if (c === 2) {
          // Download / cancel download
          const state = dl.getState(book.id);
          if (state.status === 'downloading') {
            dl.cancelDownload(book).catch(console.error);
          } else if (state.status === 'done') {
            // Already downloaded — SELECT again deletes the local copy.
            dl.deleteDownload(book).catch(console.error);
          } else {
            // idle or error → start download
            dl.startDownload(book).catch(console.error);
          }
        }
        break;
      }

      case 'now-playing': {
        // Center = play / pause
        if (pb.status === 'playing') {
          pb.pause();
        } else {
          pb.play().catch(console.error);
        }
        break;
      }

      case 'focus': {
        console.log(
          `[Device] FOCUS SELECT: step=${sess.focusSetupStep}` +
          ` cursor=${c} apps=${sess.installedApps.length}` +
          ` loadingApps=${sess.isLoadingApps}` +
          ` sessionStatus=${sess.currentSession?.status ?? 'none'}`,
        );

        const s = sess.currentSession;
        if (s && (s.status === 'active' || s.status === 'paused')) {
          // ── Active session: SELECT = pause / resume ─────────────────────
          if (s.status === 'active') {
            sess.pauseSession();
            pb.pause();
          } else {
            sess.resumeSession();
            pb.play().catch(console.error);
          }
          break;
        }

        if (sess.focusSetupStep === 'duration') {
          // ── Duration step: SELECT → book step (or apps if bookId pre-set) ─
          const dur = FOCUS_DURATIONS[c] ?? 25;
          sess.setSelectedDuration(dur);
          const bookIdParam = cur.params?.bookId as string | undefined;
          if (bookIdParam) {
            // Came from BookDetail — book is already chosen, skip book step.
            console.log(
              `[Device] FOCUS duration SELECT: dur=${dur} min, bookId=${bookIdParam}` +
              ` — duration → apps (book pre-selected)`,
            );
            sess.setFocusSetupBookId(bookIdParam);
            sess.setFocusSetupStep('apps');
          } else {
            // Came from Home — need to pick a book.
            console.log(
              `[Device] FOCUS duration SELECT: dur=${dur} min — duration → book`,
            );
            // Ensure books are loaded so the list is ready immediately.
            const lib = useLibraryStore.getState();
            if (lib.books.length === 0 && !lib.isLoading) {
              lib.loadBooks();
            }
            sess.setFocusSetupStep('book');
          }
          nav.resetCursor('focus');
          break;
        }

        if (sess.focusSetupStep === 'book') {
          // ── Book step: SELECT chooses audiobook, advances to apps step ────
          const lib = useLibraryStore.getState();
          const books = lib.books;
          if (c >= books.length) {
            // Load More row
            if (lib.hasMore && !lib.isLoading) lib.loadMore();
            break;
          }
          const book = books[c];
          console.log(
            `[Device] FOCUS book SELECT: "${book.title}" (${book.id})` +
            ` — book → apps`,
          );
          sess.setFocusSetupBookId(book.id);
          // Pre-load the book into the player so it's ready when session starts.
          pb.loadBook(book).catch(console.error);
          sess.setFocusSetupStep('apps');
          nav.resetCursor('focus');
          break;
        }

        if (sess.focusSetupStep === 'apps') {
          // Guard: if apps are still loading, ignore the press entirely so
          // the user can't accidentally start a session from the spinner state.
          if (sess.isLoadingApps) {
            console.log('[Device] FOCUS apps SELECT: ignored — apps still loading');
            break;
          }

          const apps = sess.installedApps;
          if (c < apps.length) {
            // ── App row: SELECT toggles blocking for that app ──────────────
            console.log(
              `[Device] FOCUS apps SELECT: toggling ${apps[c].packageName}` +
              ` (currently ${sess.selectedAppsForSession.includes(apps[c].packageName) ? 'blocked' : 'unblocked'})`,
            );
            sess.toggleAppForSession(apps[c].packageName);
          } else {
            // ── Start row: SELECT creates and starts the session ───────────
            console.log(
              `[Device] FOCUS apps START: dur=${sess.selectedDuration} min` +
              ` blockedApps=${JSON.stringify(sess.selectedAppsForSession)}`,
            );
            // Resolve bookId: param (from BookDetail) → chosen in book step → current playback
            const bookIdParam = cur.params?.bookId as string | undefined;
            const bookId = bookIdParam ?? sess.focusSetupBookId ?? pb.currentBook?.id ?? null;
            console.log(`[Device] FOCUS apps START: bookId=${bookId ?? 'none'}`);

            const newSess = sess.createSession({
              duration: sess.selectedDuration,
              blockedApps: sess.selectedAppsForSession,
              bookId,
            });
            // startSession calls blockingService.startBlocking internally.
            sess.startSession(newSess.id);

            // Begin / resume playback.
            if (pb.currentBook && pb.status !== 'playing') {
              pb.play().catch(console.error);
            }
          }
          break;
        }
        break;
      }

      case 'settings': {
        const prefs = sett.preferences;
        if (c === 0) {
          sett.setHaptics(!prefs.haptics);
        } else if (c === 1) {
          const opts = [15, 30, 45, 60];
          const idx = opts.indexOf(prefs.defaultSessionDuration);
          sett.setDefaultDuration(opts[(idx + 1) % opts.length]);
        } else if (c === 2) {
          // Cycle playback speed: 0.75 → 1 → 1.25 → 1.5 → 2 → 0.75
          const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
          const cur = prefs.playbackRate ?? 1;
          const idx = SPEEDS.findIndex(s => Math.abs(s - cur) < 0.01);
          const next = SPEEDS[(idx + 1) % SPEEDS.length];
          sett.setPlaybackRate(next).catch(console.error);
          usePlaybackStore.getState().setRate(next).catch(console.error);
        } else if (c === 4) {
          // Grant Usage Access — open Android Settings > Special App Access > Usage Access
          requestUsageStatsPermission().catch(console.error);
        } else if (c === 5) {
          // Grant Accessibility — open Android Settings > Accessibility
          requestAccessibilityPermission().catch(console.error);
        }
        break;
      }
    }
  }, []); // no deps — reads fresh state every call

  // ── handleMenu ────────────────────────────────────────────────────────────
  const handleMenu = useCallback(() => {
    const nav  = useIpodNavStore.getState();
    const cur  = nav.stack[nav.stack.length - 1];
    console.log(`[Device] MENU screen=${cur.id}`);

    if (cur.id === 'home') return; // already at root

    if (cur.id === 'focus') {
      const sess = useSessionStore.getState();
      const s = sess.currentSession;
      if (s && (s.status === 'active' || s.status === 'paused')) {
        Alert.alert(
          'End Session?',
          'This will cancel your current focus session.',
          [
            { text: 'Keep Going', style: 'cancel' },
            {
              text: 'End Session',
              style: 'destructive',
              onPress: () => {
                sess.endSession('cancelled');
                usePlaybackStore.getState().pause();
                nav.pop();
              },
            },
          ],
        );
        return;
      }

      // MENU in the apps step goes back to book (if we went through it) or duration.
      if (sess.focusSetupStep === 'apps') {
        const bookIdParam = cur.params?.bookId as string | undefined;
        if (bookIdParam) {
          // Came from BookDetail — no book step, so go straight back to duration.
          sess.setFocusSetupStep('duration');
        } else {
          // Came from Home — go back to book selection step.
          sess.setFocusSetupStep('book');
        }
        nav.resetCursor('focus');
        return;
      }
      // MENU in the book step goes back to duration.
      if (sess.focusSetupStep === 'book') {
        sess.setFocusSetupStep('duration');
        nav.resetCursor('focus');
        return;
      }
      // MENU in the duration step falls through to nav.pop() below.
    }

    if (cur.id === 'search') {
      // Clear results and query when leaving search so the screen is fresh
      // next time — avoids stale results from a previous session showing up.
      useLibraryStore.getState().clearSearch();
    }

    nav.pop();
  }, []);

  // ── handleNext / handlePrevious ───────────────────────────────────────────
  const handleNext = useCallback(() => {
    console.log('[Device] NEXT — skip chapter');
    usePlaybackStore.getState().skipToNext();
  }, []);

  // Left wheel button: seek back 30 seconds
  const handlePrevious = useCallback(() => {
    console.log('[Device] SEEK_BACK −30s');
    usePlaybackStore.getState().seekForward(-30).catch(console.error);
  }, []);

  // Bottom wheel button: seek forward 30 seconds
  const handlePlayPause = useCallback(() => {
    console.log('[Device] SEEK_FORWARD +30s');
    usePlaybackStore.getState().seekForward(30).catch(console.error);
  }, []);

  // ── handleRotate ──────────────────────────────────────────────────────────
  const rotLogThrottleRef = useRef(0);
  const handleRotate = useCallback(
    (delta: number) => {
      const nav = useIpodNavStore.getState();
      const cur = nav.stack[nav.stack.length - 1];
      // Log every ~10th rotate event to avoid flooding Logcat
      rotLogThrottleRef.current = (rotLogThrottleRef.current + 1) % 10;
      if (rotLogThrottleRef.current === 0) {
        console.log(`[Device] ROTATE delta=${delta.toFixed(2)} screen=${cur.id}`);
      }

      if (cur.id === 'now-playing') {
        // Rotation seeks through the track: every 3° ≈ 5 s
        const pb = usePlaybackStore.getState();
        const seekDelta = (delta / 3) * 5;
        const pos = pb.position;
        const dur = pb.duration;
        const next = Math.max(0, Math.min(dur, pos + seekDelta));
        pb.seekTo(next).catch(console.error);
        return;
      }

      // For menu screens: accumulate rotation and step cursor by 1 per 18°
      rotAccumRef.current += delta;
      const steps = Math.trunc(rotAccumRef.current / 18);
      if (steps !== 0) {
        rotAccumRef.current -= steps * 18;
        const itemCount = getItemCount(cur.id);
        if (itemCount > 0) {
          const dir = steps > 0 ? 1 : -1;
          for (let i = 0; i < Math.abs(steps); i++) {
            nav.moveCursor(cur.id, itemCount, dir);
          }
        }
      }
    },
    [], // no deps — reads fresh state every call
  );

  // ── Screen content renderer ───────────────────────────────────────────────
  const renderContent = () => {
    switch (currentId) {
      case 'home':        return <HomeMenuView cursor={cursor} />;
      case 'audiobooks':  return <AudiobooksView cursor={cursor} />;
      case 'downloads':   return <DownloadsView cursor={cursor} />;
      case 'book-detail': return <BookDetailView cursor={cursor} />;
      case 'now-playing': return <NowPlayingView />;
      case 'focus':       return <FocusView cursor={cursor} />;
      case 'settings':    return <SettingsView cursor={cursor} />;
      case 'search':      return <SearchView cursor={cursor} />;
      default:            return null;
    }
  };

  const screenTitle = getScreenTitle(currentId, selectedBookTitle, sessionStatus, focusSetupStep);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.device} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={IpodColors.deviceBody} />
      {/* Simulated top-lighter body gradient — white tint fades out after 80 px */}
      <View style={styles.deviceTopTint} />

      {/* ── LCD region ─────────────────────────────────────────────────── */}
      <View style={styles.lcdBezel}>
        <View style={styles.lcdGlass}>
          {/* Title bar */}
          <View style={styles.titleBar}>
            {/* Battery / back chevron on left */}
            {currentId !== 'home' && (
              <Text style={styles.backChevron}>‹</Text>
            )}
            <Text style={styles.titleText} numberOfLines={1}>{screenTitle}</Text>
            {/* Playback indicator on right */}
            <Text style={styles.playIndicator}>
              {playbackStatus === 'playing' ? '▶' : ''}
            </Text>
          </View>

          {/* Content — wrapped in Animated.View for fade transitions */}
          <Animated.View style={[styles.lcdContent, { opacity: fadeAnim }]}>
            {renderContent()}
          </Animated.View>

          {/* Glass reflection sheen — diagonal white stripe at low opacity */}
          <View style={styles.glassSheen} pointerEvents="none" />
        </View>
      </View>

      {/* ── Wheel region ───────────────────────────────────────────────── */}
      <View style={styles.wheelArea}>
        <IpodWheel
          onSelect={handleSelect}
          onMenu={handleMenu}
          onNext={handleNext}
          onPrevious={handlePrevious}
          onPlayPause={handlePlayPause}
          onRotate={handleRotate}
        />
      </View>

      {/* ── Bottom brand strip ─────────────────────────────────────────── */}
      <View style={styles.brandStrip}>
        <Text style={styles.brandText}>FocusPod</Text>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  device: {
    flex: 1,
    backgroundColor: IpodColors.deviceBody,
    alignItems: 'center',
  },

  // Subtle top-lightening gradient overlay — sits above device content
  deviceTopTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 80,
    backgroundColor: 'rgba(255,255,255,0.12)',
    zIndex: 0,
    pointerEvents: 'none' as any,
  },

  // LCD
  lcdBezel: {
    width: IpodLayout.lcdInnerWidth + 2 * IpodLayout.lcdBezelPad + 16,
    height: IpodLayout.lcdRegionH,
    backgroundColor: IpodColors.lcdBezel,
    borderRadius: 10,
    padding: IpodLayout.lcdBezelPad,
    marginTop: 8,
    // Deeper shadow for a premium inset look
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    // Android: no elevation on the bezel — would intercept wheel touches
  },
  lcdGlass: {
    flex: 1,
    backgroundColor: IpodColors.lcdGlass,
    borderRadius: 3,
    overflow: 'hidden',
  },
  // Diagonal glass reflection sheen (absolutely positioned inside lcdGlass)
  glassSheen: {
    position: 'absolute',
    top: -15,
    left: -30,
    width: 110,
    height: 70,
    backgroundColor: 'rgba(255,255,255,0.09)',
    transform: [{ rotateZ: '38deg' }],
  },
  titleBar: {
    height: IpodLayout.lcdTitleBarH,
    backgroundColor: IpodColors.lcdTitleBarBg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  backChevron: {
    color: IpodColors.lcdTitleBarText,
    fontSize: 16,
    fontWeight: '300',
    marginRight: 2,
    opacity: 0.7,
  },
  titleText: {
    flex: 1,
    color: IpodColors.lcdTitleBarText,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  playIndicator: {
    color: IpodColors.lcdTitleBarText,
    fontSize: 10,
    width: 14,
    textAlign: 'right',
    opacity: 0.8,
  },
  lcdContent: {
    flex: 1,
    backgroundColor: IpodColors.rowBg,
  },

  // Wheel area — alignSelf:'stretch' ensures full parent width so the wheel
  // View is not clipped by the parent's alignItems:'center' shrink-wrapping.
  wheelArea: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Bottom brand
  brandStrip: {
    paddingBottom: Platform.OS === 'ios' ? 0 : 4,
    alignItems: 'center',
  },
  brandText: {
    fontSize: 11,
    fontWeight: '300',
    color: IpodColors.deviceBodyShadow,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
