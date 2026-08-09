/**
 * BookDetailView — shows selected book info + three action rows.
 *
 * Cursor rows (index → IpodDevice.handleSelect action):
 *   0  Play          — loads book, starts playback, pushes 'now-playing'
 *   1  Focus Session — pushes 'focus' with bookId param
 *   2  Download      — starts/cancels download; shows progress or ✓ when done
 *
 * The info area (non-cursor) shows: title, author, description, and up to
 * the first several chapter titles so the user can preview the contents.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLibraryStore } from '../../stores/libraryStore';
import { useDownloadStore } from '../../stores/downloadStore';
import { IpodColors } from '../../constants/colors';
import { IpodLayout } from '../../constants/layout';

interface Props {
  cursor: number;
}

const MAX_VISIBLE_CHAPTERS = 4;

export default function BookDetailView({ cursor }: Props) {
  const book = useLibraryStore(s => s.selectedBook);
  const dlState = useDownloadStore(s => book ? s.getState(book.id) : null);

  if (!book) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No book selected.</Text>
      </View>
    );
  }

  // ── Build download row label ──────────────────────────────────────────────

  let downloadLabel = '↓  Download';
  if (dlState) {
    switch (dlState.status) {
      case 'downloading': {
        const pct = Math.round(dlState.progress * 100);
        const done = Object.keys(dlState.chapterPaths).length;
        downloadLabel = `↓  ${pct}%  (${done}/${book.chapters.length} ch)`;
        break;
      }
      case 'done':
        downloadLabel = '✓  Downloaded';
        break;
      case 'error':
        downloadLabel = '⚠  Retry Download';
        break;
    }
  }

  const actions = [
    { label: '▶  Play',         arrow: true  },
    { label: 'Focus Session',   arrow: true  },
    { label: downloadLabel,     arrow: false },
  ];

  const visibleChapters = book.chapters.slice(0, MAX_VISIBLE_CHAPTERS);
  const moreCount = book.chapters.length - visibleChapters.length;

  return (
    <View style={styles.container}>
      {/* Scrollable info header */}
      <View style={styles.infoArea}>
        <Text style={styles.title} numberOfLines={2}>{book.title}</Text>
        <Text style={styles.author} numberOfLines={1}>{book.author}</Text>
        <Text style={styles.meta}>
          {book.chapters.length} ch · {formatDuration(book.duration)}
        </Text>

        {book.description ? (
          <Text style={styles.description} numberOfLines={3}>
            {book.description}
          </Text>
        ) : null}

        {visibleChapters.length > 0 && (
          <View style={styles.chapterList}>
            {visibleChapters.map((ch, i) => (
              <Text key={ch.id} style={styles.chapterRow} numberOfLines={1}>
                {i + 1}. {ch.title}
              </Text>
            ))}
            {moreCount > 0 && (
              <Text style={styles.chapterMore}>+{moreCount} more chapters</Text>
            )}
          </View>
        )}

        {/* Download progress bar — only shown while actively downloading */}
        {dlState?.status === 'downloading' && (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(dlState.progress * 100)}%` },
              ]}
            />
          </View>
        )}
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Action rows */}
      {actions.map((action, i) => {
        const selected = i === cursor;
        const isDone   = i === 2 && dlState?.status === 'done';
        return (
          <View key={action.label} style={[styles.row, selected && styles.rowSelected]}>
            <Text
              style={[
                styles.rowText,
                selected && styles.rowTextSelected,
                isDone && !selected && styles.rowTextDone,
              ]}
              numberOfLines={1}
            >
              {action.label}
            </Text>
            {action.arrow && (
              <Text style={[styles.arrow, selected && styles.arrowSelected]}>›</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 12, color: IpodColors.rowText },

  infoArea: {
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingTop: 5,
    paddingBottom: 4,
    backgroundColor: IpodColors.lcdGlass,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: IpodColors.rowText,
    lineHeight: 15,
  },
  author: { fontSize: 10, color: IpodColors.paused, marginTop: 1 },
  meta:   { fontSize: 9,  color: IpodColors.rowArrow, marginTop: 1 },
  description: {
    fontSize: 9,
    color: IpodColors.rowArrow,
    lineHeight: 13,
    marginTop: 4,
    fontStyle: 'italic',
  },
  chapterList: {
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: IpodColors.rowDivider,
    paddingTop: 3,
  },
  chapterRow: { fontSize: 9, color: IpodColors.rowText, lineHeight: 13 },
  chapterMore: { fontSize: 9, color: IpodColors.rowArrow, fontStyle: 'italic' },

  // Download progress bar inside info area
  progressTrack: {
    marginTop: 4,
    height: 3,
    borderRadius: 2,
    backgroundColor: IpodColors.progressTrack,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: IpodColors.progressFill,
    borderRadius: 2,
  },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: IpodColors.rowDivider },

  row: {
    height: IpodLayout.lcdRowH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: IpodColors.rowDivider,
    backgroundColor: IpodColors.rowBg,
  },
  rowSelected:    { backgroundColor: IpodColors.rowSelectedBg },
  rowText:        { flex: 1, fontSize: 13, color: IpodColors.rowText, fontWeight: '500' },
  rowTextSelected:{ color: IpodColors.rowSelectedText, fontWeight: '600' },
  rowTextDone:    { color: IpodColors.paused },
  arrow:          { fontSize: 16, color: IpodColors.rowArrow, marginLeft: 4 },
  arrowSelected:  { color: IpodColors.rowSelectedText },
});
