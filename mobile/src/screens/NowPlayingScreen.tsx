/**
 * NowPlayingScreen — the core iPod experience.
 *
 * Layout (top to bottom):
 *   1. Screen title + back
 *   2. Book cover art
 *   3. AudioPlayer (title, artist, progress bar, timestamps)
 *   4. IpodWheel
 *      - Center → play/pause
 *      - Top    → back to Library (menu)
 *      - Right  → skip next chapter (▶▶)
 *      - Left   → skip previous chapter (◀◀)
 *      - Rotate → seek within track
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePlaybackState, State } from 'react-native-track-player';
import { usePlaybackStore } from '../stores/playbackStore';
import BookCover from '../components/BookCover';
import AudioPlayer from '../components/AudioPlayer';
import IpodWheel from '../components/IpodWheel';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SEEK_STEP_DEG = 3; // degrees of rotation per 5-second seek step

export default function NowPlayingScreen() {
  const navigation = useNavigation<Nav>();
  const { state: playerState } = usePlaybackState();
  const { currentBook, currentChapterIndex, play, pause, stop, seekTo, seekForward, skipToNext, skipToPrevious } =
    usePlaybackStore();

  const isPlaying = playerState === State.Playing;

  const handleSelect = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  const handleMenu = () => {
    navigation.goBack();
  };

  const handleSeekForward = () => {
    seekForward(30);
  };

  const handleRotate = (delta: number) => {
    // Each SEEK_STEP_DEG of rotation = ±5 seconds — uses store position for
    // rotation (continuous gesture, not a one-shot button press) which is
    // acceptable since rotation keeps updating the store position each step.
    const steps = delta / SEEK_STEP_DEG;
    const seekDelta = steps * 5;
    const currentPos = usePlaybackStore.getState().position;
    const dur = usePlaybackStore.getState().duration;
    const next = Math.max(0, Math.min(dur, currentPos + seekDelta));
    seekTo(next);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleMenu}>
          <Text style={styles.headerBack}>← Library</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Now Playing</Text>
        <TouchableOpacity onPress={() => navigation.navigate('FocusSetup', {})}>
          <Text style={styles.headerAction}>Focus</Text>
        </TouchableOpacity>
      </View>

      {/* Cover art */}
      <View style={styles.coverContainer}>
        <BookCover
          uri={currentBook?.coverUrl}
          title={currentBook?.title}
          size={180}
        />
      </View>

      {/* Player info + progress */}
      <AudioPlayer onSeek={seekTo} />

      {/* iPod wheel */}
      <View style={styles.wheelContainer}>
        <IpodWheel
          onSelect={handleSelect}
          onMenu={handleMenu}
          onNext={skipToNext}
          onPrevious={skipToPrevious}
          onPlayPause={handleSeekForward}
          onRotate={handleRotate}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.sm,
  },
  headerBack: {
    color: Colors.accentBlue,
    fontSize: Layout.fontSizeMd,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: Layout.fontSizeMd,
    fontWeight: '600',
  },
  headerAction: {
    color: Colors.accentBlue,
    fontSize: Layout.fontSizeMd,
  },
  coverContainer: {
    marginTop: Layout.sm,
    marginBottom: Layout.sm,
  },
  wheelContainer: {
    marginTop: 'auto',
    paddingBottom: Layout.lg,
  },
});
