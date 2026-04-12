/**
 * App Blocking Service — Android only.
 *
 * Full enforcement requires two Android permissions:
 *   - BIND_ACCESSIBILITY_SERVICE  (foreground app detection)
 *   - PACKAGE_USAGE_STATS         (UsageStatsManager)
 *
 * The native module (FocusPodBlockingModule) is defined in
 * android/app/src/main/java/com/focuspod/blocking/
 *
 * On iOS, only a soft reminder is shown (OS restrictions prevent hard blocking).
 */

import { NativeModules, Platform } from 'react-native';
import { BlockableApp } from '../types';

const { FocusPodBlocking } = NativeModules;

const isAndroid = Platform.OS === 'android';

// ─── Permission Checks ────────────────────────────────────────────────────

export async function hasAccessibilityPermission(): Promise<boolean> {
  if (!isAndroid || !FocusPodBlocking) return false;
  return FocusPodBlocking.hasAccessibilityPermission();
}

export async function hasUsageStatsPermission(): Promise<boolean> {
  if (!isAndroid || !FocusPodBlocking) return false;
  return FocusPodBlocking.hasUsageStatsPermission();
}

export async function requestAccessibilityPermission(): Promise<void> {
  if (!isAndroid || !FocusPodBlocking) return;
  return FocusPodBlocking.openAccessibilitySettings();
}

export async function requestUsageStatsPermission(): Promise<void> {
  if (!isAndroid || !FocusPodBlocking) return;
  return FocusPodBlocking.openUsageStatsSettings();
}

// ─── Installed Apps ───────────────────────────────────────────────────────

export async function getInstalledApps(): Promise<BlockableApp[]> {
  if (!isAndroid || !FocusPodBlocking) return [];
  const apps: { packageName: string; appName: string }[] =
    await FocusPodBlocking.getInstalledApps();
  return apps.filter(
    a =>
      !a.packageName.startsWith('com.android.') &&
      a.packageName !== 'com.focuspod',
  );
}

// ─── Blocking Control ─────────────────────────────────────────────────────

export async function startBlocking(packageNames: string[]): Promise<void> {
  if (!isAndroid || !FocusPodBlocking) return;
  return FocusPodBlocking.startBlocking(packageNames);
}

export async function stopBlocking(): Promise<void> {
  if (!isAndroid || !FocusPodBlocking) return;
  return FocusPodBlocking.stopBlocking();
}
