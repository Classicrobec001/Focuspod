/**
 * Tap-to-select plumbing.
 *
 * Rows can be tapped as an alternative to rotating the wheel to them. This is a
 * second route into the *same* dispatcher — IpodDevice still decides what a
 * selection means — so the wheel's behaviour is untouched whether tapping is on
 * or off.
 *
 * A context rather than props because every list screen would otherwise have to
 * thread the handler through, and MenuList is the only component that needs it.
 */

import { createContext, useContext } from 'react';

export interface TapConfig {
  /** Mirrors the user's setting; false renders rows as plain, inert text. */
  enabled: boolean;
  /** Select the row at this absolute index, exactly as the centre button would. */
  onPick: (index: number) => void;
}

const TapContext = createContext<TapConfig>({ enabled: false, onPick: () => {} });

export const TapProvider = TapContext.Provider;

export function useTap(): TapConfig {
  return useContext(TapContext);
}
