// ─── Physical iPod palette ────────────────────────────────────────────────────
// Off-white device body, pale-green LCD glass, deep-navy selection highlight —
// closely matching the classic 4th-gen iPod colour language.
export const IpodColors = {
  // Device shell
  deviceBody: '#E8E8E3',          // off-white plastic body
  deviceBodyShadow: '#C8C8C3',    // subtle shadow / rim

  // LCD
  lcdBezel: '#2A2A2A',            // dark bezel surround
  lcdGlass: '#C8D4C0',            // pale green-gray glass surface
  lcdTitleBarBg: '#1B3D6C',       // deep navy — title bar + selection
  lcdTitleBarText: '#FFFFFF',

  // List rows
  rowBg: '#D4DDCC',               // lighter green-gray row background
  rowText: '#1A2A1A',             // dark greenish text
  rowSelectedBg: '#1B3D6C',       // same as title bar
  rowSelectedText: '#FFFFFF',
  rowArrow: '#6A8A6A',            // subdued arrow colour
  rowDivider: '#B8C8B0',

  // Click wheel
  wheelSurface: '#D8D8D2',        // light warm gray
  wheelHighlight: '#ECECE8',      // top-light sheen
  wheelLabel: '#4A4A46',          // dark gray labels
  wheelCenterBtn: '#C8C8C4',      // slightly darker center button
  wheelCenterRing: '#A8A8A4',     // center button ring

  // Progress bar (in LCD)
  progressTrack: '#B0BEA8',
  progressFill: '#1B3D6C',

  // Status colours re-used
  playing: '#1B3D6C',
  paused: '#6A8A6A',
  sessionActive: '#1B5E20',
  sessionWarning: '#E65100',
} as const;

// ─── Legacy dark palette (kept for any code that still imports Colors) ────────
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
