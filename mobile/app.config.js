/**
 * app.config.js — Expo/EAS build configuration for FocusPod.
 *
 * Setup steps (one-time):
 *   1.  npm install expo
 *   2.  npx eas login          # sign in / create Expo account
 *   3.  npx eas build:configure  # links this project to your EAS account,
 *                                # writes your projectId into extra.eas.projectId
 *   4.  npx eas build --platform ios --profile preview
 *
 * The `preview` profile (in eas.json) produces a signed IPA that can be installed
 * via TestFlight or directly with a provisioning profile — no Xcode required.
 *
 * iOS bundle identifier:  com.focuspod.app  ← change if already taken
 * Android package name:   com.focuspod      ← must match android/app/build.gradle
 */

module.exports = {
  name: 'FocusPod',
  slug: 'focuspod',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.focuspod.app',
    buildNumber: '1',
    infoPlist: {
      // Background audio — required for audiobook playback with screen off
      UIBackgroundModes: ['audio'],
    },
  },

  android: {
    package: 'com.focuspod',
    versionCode: 1,
    permissions: [
      'android.permission.PACKAGE_USAGE_STATS',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ],
  },

  extra: {
    eas: {
      // Filled in automatically by `eas build:configure`.  Replace the
      // placeholder below if you are setting this up manually.
      projectId: 'YOUR_EAS_PROJECT_ID',
    },
  },
};
