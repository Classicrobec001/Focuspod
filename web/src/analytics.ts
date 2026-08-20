/**
 * Usage analytics.
 *
 * Why GA4 and not Cloudflare Web Analytics
 * ────────────────────────────────────────
 * FocusPod is a single page that never changes URL, so a page-view analytics
 * product reports roughly one view per session and answers none of the
 * questions worth asking — which books get played, what people search for,
 * whether focus sessions are finished. GA4 is the only free option that records
 * custom events, so it is what this uses.
 *
 * The cost of that choice is Google's script and cookies, which need consent.
 * So: nothing loads until the user accepts, declining is remembered and never
 * re-asked, and it can be switched off again in Settings at any time.
 *
 * Everything goes through `track()`, and the provider lives only in this file,
 * so moving to Plausible or PostHog later is a one-file change.
 *
 * Two things this deliberately never records: the user's own text (search terms
 * are sent as a length bucket, not the words), and anything that could identify
 * a person.
 */

type Params = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Set at build time. Absent — as in any fork or local run — makes every call
 * here a no-op, so the app never depends on analytics being configured.
 */
const MEASUREMENT_ID = import.meta.env.VITE_GA_ID as string | undefined;

let loaded = false;
let enabled = false;
/** Events fired before consent resolves, replayed if it is granted. */
const pending: Array<{ name: string; params?: Params }> = [];

function loadGtag(): void {
  if (loaded || !MEASUREMENT_ID) return;
  loaded = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    // The app has one URL; sending it on every event adds nothing.
    send_page_view: true,
    anonymize_ip: true,
  });
}

/**
 * Apply the user's decision. `null` means they have not been asked yet, so
 * nothing is loaded and events queue in case they later accept.
 */
export function setAnalyticsConsent(consent: boolean | null): void {
  enabled = consent === true;
  if (!enabled) return;
  loadGtag();
  while (pending.length > 0) {
    const event = pending.shift()!;
    window.gtag?.('event', event.name, event.params);
  }
}

export function track(name: string, params?: Params): void {
  if (!MEASUREMENT_ID) return;
  if (!enabled) {
    // Cap the queue: a session spent declining shouldn't grow unbounded.
    if (pending.length < 30) pending.push({ name, params });
    return;
  }
  window.gtag?.('event', name, params);
}

/**
 * Named events, so call sites can't drift into inconsistent spellings and the
 * whole reporting surface is visible in one place.
 */
export const analytics = {
  appOpen: (installed: boolean) => track('app_open', { installed }),

  play: (kind: 'book' | 'podcast', id: string) => track('play', { kind, item_id: id }),
  chapterComplete: (kind: 'book' | 'podcast') => track('chapter_complete', { kind }),

  downloadStart: (chapters: number) => track('download_start', { chapters }),
  downloadComplete: (chapters: number) => track('download_complete', { chapters }),

  focusStart: (minutes: number) => track('focus_start', { minutes }),
  focusEnd: (minutes: number, status: string, distractions: number) =>
    track('focus_end', { minutes, status, distractions }),

  readAlongOpen: (quality: string) => track('read_along_open', { quality }),

  browseGenre: (genre: string) => track('browse_genre', { genre: genre || 'all' }),
  browsePodcastTopic: (topic: string) => track('browse_podcast_topic', { topic }),

  /**
   * Search is recorded as *whether* it happened and how many results came back,
   * never the words typed. What people search for is valuable, but not at the
   * cost of shipping user-entered text to Google.
   */
  search: (scope: 'books' | 'podcasts', resultCount: number) =>
    track('search', { scope, result_count: resultCount }),

  favorite: (added: boolean, kind: 'book' | 'podcast') =>
    track('favorite', { added, kind }),
  favoriteChapter: (added: boolean) => track('favorite_chapter', { added }),

  themeChange: (theme: string) => track('theme_change', { theme }),
  /** A locked theme was tapped — the clearest measure of what the gate is worth. */
  themeLocked: (theme: string) => track('theme_locked', { theme }),

  /**
   * Account events carry no address. Whether people sign in is a product
   * question; who they are is not something to hand to Google. The email lives
   * in Supabase, where it was given deliberately and can be deleted.
   */
  signInRequested: () => track('sign_in_requested'),
  signInCompleted: () => track('sign_in_completed'),
  signOut: () => track('sign_out'),

  /** Fires once per day, the first time that day's ten minutes are cleared. */
  streakDay: (streakLength: number) => track('streak_day', { streak_length: streakLength }),
  streakMilestone: (days: number) => track('streak_milestone', { days }),

  install: () => track('pwa_install'),
};

/** Whether analytics is even possible in this build — hides the UI if not. */
export const analyticsConfigured = Boolean(MEASUREMENT_ID);
