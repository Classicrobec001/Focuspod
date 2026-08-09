/**
 * NowPlayingView — LCD content for the Now Playing screen.
 *
 * Shows current book/chapter info and a live progress bar driven by
 * react-native-track-player's useProgress() hook (updates every second).
 *
 * When buffering, the progress bar is replaced by an animated shimmer bar
 * and a spinning character indicator cycles at 200 ms so the user has a
 * clear visual that audio is loading rather than the app being frozen.
 *
 * Wheel mapping (handled by IpodDevice):
 *   Center    → play / pause
 *   Rotate    → seek through track
 *   ◀◀ / ▶▶  → skip chapter
 *   ▶/||      → play / pause
 *   MENU      → go back
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Image, Platform } from 'react-native';
import { useProgress, usePlaybackState, State } from 'react-native-track-player';
import { usePlaybackStore } from '../../stores/playbackStore';
import { IpodColors } from '../../constants/colors';

// Spinning characters that cycle when buffering — visible even on tiny LCD.
const SPINNER_FRAMES = ['—', '\\', '|', '/'] as const;
const SPINNER_INTERVAL_MS = 150;

export default function NowPlayingView() {
  const { position, duration } = useProgress(500);
  const { state: rnState }     = usePlaybackState();
  const currentBook            = usePlaybackStore(s => s.currentBook);
  const currentChapterIndex    = usePlaybackStore(s => s.currentChapterIndex);

  const isPlaying   = rnState === State.Playing;
  const isBuffering = rnState === State.Buffering || rnState === State.Loading;
  const chapter     = currentBook?.chapters[currentChapterIndex];
  const progress    = duration > 0 ? Math.min(1, position / duration) : 0;

  // ── Spinner state ──────────────────────────────────────────────────────────
  const spinnerFrameRef = useRef(0);
  const spinnerCharRef  = useRef<string>(SPINNER_FRAMES[0]);
  // Single Animated.Value used to force a re-render on each tick.
  const spinnerTick     = useRef(new Animated.Value(0)).current;
  const spinnerTimer    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Advance spinner while buffering; clear when done.
  useEffect(() => {
    if (isBuffering) {
      spinnerTimer.current = setInterval(() => {
        spinnerFrameRef.current = (spinnerFrameRef.current + 1) % SPINNER_FRAMES.length;
        spinnerCharRef.current  = SPINNER_FRAMES[spinnerFrameRef.current];
        // Nudge the Animated.Value to force a re-render without setState.
        spinnerTick.setValue(spinnerFrameRef.current);
      }, SPINNER_INTERVAL_MS);
    } else {
      if (spinnerTimer.current !== null) {
        clearInterval(spinnerTimer.current);
        spinnerTimer.current = null;
      }
      spinnerFrameRef.current = 0;
      spinnerCharRef.current  = SPINNER_FRAMES[0];
    }
    return () => {
      if (spinnerTimer.current !== null) clearInterval(spinnerTimer.current);
    };
  }, [isBuffering, spinnerTick]);

  return (
    <View style={styles.container}>
      {/* Book cover with glow shadow */}
      {currentBook?.coverUrl ? (
        <View style={styles.coverWrapper}>
          <Image
            source={{ uri: currentBook.coverUrl }}
            style={styles.coverImage}
            resizeMode="cover"
          />
        </View>
      ) : (
        <View style={[styles.coverWrapper, styles.coverPlaceholder]}>
          <Text style={styles.coverPlaceholderText}>♪</Text>
        </View>
      )}

      {/* Author */}
      <Text style={styles.artist} numberOfLines={1}>
        {currentBook?.author ?? '—'}
      </Text>

      {/* Book title */}
      <Text style={styles.album} numberOfLines={1}>
        {currentBook?.title ?? 'No book loaded'}
      </Text>

      {/* Chapter title */}
      <Text style={styles.track} numberOfLines={1}>
        {chapter?.title ?? '—'}
      </Text>

      {/* Progress / buffering area */}
      {isBuffering ? (
        <View style={styles.bufferingArea}>
          {/* Shimmer bar — full-width animated placeholder */}
          <View style={styles.shimmerTrack}>
            <Animated.View
              style={[
                styles.shimmerFill,
                {
                  // oscillate width between 15% and 85% using spinnerTick
                  width: spinnerTick.interpolate({
                    inputRange: [0, 1, 2, 3],
                    outputRange: ['15%', '55%', '85%', '45%'],
                  }),
                },
              ]}
            />
          </View>
          {/* Spinner + label */}
          <Animated.Text style={styles.bufferingLabel}>
            {spinnerCharRef.current}{'  Buffering…'}
          </Animated.Text>
        </View>
      ) : (
        <View style={styles.progressRow}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>
      )}

      {/* Playback status */}
      <Text style={styles.status}>
        {isPlaying ? '▶  Playing' : '||  Paused'}
      </Text>
    </View>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 4,
    justifyContent: 'space-between',
  },
  coverWrapper: {
    width: 54,
    height: 54,
    borderRadius: 4,
    overflow: 'hidden',
    alignSelf: 'center',
    marginBottom: 3,
    shadowColor: IpodColors.lcdTitleBarBg,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    backgroundColor: IpodColors.lcdTitleBarBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverPlaceholderText: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.5)',
  },
  artist: {
    fontSize: 11,
    color: IpodColors.paused,
    fontWeight: '500',
  },
  album: {
    fontSize: 13,
    color: IpodColors.rowText,
    fontWeight: '700',
    marginTop: 2,
  },
  track: {
    fontSize: 11,
    color: IpodColors.rowText,
    marginTop: 2,
  },

  // ── Normal playback progress ────────────────────────────────────────────────
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  timeText: {
    fontSize: 10,
    color: IpodColors.rowText,
    minWidth: 32,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: IpodColors.progressTrack,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: IpodColors.progressFill,
  },

  // ── Buffering state ─────────────────────────────────────────────────────────
  bufferingArea: {
    marginTop: 6,
    gap: 4,
  },
  shimmerTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: IpodColors.progressTrack,
    overflow: 'hidden',
  },
  shimmerFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: IpodColors.paused,
    opacity: 0.7,
  },
  bufferingLabel: {
    fontSize: 10,
    color: IpodColors.paused,
    fontWeight: '600',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },

  // ── Status line ─────────────────────────────────────────────────────────────
  status: {
    fontSize: 11,
    color: IpodColors.rowText,
    marginTop: 4,
    fontWeight: '600',
  },
});
