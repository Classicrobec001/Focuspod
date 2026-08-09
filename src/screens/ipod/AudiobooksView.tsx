/**
 * AudiobooksView — scrollable list of LibriVox books.
 *
 * Shows a windowed subset of the library centred on the cursor row.
 * Books are loaded on first render; a single "Loading…" row is shown until
 * data arrives.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLibraryStore } from '../../stores/libraryStore';
import { useDownloadStore } from '../../stores/downloadStore';
import { IpodColors } from '../../constants/colors';
import { IpodLayout } from '../../constants/layout';

interface Props {
  cursor: number;
}

const VISIBLE = IpodLayout.lcdVisibleRows;

export default function AudiobooksView({ cursor }: Props) {
  const books          = useLibraryStore(s => s.books);
  const isLoading      = useLibraryStore(s => s.isLoading);
  const error          = useLibraryStore(s => s.error);
  const hasMore        = useLibraryStore(s => s.hasMore);
  const loadBooks      = useLibraryStore(s => s.loadBooks);
  const loadMore       = useLibraryStore(s => s.loadMore);
  const downloadBooks  = useDownloadStore(s => s.books);

  useEffect(() => {
    if (books.length === 0 && !isLoading && !error) {
      loadBooks();
    }
  }, [books.length, isLoading, error, loadBooks]);

  if (isLoading && books.length === 0) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={IpodColors.rowText} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Error: {error}</Text>
      </View>
    );
  }

  if (books.length === 0) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>No books found.</Text>
      </View>
    );
  }

  // Total virtual rows = books + optional Load More row
  const totalRows = books.length + (hasMore ? 1 : 0);

  // Compute window so cursor row stays visible
  const windowStart = Math.max(0, Math.min(cursor - Math.floor(VISIBLE / 2), totalRows - VISIBLE));
  const windowEnd = Math.min(totalRows, windowStart + VISIBLE);

  return (
    <View style={styles.container}>
      {Array.from({ length: windowEnd - windowStart }, (_, i) => {
        const idx = windowStart + i;
        const selected = idx === cursor;

        // Load More row
        if (idx === books.length) {
          return (
            <View key="load-more" style={[styles.row, selected && styles.rowSelected]}>
              {isLoading ? (
                <Text style={[styles.rowText, selected && styles.rowTextSelected]}>
                  Loading…
                </Text>
              ) : (
                <>
                  <Text style={[styles.rowText, selected && styles.rowTextSelected]}>
                    Load More
                  </Text>
                  <Text style={[styles.arrow, selected && styles.arrowSelected]}>↓</Text>
                </>
              )}
            </View>
          );
        }

        const book = books[idx];
        const dlStatus = downloadBooks[book.id]?.status;
        const isDownloaded   = dlStatus === 'done';
        const isDownloading  = dlStatus === 'downloading';
        return (
          <View key={book.id} style={[styles.row, selected && styles.rowSelected]}>
            <Text
              style={[styles.rowText, selected && styles.rowTextSelected]}
              numberOfLines={1}
            >
              {book.title}
            </Text>
            {/* Download indicator: ↓ while downloading, ✓ when done */}
            {(isDownloaded || isDownloading) && (
              <Text style={[styles.dlBadge, selected && styles.dlBadgeSelected]}>
                {isDownloaded ? '✓' : '↓'}
              </Text>
            )}
            <Text style={[styles.arrow, selected && styles.arrowSelected]}>›</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: IpodColors.rowText,
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
  dlBadge: { fontSize: 11, color: IpodColors.paused, marginRight: 2 },
  dlBadgeSelected: { color: 'rgba(255,255,255,0.8)' },
});
