# FocusPod

Distraction-free public-domain audiobook listening with an iPod click-wheel interface
and timed focus sessions.

The catalog is the [LibriVox](https://librivox.org) collection, served through the
Internet Archive. Everything is free and public domain.

```
core/     shared domain layer — types, catalog service, stores, port interfaces
web/      the PWA: React + Vite, browser implementations of the ports
mobile/   the React Native app: RNTP + Kotlin native modules
```

## Why it is split this way

`core` holds everything that has no opinion about the platform: the data model,
the Internet Archive catalog service, and the Zustand stores that hold library,
playback, download, session and navigation state. It reaches the outside world
only through the interfaces in [`core/src/ports`](core/src/ports/index.ts):

| Port | Web | Mobile |
| --- | --- | --- |
| `AudioPort` | `HTMLAudioElement` + Media Session | react-native-track-player |
| `StoragePort` | `localStorage` | AsyncStorage |
| `DownloadPort` | Cache Storage API | react-native-fs |
| `HapticPort` | Web Audio click + `navigator.vibrate` | `Vibration` + `TickSoundModule` |
| `FocusGuardPort` | Wake Lock + Page Visibility | accessibility service + usage stats |

Each platform calls `configureCore()` once at startup. A store never imports a
platform module and never branches on which platform it is running on — so a
feature written once behaves the same in both builds.

## Running the PWA

```bash
npm install
npm run dev          # http://localhost:5173, also reachable on your LAN
npm run build        # typechecks, then bundles to web/dist
npm run preview      # serve the production build
```

`npm run dev` binds to all interfaces, so you can open the dev server on a phone
on the same network — the click wheel needs a real touchscreen to judge.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
[`.github/workflows/deploy-web.yml`](.github/workflows/deploy-web.yml). Enable it
once under **Settings → Pages → Source: GitHub Actions**.

Pages serves project sites from `/<repo>/`, so the workflow sets `VITE_BASE=/Focuspod/`,
which flows into the bundle paths, the manifest `start_url` and the service worker
scope. Any host serving from a domain root needs no `VITE_BASE` at all.

## Analytics

Off unless a Google Analytics 4 measurement id is provided, and off even then
until the user agrees.

Set a repository variable `GA_MEASUREMENT_ID` (Settings → Secrets and variables
→ Actions → Variables) and the deploy picks it up. Without it, no tracking code
is bundled and the consent prompt never appears.

GA4 was chosen over a page-view product like Cloudflare Web Analytics for one
reason: FocusPod is a single page that never changes URL, so page views would
report about one per session and answer nothing. The questions worth asking —
which books get played, whether focus sessions finish, how many downloads
complete — are all custom events.

Everything routes through [`web/src/analytics.ts`](web/src/analytics.ts), which
is the only file that knows the provider, so switching to Plausible or PostHog
later is a one-file change. Search is recorded as *that* a search happened and
how many results came back, never the words typed. Account events are counted
without the address — how many people sign in is a product question, who they
are is not Google's business.

## Accounts, themes and streaks

Three features share one idea: the app is fully usable without an account, and
an email address buys continuity rather than access.

- **Themes** — eight palettes, three free. Each is a block of CSS custom
  properties in `web/src/index.css`; no theme may add a rule, only change
  values, which is what stops eight palettes becoming eight layouts.
- **Streaks** — ten minutes of listening in a local calendar day. Time comes
  from the wall clock between progress events, not from summing audio
  positions, so scrubbing forward through an hour earns nothing. Opt-out in
  Settings, and off means the counter really stops.
- **Accounts** — passwordless email links via Supabase, behind an `AuthPort` so
  core never imports it. Off unless configured, exactly like analytics.

Setup, the SQL for the sync table, and what sync does and does not guarantee
are in [`docs/accounts.md`](docs/accounts.md).

## Why the catalog comes from archive.org, not librivox.org

The LibriVox API at `librivox.org/api/feed/audiobooks` sends no
`Access-Control-Allow-Origin` header, so a browser refuses every request to it.
The Internet Archive hosts the same collection and does send `*`, on the JSON
endpoints and on the audio files, along with `accept-ranges: bytes`.

That is what keeps FocusPod a purely static site with no proxy and no backend.
[`core/src/services/archiveService.ts`](core/src/services/archiveService.ts) uses
two endpoints:

- `advancedsearch.php` for browse and search — cheap and paginated, but it returns
  no file list, so books arrive with `chapters: []`
- `metadata/<id>` for the file list, fetched lazily when a book is opened

Check `isHydrated(book)` before reading `book.chapters`.

## Focus sessions on the web

The mobile build enforces focus: an Android accessibility service notices a
blocked app opening and pulls FocusPod back in front of it.

**The web build cannot do this, and no browser API will ever allow it.** A page
cannot enumerate, observe, or raise other applications. Rather than pretend
otherwise, the PWA reports `soft-guard` and does what the platform genuinely
supports:

- **Wake Lock** holds the screen on for the length of the session
- **Page Visibility** notices when you leave and how long you stayed away, and
  records each absence against the session

The app-picker step is hidden entirely on web, and the session screen shows the
distraction count live. Sessions are accountability, not enforcement, until the
native build returns.

Timers are derived from wall-clock rather than counted ticks, because browsers
throttle background timers to once a minute and stop them altogether when the
screen locks.

## Other web-specific behaviour worth knowing

- **Offline audio** lives in Cache Storage, not IndexedDB — it stores `Response`
  bodies without deserialising them and has no practical per-entry size limit.
  Cached entries aren't URL-addressable, so `resolveUrl()` returns a
  `focuspod-cache:` pseudo-URL that the audio port turns into a blob URL for the
  one chapter that is playing. The app asks for persistent storage so downloads
  aren't evicted under disk pressure, and re-verifies the index on startup.
- **Wheel clicks** are synthesised through Web Audio. `navigator.vibrate` does
  not exist in Safari, so on iPhone the click sound *is* the feedback.
- **The first tap** primes the audio element and the AudioContext. Browsers only
  permit playback that originates in a user gesture, and our `play()` calls happen
  after `await`s.

## Mobile

`mobile/` still contains the working React Native app and is untouched by the web
build. It is deliberately not an npm workspace: Metro's resolver and npm hoisting
conflict, and its `node_modules` is pinned to a tested set — see
[`docs_architecture.md`](docs_architecture.md) for the version constraints and the
Android build notes.

Wiring `mobile/` to `core/` is the next step, and needs a Metro `watchFolders` entry
plus a resolver alias rather than a workspace link.
