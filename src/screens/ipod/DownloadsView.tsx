/**
 * DownloadsView — shows books that have been downloaded (or are downloading).
 *
 * Cursor rows map 1:1 to entries in downloadStore.books where status is
 * 'done' or 'downloading'. Selecting a row calls lib.selectBook() (which
 * fetches the book if it's not already in the in-memory list) and pushes
 * 'book-detail'.
 *
 * Title / author come from the bookTitle/bookAuthor fields persisted in
 * downloadStore so this screen works even without a network connection.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useDownloadStore } from '../../stores/downloadStore';
import { IpodColors } from '../../constants/colors';
import { IpodLayout } from '../../constants/layout';

interface Props {
  cursor: number;
}

export default function DownloadsView({ cursor }: Props) {
  const books = useDownloadStore(s => s.books);

  // Only show books that are downloaded or actively downloading.
  const entries = Object.entries(books).filter(
    ([, state]) => state.status === 'done' || state.status === 'downloading',
  );

  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No downloads yet.</Text>
        <Text style={styles.emptyHint}>Browse Audiobooks to download.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {entries.map(([bookId, state], i) => {
        const selected = i === cursor;
        const isDone = state.status === 'done';
        const pct = isDone ? 100 : Math.round(state.progress * 100);

        return (
          <View key={bookId} style={[styles.row, selected && styles.rowSelected]}>
            <View style={styles.rowInner}>
              <Text
                style={[styles.rowText, selected && styles.rowTextSelected]}
                numberOfLines={1}
              >
                {state.bookTitle ?? bookId}
              </Text>
              {state.bookAuthor ? (
                <Text
                  style={[styles.rowSub, selected && styles.rowSubSelected]}
                  numberOfLines={1}
                >
                  {state.bookAuthor}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.badge, selected && styles.badgeSelected]}>
              {isDone ? '✓' : `${pct}%`}
            </Text>
            <Text style={[styles.arrow, selected && styles.arrowSelected]}>›</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 4,
  },
  emptyText: { fontSize: 12, color: IpodColors.rowText, fontWeight: '600' },
  emptyHint: { fontSize: 10, color: IpodColors.rowArrow, textAlign: 'center' },

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
  rowInner: { flex: 1, justifyContent: 'center' },
  rowText: { fontSize: 12, color: IpodColors.rowText, fontWeight: '500' },
  rowTextSelected: { color: IpodColors.rowSelectedText, fontWeight: '600' },
  rowSub: { fontSize: 9, color: IpodColors.rowArrow, marginTop: 1 },
  rowSubSelected: { color: 'rgba(255,255,255,0.7)' },
  badge: { fontSize: 10, color: IpodColors.paused, marginRight: 2 },
  badgeSelected: { color: 'rgba(255,255,255,0.8)' },
  arrow: { fontSize: 16, color: IpodColors.rowArrow, marginLeft: 2 },
  arrowSelected: { color: IpodColors.rowSelectedText },
});
