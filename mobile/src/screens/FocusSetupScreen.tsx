import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Switch,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, BlockableApp } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  getInstalledApps,
  hasAccessibilityPermission,
  hasUsageStatsPermission,
  requestAccessibilityPermission,
  requestUsageStatsPermission,
} from '../services/blockingService';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';

type Nav = NativeStackNavigationProp<RootStackParamList, 'FocusSetup'>;
type Route = RouteProp<RootStackParamList, 'FocusSetup'>;

const DURATION_OPTIONS = [15, 25, 30, 45, 60, 90, 120];

export default function FocusSetupScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const bookId = route.params?.bookId ?? null;

  const { preferences } = useSettingsStore();
  const { createSession } = useSessionStore();

  const [duration, setDuration] = useState(preferences.defaultSessionDuration);
  const [installedApps, setInstalledApps] = useState<BlockableApp[]>([]);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(
    new Set(preferences.blockedApps),
  );
  const [hasAccess, setHasAccess] = useState(false);
  const [hasUsage, setHasUsage] = useState(false);
  const [permChecked, setPermChecked] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      setPermChecked(true);
      return;
    }
    Promise.all([hasAccessibilityPermission(), hasUsageStatsPermission()]).then(
      ([acc, usage]) => {
        setHasAccess(acc);
        setHasUsage(usage);
        setPermChecked(true);
        if (acc && usage) {
          getInstalledApps().then(setInstalledApps);
        }
      },
    );
  }, []);

  const toggleApp = (pkg: string) => {
    setSelectedApps(prev => {
      const next = new Set(prev);
      if (next.has(pkg)) next.delete(pkg);
      else next.add(pkg);
      return next;
    });
  };

  const handleStart = () => {
    const session = createSession({
      duration,
      blockedApps: Array.from(selectedApps),
      bookId,
    });
    navigation.replace('ActiveSession', { sessionId: session.id });
  };

  const blockingEnabled = Platform.OS === 'android' && hasAccess && hasUsage;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Focus Session</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Duration picker */}
        <Text style={styles.sectionLabel}>Duration</Text>
        <View style={styles.durationRow}>
          {DURATION_OPTIONS.map(d => (
            <TouchableOpacity
              key={d}
              style={[styles.durationPill, duration === d && styles.durationPillActive]}
              onPress={() => setDuration(d)}
            >
              <Text
                style={[styles.durationText, duration === d && styles.durationTextActive]}
              >
                {d < 60 ? `${d}m` : `${d / 60}h`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Android blocking */}
        {Platform.OS === 'android' && (
          <>
            <Text style={styles.sectionLabel}>App Blocking</Text>

            {!permChecked ? null : !hasAccess ? (
              <View style={styles.permCard}>
                <Text style={styles.permText}>
                  Accessibility permission is required for app blocking.
                </Text>
                <TouchableOpacity
                  style={styles.permBtn}
                  onPress={requestAccessibilityPermission}
                >
                  <Text style={styles.permBtnText}>Grant Permission</Text>
                </TouchableOpacity>
              </View>
            ) : !hasUsage ? (
              <View style={styles.permCard}>
                <Text style={styles.permText}>
                  Usage access is required to detect foreground apps.
                </Text>
                <TouchableOpacity
                  style={styles.permBtn}
                  onPress={requestUsageStatsPermission}
                >
                  <Text style={styles.permBtnText}>Grant Permission</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={installedApps}
                keyExtractor={a => a.packageName}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <View style={styles.appRow}>
                    <Text style={styles.appName}>{item.appName}</Text>
                    <Switch
                      value={selectedApps.has(item.packageName)}
                      onValueChange={() => toggleApp(item.packageName)}
                      trackColor={{ true: Colors.sessionActive, false: Colors.border }}
                      thumbColor={Colors.accent}
                    />
                  </View>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No apps to block.</Text>
                }
              />
            )}
          </>
        )}

        {Platform.OS === 'ios' && (
          <View style={styles.permCard}>
            <Text style={styles.permText}>
              iOS does not allow hard app blocking. A reminder will be shown if
              you leave FocusPod during a session.
            </Text>
          </View>
        )}

        {/* Summary */}
        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            {duration} min · {selectedApps.size} app{selectedApps.size !== 1 ? 's' : ''} blocked
          </Text>
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.startBtn} onPress={handleStart}>
          <Text style={styles.startBtnText}>Start Session</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Layout.xxl },
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
    marginBottom: Layout.sm,
    paddingHorizontal: Layout.md,
  },
  durationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Layout.md,
    gap: Layout.sm,
  },
  durationPill: {
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.sm,
    borderRadius: Layout.radiusRound,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  durationPillActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  durationText: { color: Colors.textSecondary, fontSize: Layout.fontSizeMd },
  durationTextActive: { color: Colors.background, fontWeight: '600' },
  permCard: {
    marginHorizontal: Layout.md,
    padding: Layout.md,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Layout.radiusMd,
    gap: Layout.sm,
  },
  permText: { color: Colors.textSecondary, fontSize: Layout.fontSizeSm, lineHeight: 20 },
  permBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.xs + 2,
    backgroundColor: Colors.accentBlue,
    borderRadius: Layout.radiusSm,
  },
  permBtnText: { color: '#fff', fontWeight: '600', fontSize: Layout.fontSizeSm },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.md,
    paddingVertical: Layout.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  appName: { color: Colors.textPrimary, fontSize: Layout.fontSizeMd, flex: 1 },
  emptyText: { color: Colors.textMuted, fontSize: Layout.fontSizeMd, paddingHorizontal: Layout.md },
  summary: {
    alignItems: 'center',
    marginTop: Layout.xl,
    paddingHorizontal: Layout.md,
  },
  summaryText: { color: Colors.textSecondary, fontSize: Layout.fontSizeMd },
  footer: {
    paddingHorizontal: Layout.md,
    paddingBottom: Layout.lg,
    paddingTop: Layout.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  startBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Layout.radiusMd,
    paddingVertical: Layout.md,
    alignItems: 'center',
  },
  startBtnText: { color: Colors.background, fontWeight: '700', fontSize: Layout.fontSizeLg },
});
