import React, { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RootStackParamList } from '../types';
import { useLibraryStore } from '../stores/libraryStore';
import { usePlaybackStore } from '../stores/playbackStore';
import BookCover from '../components/BookCover';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';

type Nav = NativeStackNavigationProp<RootStackParamList, 'BookDetail'>;
type Route = RouteProp<RootStackParamList, 'BookDetail'>;

export default function BookDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { bookId } = route.params;

  const { selectedBook, isLoading, selectBook } = useLibraryStore();
  const { loadBook, play, currentBook } = usePlaybackStore();

  useEffect(() => {
    selectBook(bookId);
  }, [bookId]);

  if (isLoading || !selectedBook) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={Colors.textSecondary} />
      </SafeAreaView>
    );
  }

  const book = selectedBook;

  const handlePlayChapter = async (index: number) => {
    await loadBook(book, index);
    await play();
    navigation.navigate('NowPlaying');
  };

  const handleStartFocus = () => {
    navigation.navigate('FocusSetup', { bookId: book.id });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Back */}
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Library</Text>
        </TouchableOpacity>

        {/* Cover + title */}
        <View style={styles.hero}>
          <BookCover uri={book.coverUrl} title={book.title} size={160} />
          <Text style={styles.title}>{book.title}</Text>
          <Text style={styles.author}>{book.author}</Text>
          {book.categories.length > 0 && (
            <Text style={styles.categories}>{book.categories.join(' · ')}</Text>
          )}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => handlePlayChapter(0)}
          >
            <Text style={styles.btnPrimaryText}>▶  Play</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={handleStartFocus}
          >
            <Text style={styles.btnSecondaryText}>Focus Session</Text>
          </TouchableOpacity>
        </View>

        {/* Description */}
        {book.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.description}>{book.description}</Text>
          </View>
        ) : null}

        {/* Chapters */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Chapters ({book.chapters.length})
          </Text>
          {book.chapters.map((ch, i) => (
            <TouchableOpacity
              key={ch.id}
              style={styles.chapterRow}
              onPress={() => handlePlayChapter(i)}
            >
              <Text style={styles.chapterNum}>{i + 1}</Text>
              <Text style={styles.chapterTitle} numberOfLines={1}>{ch.title}</Text>
              <Text style={styles.chapterDuration}>
                {Math.round(ch.duration / 60)}m
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingBottom: Layout.xxl,
  },
  back: {
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.sm,
  },
  backText: {
    color: Colors.accentBlue,
    fontSize: Layout.fontSizeMd,
  },
  hero: {
    alignItems: 'center',
    paddingHorizontal: Layout.md,
    paddingBottom: Layout.lg,
  },
  title: {
    fontSize: Layout.fontSizeXl,
    color: Colors.textPrimary,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: Layout.md,
    marginBottom: 4,
  },
  author: {
    fontSize: Layout.fontSizeMd,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  categories: {
    fontSize: Layout.fontSizeXs,
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: Layout.md,
    gap: Layout.sm,
    marginBottom: Layout.lg,
  },
  btn: {
    flex: 1,
    paddingVertical: Layout.sm + 2,
    borderRadius: Layout.radiusMd,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: Colors.accent,
  },
  btnPrimaryText: {
    color: Colors.background,
    fontWeight: '600',
    fontSize: Layout.fontSizeMd,
  },
  btnSecondary: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnSecondaryText: {
    color: Colors.textPrimary,
    fontWeight: '500',
    fontSize: Layout.fontSizeMd,
  },
  section: {
    paddingHorizontal: Layout.md,
    marginBottom: Layout.lg,
  },
  sectionTitle: {
    fontSize: Layout.fontSizeSm,
    color: Colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Layout.sm,
  },
  description: {
    fontSize: Layout.fontSizeMd,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Layout.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  chapterNum: {
    width: 28,
    fontSize: Layout.fontSizeXs,
    color: Colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  chapterTitle: {
    flex: 1,
    fontSize: Layout.fontSizeMd,
    color: Colors.textPrimary,
  },
  chapterDuration: {
    fontSize: Layout.fontSizeXs,
    color: Colors.textMuted,
    marginLeft: Layout.sm,
  },
});
