/**
 * FocusView — three-mode Focus screen rendered inside the LCD.
 *
 * ── Mode 1: DURATION (focusSetupStep === 'duration') ─────────────────────────
 *   Shows FOCUS_DURATIONS rows.  Cursor highlights the duration to start with.
 *   SELECT → store duration, advance to APPS step.
 *   MENU   → handled by IpodDevice (pops back to home).
 *
 * ── Mode 2: APPS (focusSetupStep === 'apps') ─────────────────────────────────
 *   Shows installed non-system apps with a checkmark toggle.
 *   Last row is always "▶ Start Session".
 *   SELECT on an app row  → toggle blocking for that app.
 *   SELECT on Start row   → IpodDevice creates + starts session.
 *   MENU                  → IpodDevice goes back to DURATION step (no pop).
 *
 * ── Mode 3: ACTIVE / PAUSED ──────────────────────────────────────────────────
 *   Shows countdown timer, progress bar, book title.
 *   SELECT → IpodDevice pauses / resumes.
 *   MENU   → IpodDevice shows "End Session?" alert.
 *
 * Wheel mapping in all modes is handled by IpodDevice.handleSelect /
 * handleMenu / handleRotate.  getItemCount() in IpodDevice reads
 * sessionStore.focusSetupStep and sessionStore.installedApps.length to
 * return the correct cursor range per step.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useSessionStore } from '../../stores/sessionStore';
import { usePlaybackStore } from '../../stores/playbackStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { IpodColors } from '../../constants/colors';
import { IpodLayout } from '../../constants/layout';

interface Props {
  cursor: number;
}

export const FOCUS_DURATIONS = [15, 25, 30, 45, 60] as const;

const VISIBLE = IpodLayout.lcdVisibleRows;

export default function FocusView({ cursor }: Props) {
  const focusSetupStep     = useSessionStore(s => s.focusSetupStep);
  const installedApps      = useSessionStore(s => s.installedApps);
  const isLoadingApps      = useSessionStore(s => s.isLoadingApps);
  const selectedApps       = useSessionStore(s => s.selectedAppsForSession);
  const selectedDuration   = useSessionStore(s => s.selectedDuration);
  const currentSession     = useSessionStore(s => s.currentSession);
  const remainingSeconds   = useSessionStore(s => s.remainingSeconds);
  const loadInstalledApps  = useSessionStore(s => s.loadInstalledApps);

  const bookTitle = usePlaybackStore(s => s.currentBook?.title ?? null);

  const books          = useLibraryStore(s => s.books);
  const isLoadingBooks = useLibraryStore(s => s.isLoading);
  const hasMoreBooks   = useLibraryStore(s => s.hasMore);
  const loadBooks      = useLibraryStore(s => s.loadBooks);

  // Pre-load installed apps during duration step so it's ready by the time the
  // user reaches the apps step. Also ensure the book list is loaded so it's
  // available immediately when the book step is shown.
  useEffect(() => {
    console.log('[FocusView] mounted — calling loadInstalledApps()');
    loadInstalledApps();
    if (books.length === 0 && !isLoadingBooks) {
      loadBooks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  console.log(
    `[FocusView] render: step=${focusSetupStep}` +
    ` apps=${installedApps.length} loadingApps=${isLoadingApps}` +
    ` cursor=${cursor} isActive=${
      currentSession?.status === 'active' || currentSession?.status === 'paused'
    }`,
  );

  const isActive =
    currentSession?.status === 'active' || currentSession?.status === 'paused';

  // ── Mode 3: ACTIVE / PAUSED ──────────────────────────────────────────────
  if (isActive && currentSession) {
    const h = Math.floor(remainingSeconds / 3600);
    const m = Math.floor((remainingSeconds % 3600) / 60);
    const s = remainingSeconds % 60;
    const timeStr =
      h > 0
        ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
        : `${m}:${s.toString().padStart(2, '0')}`;

    const isPaused = currentSession.status === 'paused';
    const progress =
      currentSession.duration > 0
        ? 1 - remainingSeconds / (currentSession.duration * 60)
        : 0;
    const blockedCount = currentSession.blockedApps.length;

    return (
      <View style={styles.activeContainer}>
        <Text style={styles.sessionLabel}>
          {isPaused ? '|| PAUSED' : '● FOCUS'}
        </Text>
        <Text style={styles.timer}>{timeStr}</Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(1, progress) * 100}%` }]} />
        </View>

        {bookTitle ? (
          <Text style={styles.bookHint} numberOfLines={1}>♪ {bookTitle}</Text>
        ) : null}

        {blockedCount > 0 && (
          <Text style={styles.blockedHint}>
            {blockedCount} app{blockedCount !== 1 ? 's' : ''} blocked
          </Text>
        )}

        <Text style={styles.hint}>
          {isPaused ? 'SELECT to resume · MENU to end' : 'SELECT to pause · MENU to end'}
        </Text>
      </View>
    );
  }

  // ── Mode 2: APPS ─────────────────────────────────────────────────────────
  if (focusSetupStep === 'apps') {
    const totalRows = installedApps.length + 1; // +1 for "Start Session" row

    // Clamp cursor so it never exceeds the current list size (guard for async load)
    const clampedCursor = Math.min(cursor, Math.max(0, totalRows - 1));
    const windowStart = Math.max(
      0,
      Math.min(clampedCursor - Math.floor(VISIBLE / 2), totalRows - VISIBLE),
    );
    const windowEnd = Math.min(totalRows, windowStart + VISIBLE);

    return (
      <View style={styles.container}>
        {/* Header — always visible so user can confirm the view switched */}
        <View style={styles.headerRow}>
          <Text style={styles.headerText}>
            Select apps to block · {selectedApps.length} selected
          </Text>
        </View>

        {/* Spinner while loading (shown below header, not as full-screen replacement) */}
        {isLoadingApps && installedApps.length === 0 && (
          <View style={styles.centred}>
            <ActivityIndicator size="small" color={IpodColors.rowText} />
            <Text style={styles.loadingText}>Loading apps…</Text>
          </View>
        )}

        {/* Empty state after load completes with no user apps (e.g. fresh emulator) */}
        {!isLoadingApps && installedApps.length === 0 && (
          <View style={styles.emptyHint}>
            <Text style={styles.loadingText}>No user apps found.</Text>
            <Text style={styles.hint}>SELECT Start to focus without blocking.</Text>
          </View>
        )}

        {/* App rows + Start row (hidden while first load spinner is showing) */}
        {!isLoadingApps &&
          Array.from({ length: windowEnd - windowStart }, (_, i) => {
            const idx = windowStart + i;
            const selected = idx === clampedCursor;

            // Start Session row (always last)
            if (idx === installedApps.length) {
              return (
                <View key="start" style={[styles.row, selected && styles.rowSelected]}>
                  <Text style={[styles.rowText, selected && styles.rowTextSelected]}>
                    {`▶  Start  (${selectedDuration} min`}
                    {selectedApps.length > 0
                      ? `, ${selectedApps.length} blocked)`
                      : ', no blocking)'}
                  </Text>
                </View>
              );
            }

            const app = installedApps[idx];
            const isBlocked = selectedApps.includes(app.packageName);
            return (
              <View key={app.packageName} style={[styles.row, selected && styles.rowSelected]}>
                <Text
                  style={[styles.rowText, selected && styles.rowTextSelected]}
                  numberOfLines={1}
                >
                  {app.appName}
                </Text>
                {isBlocked && (
                  <Text style={[styles.check, selected && styles.checkSelected]}>✓</Text>
                )}
              </View>
            );
          })}
      </View>
    );
  }

  // ── Mode 1b: BOOK SELECTION ───────────────────────────────────────────────
  if (focusSetupStep === 'book') {
    if (isLoadingBooks && books.length === 0) {
      return (
        <View style={styles.centred}>
          <ActivityIndicator size="small" color={IpodColors.rowText} />
          <Text style={styles.loadingText}>Loading books…</Text>
        </View>
      );
    }

    const totalRows = books.length + (hasMoreBooks ? 1 : 0);
    const clampedCursor = Math.min(cursor, Math.max(0, totalRows - 1));
    const windowStart = Math.max(
      0,
      Math.min(clampedCursor - Math.floor(VISIBLE / 2), totalRows - VISIBLE),
    );
    const windowEnd = Math.min(totalRows, windowStart + VISIBLE);

    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.headerText}>Select Audiobook</Text>
        </View>

        {books.length === 0 && !isLoadingBooks && (
          <View style={styles.emptyHint}>
            <Text style={styles.loadingText}>No books found.</Text>
          </View>
        )}

        {Array.from({ length: windowEnd - windowStart }, (_, i) => {
          const idx = windowStart + i;
          const selected = idx === clampedCursor;

          if (idx === books.length) {
            return (
              <View key="load-more" style={[styles.row, selected && styles.rowSelected]}>
                <Text style={[styles.rowText, selected && styles.rowTextSelected]}>
                  {isLoadingBooks ? 'Loading…' : 'Load More'}
                </Text>
              </View>
            );
          }

          const book = books[idx];
          return (
            <View key={book.id} style={[styles.row, selected && styles.rowSelected]}>
              <Text
                style={[styles.rowText, selected && styles.rowTextSelected]}
                numberOfLines={1}
              >
                {book.title}
              </Text>
              <Text style={[styles.arrow, selected && styles.arrowSelected]}>›</Text>
            </View>
          );
        })}
      </View>
    );
  }

  // ── Mode 1: DURATION ─────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerText}>Focus Duration</Text>
      </View>
      {FOCUS_DURATIONS.map((dur, i) => {
        const selected = i === cursor;
        return (
          <View key={dur} style={[styles.row, selected && styles.rowSelected]}>
            <Text style={[styles.rowText, selected && styles.rowTextSelected]}>
              {dur < 60 ? `${dur} min` : `${dur / 60} hr`}
            </Text>
            {selected && (
              <Text style={[styles.selectHint, styles.selectHintActive]}>SELECT →</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // ── Shared row chrome ─────────────────────────────────────────────────────
  headerRow: {
    height: IpodLayout.lcdRowH - 4,
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: IpodColors.lcdGlass,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: IpodColors.rowDivider,
  },
  headerText: {
    fontSize: 10,
    fontWeight: '700',
    color: IpodColors.rowArrow,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  row: {
    height: IpodLayout.lcdRowH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: IpodColors.rowDivider,
    backgroundColor: IpodColors.rowBg,
  },
  rowSelected: { backgroundColor: IpodColors.rowSelectedBg },
  rowText: {
    flex: 1,
    fontSize: 13,
    color: IpodColors.rowText,
    fontWeight: '500',
  },
  rowTextSelected: { color: IpodColors.rowSelectedText, fontWeight: '600' },

  // ── Duration step ─────────────────────────────────────────────────────────
  selectHint: { fontSize: 9, color: IpodColors.rowArrow },
  selectHintActive: { color: 'rgba(255,255,255,0.7)' },

  // ── Book step ─────────────────────────────────────────────────────────────
  arrow: { fontSize: 16, color: IpodColors.rowArrow, marginLeft: 4 },
  arrowSelected: { color: IpodColors.rowSelectedText },

  // ── Apps step ─────────────────────────────────────────────────────────────
  check: { fontSize: 13, color: IpodColors.progressFill, marginLeft: 6 },
  checkSelected: { color: 'rgba(255,255,255,0.9)' },

  centred: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  emptyHint: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
  },
  loadingText: { fontSize: 12, color: IpodColors.rowText },

  // ── Active session ────────────────────────────────────────────────────────
  activeContainer: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 4,
    justifyContent: 'space-between',
  },
  sessionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: IpodColors.sessionActive,
    letterSpacing: 1.5,
  },
  timer: {
    fontSize: 28,
    fontWeight: '200',
    color: IpodColors.rowText,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: IpodColors.progressTrack,
    overflow: 'hidden',
    marginVertical: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: IpodColors.progressFill,
    borderRadius: 2,
  },
  bookHint: {
    fontSize: 10,
    color: IpodColors.paused,
    numberOfLines: 1,
  } as any,
  blockedHint: {
    fontSize: 10,
    color: IpodColors.rowArrow,
  },
  hint: {
    fontSize: 9,
    color: IpodColors.rowArrow,
    fontStyle: 'italic',
  },
});
