import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  StatusBar,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Book, RootStackParamList } from '../types';
import { useLibraryStore } from '../stores/libraryStore';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Library'>;

function BookRow({ book, onPress }: { book: Book; onPress: () => void }) {
  const [imgError, setImgError] = useState(false);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {book.coverUrl && !imgError ? (
        <Image
          source={{ uri: book.coverUrl }}
          style={styles.thumb}
          onError={() => setImgError(true)}
        />
      ) : (
        <View style={styles.thumbPlaceholder}>
          <Text style={styles.thumbInitials}>
            {book.title[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      )}
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={2}>{book.title}</Text>
        <Text style={styles.rowAuthor} numberOfLines={1}>{book.author}</Text>
        <Text style={styles.rowMeta}>
          {book.chapters.length} ch · {Math.round(book.duration / 60)} min
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function LibraryScreen() {
  const navigation = useNavigation<Nav>();
  const { books, searchResults, isLoading, error, loadBooks, loadMore, searchBooks, clearSearch, searchQuery } =
    useLibraryStore();
  const [query, setQuery] = useState('');

  useEffect(() => {
    loadBooks();
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (text.length > 2) {
        searchBooks(text);
      } else if (text.length === 0) {
        clearSearch();
      }
    },
    [searchBooks, clearSearch],
  );

  const displayedBooks = searchQuery.length > 2 ? searchResults : books;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>FocusPod</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.headerAction}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search audiobooks…"
          placeholderTextColor={Colors.textMuted}
          value={query}
          onChangeText={handleSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
      </View>

      {/* Error */}
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* List */}
      <FlatList
        data={displayedBooks}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <BookRow
            book={item}
            onPress={() => navigation.navigate('BookDetail', { bookId: item.id })}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          isLoading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No books found.</Text>
            </View>
          )
        }
        ListFooterComponent={
          isLoading ? (
            <ActivityIndicator
              color={Colors.textSecondary}
              style={{ marginVertical: Layout.lg }}
            />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const THUMB = 64;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.sm,
  },
  headerTitle: {
    fontSize: Layout.fontSizeXl,
    color: Colors.textPrimary,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  headerAction: {
    fontSize: Layout.fontSizeMd,
    color: Colors.accentBlue,
  },
  searchRow: {
    paddingHorizontal: Layout.md,
    paddingBottom: Layout.sm,
  },
  searchInput: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Layout.radiusSm,
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.sm,
    color: Colors.textPrimary,
    fontSize: Layout.fontSizeMd,
  },
  errorBanner: {
    marginHorizontal: Layout.md,
    marginBottom: Layout.sm,
    padding: Layout.sm,
    backgroundColor: Colors.error + '22',
    borderRadius: Layout.radiusSm,
  },
  errorText: {
    color: Colors.error,
    fontSize: Layout.fontSizeSm,
  },
  listContent: {
    paddingBottom: Layout.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: Layout.radiusSm,
    backgroundColor: Colors.surfaceElevated,
  },
  thumbPlaceholder: {
    width: THUMB,
    height: THUMB,
    borderRadius: Layout.radiusSm,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbInitials: {
    fontSize: 24,
    color: Colors.textMuted,
    fontWeight: '200',
  },
  rowInfo: {
    flex: 1,
    marginLeft: Layout.md,
  },
  rowTitle: {
    fontSize: Layout.fontSizeMd,
    color: Colors.textPrimary,
    fontWeight: '500',
    marginBottom: 2,
  },
  rowAuthor: {
    fontSize: Layout.fontSizeSm,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  rowMeta: {
    fontSize: Layout.fontSizeXs,
    color: Colors.textMuted,
  },
  empty: {
    alignItems: 'center',
    marginTop: Layout.xxl,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: Layout.fontSizeMd,
  },
});
