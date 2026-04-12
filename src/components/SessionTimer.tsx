import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';

interface SessionTimerProps {
  remainingSeconds: number;
  totalSeconds: number;
  status: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export default function SessionTimer({
  remainingSeconds,
  totalSeconds,
  status,
}: SessionTimerProps) {
  const progress = totalSeconds > 0 ? 1 - remainingSeconds / totalSeconds : 0;
  const timerColor =
    status === 'active'
      ? Colors.sessionActive
      : status === 'paused'
      ? Colors.sessionPaused
      : Colors.textSecondary;

  return (
    <View style={styles.container}>
      <Text style={[styles.time, { color: timerColor }]}>
        {formatTime(remainingSeconds)}
      </Text>
      <Text style={styles.label}>remaining</Text>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <Text style={styles.status}>{status.replace('_', ' ').toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: Layout.md,
  },
  time: {
    fontSize: Layout.fontSizeDisplay,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  label: {
    fontSize: Layout.fontSizeXs,
    color: Colors.textMuted,
    marginTop: 2,
    letterSpacing: 1,
  },
  progressTrack: {
    width: 200,
    height: 2,
    backgroundColor: Colors.progressTrack,
    borderRadius: 1,
    marginTop: Layout.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.progressFill,
    borderRadius: 1,
  },
  status: {
    fontSize: Layout.fontSizeXs,
    color: Colors.textMuted,
    marginTop: Layout.sm,
    letterSpacing: 2,
  },
});
