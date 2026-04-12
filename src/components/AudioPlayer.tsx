/**
 * Compact audio player bar shown above the wheel on the NowPlaying screen.
 * Displays progress, chapter info, and handles are driven by the playback store.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import {
  useProgress,
  useActiveTrack,
  usePlaybackState,
  State,
} from 'react-native-track-player';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { usePlaybackStore } from '../stores/playbackStore';

function pad(n: number) {
  return Math.floor(n).toString().padStart(2, '0');
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${pad(m)}:${pad(sec)}`;
}

interface AudioPlayerProps {
  onSeek?: (position: number) => void;
}

export default function AudioPlayer({ onSeek }: AudioPlayerProps) {
  const { position, duration } = useProgress(500);
  const track = useActiveTrack();
  const { state: rnState } = usePlaybackState();
  const storeStatus = usePlaybackStore(s => s.status);
  const progress = duration > 0 ? position / duration : 0;

  const isBuffering =
    rnState === State.Buffering ||
    rnState === State.Loading ||
    storeStatus === 'loading';

  return (
    <View style={styles.container}>
      <Text style={styles.title} numberOfLines={1}>
        {track?.title ?? '—'}
      </Text>
      <Text style={styles.artist} numberOfLines={1}>
        {track?.artist ?? ''}
      </Text>

      {/* Buffering banner — visible while CDN is being fetched */}
      {isBuffering && (
        <View style={styles.bufferingRow}>
          <ActivityIndicator size="small" color={Colors.accentBlue} />
          <Text style={styles.bufferingText}>Buffering…</Text>
        </View>
      )}

      {/* Progress bar — tappable for seek */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={evt => {
          if (!onSeek || duration <= 0) return;
          const { locationX } = evt.nativeEvent;
          const barWidth = Layout.screenWidth - Layout.xl * 2;
          const ratio = Math.max(0, Math.min(1, locationX / barWidth));
          onSeek(ratio * duration);
        }}
      >
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          <View style={[styles.progressThumb, { left: `${progress * 100}%` }]} />
        </View>
      </TouchableOpacity>

      <View style={styles.times}>
        <Text style={styles.time}>{fmt(position)}</Text>
        <Text style={styles.statusDot}>
          {isBuffering ? '⏳' : rnState === State.Playing ? '▶' : '⏸'}
        </Text>
        <Text style={styles.time}>-{fmt(Math.max(0, duration - position))}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Layout.xl,
    paddingVertical: Layout.md,
  },
  title: {
    fontSize: Layout.fontSizeLg,
    color: Colors.textPrimary,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 2,
  },
  artist: {
    fontSize: Layout.fontSizeSm,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Layout.md,
  },
  bufferingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: Layout.sm,
  },
  bufferingText: {
    fontSize: Layout.fontSizeXs,
    color: Colors.accentBlue,
    letterSpacing: 0.5,
  },
  progressTrack: {
    height: 3,
    backgroundColor: Colors.progressTrack,
    borderRadius: 2,
    position: 'relative',
    overflow: 'visible',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.progressFill,
    borderRadius: 2,
  },
  progressThumb: {
    position: 'absolute',
    top: -4,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: Colors.accent,
    marginLeft: -5,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Layout.sm,
  },
  time: {
    fontSize: Layout.fontSizeXs,
    color: Colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  statusDot: {
    fontSize: Layout.fontSizeXs,
    color: Colors.textSecondary,
  },
});
