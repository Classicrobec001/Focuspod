// iPod-inspired dark palette
export const Colors = {
  // Backgrounds
  background: '#0A0A0A',
  surface: '#1A1A1A',
  surfaceElevated: '#242424',
  border: '#2C2C2C',

  // Text
  textPrimary: '#F2F2F2',
  textSecondary: '#8A8A8A',
  textMuted: '#4A4A4A',

  // Accent — classic iPod blue-white
  accent: '#E8E8E8',
  accentBlue: '#4A9EFF',
  accentActive: '#FFFFFF',

  // Wheel
  wheelBackground: '#1C1C1C',
  wheelRing: '#3A3A3A',
  wheelCenter: '#2A2A2A',
  wheelCenterActive: '#3C3C3C',
  wheelText: '#C0C0C0',

  // Session
  sessionActive: '#34C759',
  sessionPaused: '#FF9F0A',
  sessionEnd: '#FF453A',

  // Progress
  progressTrack: '#2C2C2C',
  progressFill: '#E8E8E8',

  // Status
  success: '#34C759',
  warning: '#FF9F0A',
  error: '#FF453A',
  info: '#4A9EFF',
} as const;

export type ColorKey = keyof typeof Colors;
