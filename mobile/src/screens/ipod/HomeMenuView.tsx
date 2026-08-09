/**
 * HomeMenuView — top-level iPod menu.
 *
 * Items (index → screen pushed by IpodDevice.handleSelect):
 *   0  Audiobooks
 *   1  Downloads
 *   2  Search
 *   3  Now Playing
 *   4  Focus
 *   5  Settings
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IpodColors } from '../../constants/colors';
import { IpodLayout } from '../../constants/layout';

interface Props {
  cursor: number;
}

const ITEMS = [
  { label: 'Audiobooks',  arrow: true },
  { label: 'Downloads',   arrow: true },
  { label: 'Search',      arrow: true },
  { label: 'Now Playing', arrow: true },
  { label: 'Focus',       arrow: true },
  { label: 'Settings',    arrow: true },
];

export default function HomeMenuView({ cursor }: Props) {
  return (
    <View style={styles.container}>
      {ITEMS.map((item, i) => {
        const selected = i === cursor;
        return (
          <View key={item.label} style={[styles.row, selected && styles.rowSelected]}>
            <Text
              style={[styles.rowText, selected && styles.rowTextSelected]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
            {item.arrow && (
              <Text style={[styles.arrow, selected && styles.arrowSelected]}>›</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  rowSelected: {
    backgroundColor: IpodColors.rowSelectedBg,
  },
  rowText: {
    flex: 1,
    fontSize: 13,
    color: IpodColors.rowText,
    fontWeight: '500',
  },
  rowTextSelected: {
    color: IpodColors.rowSelectedText,
    fontWeight: '600',
  },
  arrow: {
    fontSize: 16,
    color: IpodColors.rowArrow,
    marginLeft: 4,
  },
  arrowSelected: {
    color: IpodColors.rowSelectedText,
  },
});
