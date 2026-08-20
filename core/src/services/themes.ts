/**
 * themes — the palettes the device shell can wear.
 *
 * Core owns the *list* and its metadata; each platform owns the actual colour
 * values (web: `[data-theme]` blocks in index.css). That split is deliberate —
 * a theme is a set of CSS custom properties on web and a StyleSheet object on
 * mobile, and core has no business knowing which.
 *
 * `swatch` is the one colour that stands for the theme in the picker. It is
 * duplicated from the platform palette on purpose: the picker has to draw a
 * dot for a theme that is *not* currently applied, so it cannot read the value
 * from the live custom properties.
 *
 * `locked` themes are the ones behind an email sign-in. Everything the app
 * actually does — listening, downloading, focusing — stays free forever; what
 * is gated is decoration. See `entitlements.ts` for the rule itself.
 */

import { AppTheme } from '../types';

export interface ThemeMeta {
  id: AppTheme;
  label: string;
  /** Representative colour, for the swatch in the picker. */
  swatch: string;
  /** Whether it needs a signed-in account. */
  locked: boolean;
}

export const THEMES: ThemeMeta[] = [
  { id: 'classic', label: 'Classic', swatch: '#c8d4c0', locked: false },
  { id: 'midnight', label: 'Midnight', swatch: '#2b3f5c', locked: false },
  { id: 'strawberry', label: 'Strawberry', swatch: '#f4a6bb', locked: false },
  { id: 'matcha', label: 'Matcha', swatch: '#9dc88d', locked: true },
  { id: 'blueberry', label: 'Blueberry', swatch: '#8fa6e0', locked: true },
  { id: 'peach', label: 'Peach', swatch: '#f6b393', locked: true },
  { id: 'lavender', label: 'Lavender', swatch: '#bda6e0', locked: true },
  { id: 'bubblegum', label: 'Bubblegum', swatch: '#f2a3d4', locked: true },
];

export const DEFAULT_THEME: AppTheme = 'classic';

export function themeMeta(id: AppTheme): ThemeMeta {
  return THEMES.find(t => t.id === id) ?? THEMES[0];
}

/** Free themes, for callers that need to fall back when an account goes away. */
export function isThemeFree(id: AppTheme): boolean {
  return !themeMeta(id).locked;
}
