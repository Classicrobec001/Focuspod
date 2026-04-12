import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

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
