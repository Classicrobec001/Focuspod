/**
 * SearchView — text-search screen for LibriVox books.
 *
 * Layout (top → bottom within the LCD content area):
 *   ┌──────────────────────────────┐  ← lcdRowH — search input bar
 *   │  ⌕  [query text input     ]  │
 *   ├──────────────────────────────┤
 *   │  result row 0                │
 *   │  result row 1  ← cursor      │  ← RESULT_VISIBLE rows
 *   │  result row 2                │
 *   └──────────────────────────────┘
 *
 * Wheel mapping (handled by IpodDevice):
 *   Rotate  → move cursor through results
 *   Center  → open BookDetail for highlighted result
 *   MENU    → go back; IpodDevice.handleMenu calls clearSearch() first
 *
 * The text input is auto-focused so the native keyboard opens immediately.
 * The cursor (passed from IpodDevice) navigates the results list independently
 * of keyboard state — the user can type, then rotate to pick a result.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLibraryStore } from '../../stores/libraryStore';
import { IpodColors } from '../../constants/colors';
import { IpodLayout } from '../../constants/layout';

interface Props {
  cursor: number;
}

// One row is consumed by the search input bar; the rest shows results.
const RESULT_VISIBLE = Math.max(1, IpodLayout.lcdVisibleRows - 1);

export default function SearchView({ cursor }: Props) {
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchResults = useLibraryStore(s => s.searchResults);
  const isLoading     = useLibraryStore(s => s.isLoading);
  const error         = useLibraryStore(s => s.error);
  const searchBooks   = useLibraryStore(s => s.searchBooks);
  const clearSearch   = useLibraryStore(s => s.clearSearch);

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text.trim().length === 0) {
        clearSearch();
        return;
      }
      // 500 ms debounce — avoids hammering the API on every keystroke.
      debounceRef.current = setTimeout(() => {
        searchBooks(text.trim());
      }, 500);
    },
    [searchBooks, clearSearch],
  );

  // Windowed results (same approach as AudiobooksView).
  const clampedCursor = Math.min(cursor, Math.max(0, searchResults.length - 1));
  const windowStart = searchResults.length === 0
    ? 0
    : Math.max(
        0,
        Math.min(
          clampedCursor - Math.floor(RESULT_VISIBLE / 2),
          searchResults.length - RESULT_VISIBLE,
        ),
      );
  const windowEnd = Math.min(searchResults.length, windowStart + RESULT_VISIBLE);
  const visible = searchResults.slice(windowStart, windowEnd);

  const showHint  = query.trim().length === 0 && searchResults.length === 0;
  const showEmpty = query.trim().length > 0 && !isLoading && searchResults.length === 0 && !error;

  return (
    <View style={styles.container}>
      {/* ── Search input bar ─────────────────────────────────────────────── */}
      <View style={styles.inputRow}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={handleChangeText}
          placeholder="Search audiobooks…"
          placeholderTextColor={IpodColors.rowArrow}
          autoFocus
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          underlineColorAndroid="transparent"
        />
        {isLoading && (
          <ActivityIndicator
            size="small"
            color={IpodColors.rowText}
            style={styles.spinner}
          />
        )}
      </View>

      {/* ── Results area ─────────────────────────────────────────────────── */}
      <View style={styles.results}>
        {showHint && (
          <View style={styles.centred}>
            <Text style={styles.hintText}>Type to search</Text>
          </View>
        )}

        {error && !isLoading && (
          <View style={styles.centred}>
            <Text style={styles.hintText}>Error: {error}</Text>
          </View>
        )}

        {showEmpty && (
          <View style={styles.centred}>
            <Text style={styles.hintText}>No results for "{query}"</Text>
          </View>
        )}

        {visible.map((book, offset) => {
          const idx = windowStart + offset;
          const selected = idx === clampedCursor;
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
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  inputRow: {
    height: IpodLayout.lcdRowH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    backgroundColor: IpodColors.lcdGlass,
    borderBottomWidth: 1,
    borderBottomColor: IpodColors.rowDivider,
  },
  searchIcon: {
    fontSize: 14,
    color: IpodColors.rowArrow,
    marginRight: 4,
    lineHeight: IpodLayout.lcdRowH,
  },
  input: {
    flex: 1,
    fontSize: 12,
    color: IpodColors.rowText,
    // Collapse Android's default vertical padding so the input sits flush.
    paddingVertical: 0,
    height: IpodLayout.lcdRowH,
  },
  spinner: {
    marginLeft: 4,
  },

  results: { flex: 1 },

  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  hintText: {
    fontSize: 11,
    color: IpodColors.rowArrow,
    textAlign: 'center',
    fontStyle: 'italic',
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
    fontSize: 12,
    color: IpodColors.rowText,
  },
  rowTextSelected: {
    color: IpodColors.rowSelectedText,
    fontWeight: '600',
  },
  arrow: { fontSize: 16, color: IpodColors.rowArrow, marginLeft: 4 },
  arrowSelected: { color: IpodColors.rowSelectedText },
});
