/**
 * ActiveSessionScreen — the locked focus session UI.
 *
 * Navigation is restricted here. The user can:
 *   - See the countdown timer
 *   - See what's playing (book cover + title)
 *   - Play / pause audio via the iPod wheel center button
 *   - End the session via explicit confirmation
 *
 * The wheel top-button (MENU) is reassigned to an "End Session?" prompt
 * instead of navigation, preventing accidental exits.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePlaybackState, State } from 'react-native-track-player';
import { RootStackParamList } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import { usePlaybackStore } from '../stores/playbackStore';
import { useLibraryStore } from '../stores/libraryStore';
import BookCover from '../components/BookCover';
import SessionTimer from '../components/SessionTimer';
import IpodWheel from '../components/IpodWheel';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ActiveSession'>;
type Route = RouteProp<RootStackParamList, 'ActiveSession'>;

export default function ActiveSessionScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { sessionId } = route.params;

  const { currentSession, remainingSeconds, startSession, pauseSession, resumeSession, endSession } =
    useSessionStore();
  const { play, pause, currentBook, loadBook } = usePlaybackStore();
  const { selectBook } = useLibraryStore();
  const { state: playerState } = usePlaybackState();
  const isPlaying = playerState === State.Playing;

  const totalSeconds = (currentSession?.duration ?? 0) * 60;

  // Start session on mount
  useEffect(() => {
    startSession(sessionId);
  }, [sessionId]);

  // Block Android back button during session
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmEnd();
      return true; // prevent default back
    });
    return () => sub.remove();
  }, []);

  // Load book if session has one and no book is currently loaded
  useEffect(() => {
    const bId = currentSession?.bookId;
    if (bId && !currentBook) {
      selectBook(bId).then(() => {
        const book = useLibraryStore.getState().selectedBook;
        if (book) loadBook(book);
      });
    }
  }, [currentSession?.bookId]);

  // Navigate away when session ends naturally
  useEffect(() => {
    if (
      currentSession?.status === 'completed' ||
      currentSession?.status === 'cancelled'
    ) {
      navigation.replace('Library');
    }
  }, [currentSession?.status]);

  const confirmEnd = () => {
    Alert.alert(
      'End Session?',
      'Your focus session will be marked as interrupted.',
      [
        { text: 'Keep Going', style: 'cancel' },
        {
          text: 'End Session',
          style: 'destructive',
          onPress: async () => {
            await endSession('interrupted');
            navigation.replace('Library');
          },
        },
      ],
    );
  };

  const handleSelect = () => {
    if (isPlaying) {
      pause();
      pauseSession();
    } else {
      play();
      resumeSession();
    }
  };

  if (!currentSession) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Status bar — subtle "locked" indicator */}
      <View style={styles.topBar}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor:
                currentSession.status === 'active'
                  ? Colors.sessionActive
                  : Colors.sessionPaused,
            },
          ]}
        />
        <Text style={styles.statusLabel}>Focus Session</Text>
        <TouchableOpacity onPress={confirmEnd}>
          <Text style={styles.endBtn}>End</Text>
        </TouchableOpacity>
      </View>

      {/* Book cover */}
      <View style={styles.coverRow}>
        <BookCover
          uri={currentBook?.coverUrl}
          title={currentBook?.title ?? 'FocusPod'}
          size={140}
        />
        {currentBook && (
          <View style={styles.bookInfo}>
            <Text style={styles.bookTitle} numberOfLines={2}>
              {currentBook.title}
            </Text>
            <Text style={styles.bookAuthor}>{currentBook.author}</Text>
          </View>
        )}
      </View>

      {/* Timer */}
      <SessionTimer
        remainingSeconds={remainingSeconds}
        totalSeconds={totalSeconds}
        status={currentSession.status}
      />

      {/* Wheel — locked to session controls only */}
      <View style={styles.wheelContainer}>
        <IpodWheel
          onSelect={handleSelect}
          onMenu={confirmEnd}
          onNext={undefined}
          onPrevious={undefined}
          onForward={undefined}
        />
        <Text style={styles.hint}>
          {isPlaying ? 'Press center to pause' : 'Press center to resume'}
        </Text>
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
  topBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.sm,
    gap: Layout.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: Layout.fontSizeSm,
    letterSpacing: 0.5,
  },
  endBtn: {
    color: Colors.error,
    fontSize: Layout.fontSizeMd,
    fontWeight: '500',
  },
  coverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.md,
    paddingTop: Layout.md,
    gap: Layout.md,
    alignSelf: 'flex-start',
  },
  bookInfo: {
    flex: 1,
  },
  bookTitle: {
    color: Colors.textPrimary,
    fontSize: Layout.fontSizeMd,
    fontWeight: '500',
    marginBottom: 4,
  },
  bookAuthor: {
    color: Colors.textSecondary,
    fontSize: Layout.fontSizeSm,
  },
  wheelContainer: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingBottom: Layout.lg,
  },
  hint: {
    color: Colors.textMuted,
    fontSize: Layout.fontSizeXs,
    marginTop: Layout.sm,
    letterSpacing: 0.5,
  },
});
