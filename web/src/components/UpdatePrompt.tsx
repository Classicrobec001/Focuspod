/**
 * Makes a new deployment actually appear.
 *
 * The service worker serves the app shell from cache, so after a deploy a
 * returning visitor keeps running the *old* JavaScript: the new worker installs
 * quietly in the background and the page never picks it up. That is why a change
 * can be live on the server and still invisible in the app — the generated
 * registration script only registers, it never reloads.
 *
 * When the new worker takes control, this reloads to pick it up — except while
 * audio is playing, where a silent reload would cut off a chapter mid-sentence.
 * Then it waits and offers the reload instead.
 */

import { useEffect, useState } from 'react';
import { usePlaybackStore } from '@focuspod/core';

export default function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  const status = usePlaybackStore(s => s.status);
  const isPlaying = status === 'playing' || status === 'buffering';

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // A page with no controller is a first install, not an update — reloading
    // there would be a pointless flash on someone's very first visit.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let handled = false;

    const onControllerChange = () => {
      if (handled) return;
      handled = true;
      if (!hadController) return;
      setReady(true);
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () =>
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  // Nothing is playing, so take the update immediately and say nothing.
  useEffect(() => {
    if (ready && !isPlaying) window.location.reload();
  }, [ready, isPlaying]);

  if (!ready || !isPlaying) return null;

  return (
    <div className="install" role="status">
      <span>Update ready</span>
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
