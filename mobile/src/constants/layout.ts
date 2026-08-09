import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Physical iPod layout constants ──────────────────────────────────────────
// Proportions derived from classic iPod feel, adapted for phone screens.
// LCD takes the top 35 % of screen height; click wheel fills the rest.
const LCD_REGION_H = Math.round(SCREEN_HEIGHT * 0.35);
const BEZEL_PAD = 9;                          // dark bezel padding
const GLASS_H = LCD_REGION_H - 2 * BEZEL_PAD;
const TITLE_BAR_H = 24;
const CONTENT_H = GLASS_H - TITLE_BAR_H;
const ROW_H = 28;
const WHEEL_D = Math.min(Math.round(SCREEN_HEIGHT * 0.65 * 0.88), SCREEN_WIDTH - 32);
const CENTER_D = Math.round(WHEEL_D * 0.32);

export const IpodLayout = {
  // LCD
  lcdRegionH: LCD_REGION_H,
  lcdBezelPad: BEZEL_PAD,
  lcdGlassH: GLASS_H,
  lcdTitleBarH: TITLE_BAR_H,
  lcdContentH: CONTENT_H,
  lcdInnerWidth: SCREEN_WIDTH - 32 - 2 * BEZEL_PAD,   // width inside glass

  // List rows
  lcdRowH: ROW_H,
  lcdVisibleRows: Math.max(1, Math.floor(CONTENT_H / ROW_H)),

  // Click wheel
  wheelDiameter: WHEEL_D,
  wheelRadius: WHEEL_D / 2,
  centerButtonDiameter: CENTER_D,
  centerButtonRadius: CENTER_D / 2,
} as const;

export const Layout = {
  screenWidth: SCREEN_WIDTH,
  screenHeight: SCREEN_HEIGHT,

  // Wheel dimensions — sized relative to screen width
  wheelDiameter: Math.min(SCREEN_WIDTH * 0.78, 300),
  wheelCenterDiameter: Math.min(SCREEN_WIDTH * 0.28, 108),

  // Spacing
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,

  // Border radius
  radiusSm: 8,
  radiusMd: 16,
  radiusLg: 24,
  radiusRound: 9999,

  // Typography
  fontSizeXs: 11,
  fontSizeSm: 13,
  fontSizeMd: 15,
  fontSizeLg: 17,
  fontSizeXl: 20,
  fontSizeXxl: 28,
  fontSizeDisplay: 36,
} as const;
