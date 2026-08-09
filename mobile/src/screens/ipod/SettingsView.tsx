/**
 * SettingsView — settings list rendered inside the LCD.
 *
 * Cursor rows (IpodDevice.handleSelect action):
 *   0  Haptics           — toggle on / off
 *   1  Default Duration  — cycle through 15 / 30 / 45 / 60 min
 *   2  Blocked Apps      — display count of saved blocked apps
 *   3  Usage Access      — open Android Usage Access settings if not granted
 *   4  Accessibility     — open Android Accessibility settings if not granted
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, AppState, AppStateStatus } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  hasUsageStatsPermission,
  hasAccessibilityPermission,
} from '../../services/blockingService';
import { IpodColors } from '../../constants/colors';
import { IpodLayout } from '../../constants/layout';

interface Props {
  cursor: number;
}

export default function SettingsView({ cursor }: Props) {
  const preferences = useSettingsStore(s => s.preferences);

  const [usageGranted, setUsageGranted] = useState<boolean | null>(null);
  const [accessGranted, setAccessGranted] = useState<boolean | null>(null);

  const recheckPermissions = useCallback(() => {
    if (Platform.OS !== 'android') return;
    hasUsageStatsPermission().then(setUsageGranted);
    hasAccessibilityPermission().then(setAccessGranted);
  }, []);

  // Check on mount and whenever the app comes back to the foreground (the user
  // may have just returned from the system Settings page after granting access).
  useEffect(() => {
    recheckPermissions();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') recheckPermissions();
    });
    return () => sub.remove();
  }, [recheckPermissions]);

  function permLabel(granted: boolean | null): string {
    if (granted === null) return '…';
    return granted ? 'Granted' : 'Not Granted';
  }

  const rows = [
    {
      label: 'Haptics',
      value: preferences.haptics ? 'On' : 'Off',
    },
    {
      label: 'Default Duration',
      value: `${preferences.defaultSessionDuration} min`,
    },
    {
      label: 'Playback Speed',
      value: `${preferences.playbackRate ?? 1}×`,
    },
    {
      label: 'Blocked Apps',
      value: `${preferences.blockedApps.length} saved`,
    },
    ...(Platform.OS === 'android'
      ? [
          {
            label: 'Usage Access',
            value: permLabel(usageGranted),
            isGranted: usageGranted,
          },
          {
            label: 'Accessibility',
            value: permLabel(accessGranted),
            isGranted: accessGranted,
          },
        ]
      : []),
  ];

  return (
    <View style={styles.container}>
      {rows.map((row, i) => {
        const selected = i === cursor;
        const denied = 'isGranted' in row && row.isGranted === false;
        return (
          <View key={row.label} style={[styles.row, selected && styles.rowSelected]}>
            <Text
              style={[styles.label, selected && styles.labelSelected]}
              numberOfLines={1}
            >
              {row.label}
            </Text>
            <Text
              style={[
                styles.value,
                selected && styles.valueSelected,
                denied && !selected && styles.valueDenied,
              ]}
            >
              {row.value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  label: {
    flex: 1,
    fontSize: 13,
    color: IpodColors.rowText,
    fontWeight: '500',
  },
  labelSelected: { color: IpodColors.rowSelectedText, fontWeight: '600' },
  value: {
    fontSize: 12,
    color: IpodColors.rowArrow,
  },
  valueSelected: { color: 'rgba(255,255,255,0.8)' },
  valueDenied: { color: IpodColors.sessionWarning }, // orange warning colour
});
