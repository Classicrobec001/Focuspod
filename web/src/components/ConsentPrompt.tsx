/**
 * Asks once, remembers the answer, and never nags.
 *
 * Shown only when analytics is actually configured for this build and the user
 * has not answered. Declining is stored the same as accepting, so it is asked
 * once and never again — and no script loads unless the answer was yes.
 */

import { useSettingsStore } from '@focuspod/core';
import { analyticsConfigured, setAnalyticsConsent } from '../analytics';

export default function ConsentPrompt() {
  const preferences = useSettingsStore(s => s.preferences);
  const isLoaded = useSettingsStore(s => s.isLoaded);
  const update = useSettingsStore(s => s.update);

  if (!analyticsConfigured || !isLoaded || preferences.analyticsConsent !== null) return null;

  const answer = async (consent: boolean) => {
    setAnalyticsConsent(consent);
    await update({ analyticsConsent: consent });
  };

  return (
    <div className="install consent" role="dialog" aria-label="Usage analytics">
      <span>
        Share anonymous usage data to help improve FocusPod? No personal data, and never what
        you search for.
      </span>
      <div className="consent__actions">
        <button type="button" onClick={() => void answer(true)}>
          Allow
        </button>
        <button type="button" className="install__dismiss" onClick={() => void answer(false)}>
          No thanks
        </button>
      </div>
    </div>
  );
}
