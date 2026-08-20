/**
 * The milestone banner.
 *
 * A streak milestone is the one moment this app has worth interrupting for, and
 * it is also the only one — so it is a banner that dismisses itself, not a
 * modal with a button. It never appears during a focus session: the entire
 * point of that screen is that nothing interrupts it, and a congratulation is
 * still an interruption.
 */

import { useEffect } from 'react';
import { useSessionStore, useStreakStore } from '@focuspod/core';
import { analytics } from '../analytics';

const VISIBLE_MS = 6000;

export default function StreakToast() {
  const earned = useStreakStore(s => s.earned);
  const clearEarned = useStreakStore(s => s.clearEarned);
  const inSession = useSessionStore(s => s.currentSession !== null);

  useEffect(() => {
    if (earned === null) return;
    analytics.streakMilestone(earned);
    const handle = setTimeout(clearEarned, VISIBLE_MS);
    return () => clearTimeout(handle);
  }, [earned, clearEarned]);

  if (earned === null || inSession) return null;

  return (
    <div className="toast" role="status">
      <strong>{earned} days in a row.</strong>
      <span>That is a habit now.</span>
    </div>
  );
}
