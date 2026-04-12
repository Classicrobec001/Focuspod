import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../stores/settingsStore';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';

function SettingRow({
  label,
  subtitle,
  right,
}: {
  label: string;
  subtitle?: string;
  right: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const DURATION_OPTIONS = [15, 25, 30, 45, 60, 90, 120];

export default function SettingsScreen() {
  const navigation = useNavigation();
  const { preferences, setHaptics, setDefaultDuration } = useSettingsStore();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView>
        {/* Playback */}
        <Text style={styles.sectionLabel}>Playback</Text>
        <SettingRow
          label="Haptic Feedback"
          subtitle="Vibrate on wheel interactions"
          right={
            <Switch
              value={preferences.haptics}
              onValueChange={setHaptics}
              trackColor={{ true: Colors.sessionActive, false: Colors.border }}
              thumbColor={Colors.accent}
            />
          }
        />

        {/* Focus */}
        <Text style={styles.sectionLabel}>Focus Sessions</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Default Duration</Text>
        </View>
        <View style={styles.durationRow}>
          {DURATION_OPTIONS.map(d => (
            <TouchableOpacity
              key={d}
              style={[
                styles.durationPill,
                preferences.defaultSessionDuration === d && styles.durationPillActive,
              ]}
              onPress={() => setDefaultDuration(d)}
            >
              <Text
                style={[
                  styles.durationText,
                  preferences.defaultSessionDuration === d && styles.durationTextActive,
                ]}
              >
                {d < 60 ? `${d}m` : `${d / 60}h`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* About */}
        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Content</Text>
          <Text style={styles.rowValue}>Librivox public domain</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.rowValue}>0.1.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.sm,
  },
  back: { color: Colors.accentBlue, fontSize: Layout.fontSizeMd },
  title: {
    color: Colors.textPrimary,
    fontSize: Layout.fontSizeLg,
    fontWeight: '600',
  },
  sectionLabel: {
    color: Colors.textMuted,
    fontSize: Layout.fontSizeXs,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: Layout.lg,
    marginBottom: 4,
    paddingHorizontal: Layout.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowLeft: { flex: 1 },
  rowLabel: { color: Colors.textPrimary, fontSize: Layout.fontSizeMd },
  rowSubtitle: { color: Colors.textMuted, fontSize: Layout.fontSizeXs, marginTop: 2 },
  rowValue: { color: Colors.textSecondary, fontSize: Layout.fontSizeMd },
  durationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.sm,
    gap: Layout.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  durationPill: {
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.xs + 2,
    borderRadius: Layout.radiusRound,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  durationPillActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  durationText: { color: Colors.textSecondary, fontSize: Layout.fontSizeSm },
  durationTextActive: { color: Colors.background, fontWeight: '600' },
});
