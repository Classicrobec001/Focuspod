# Accounts, sync and the email list

FocusPod works completely without an account. This document is about the
optional half: passwordless email sign-in, what it unlocks, and the ten minutes
of setup that switch it on.

Left unconfigured — as a fork or a local checkout is — `webAuth.available` is
false, the Account row never appears in Settings, every theme is unlocked, and
the caps below do not apply. A build with no accounts is a *smaller* app, never
a crippled one.

## Why Supabase, and why not Supabase *and* Firebase

Only one system can answer "who is this user". Two identity providers means two
user ids, and a favourite saved under one is invisible to the other — so this
picks one. Supabase gives magic links, a queryable table of addresses and row
level security on the free tier, and it is a client SDK, which matters because
this app has no server.

The choice is contained in [`web/src/ports/webAuth.ts`](../web/src/ports/webAuth.ts).
Core only knows the `AuthPort` interface, so swapping providers is a one-file
change. Adding Firebase later for something genuinely different — push
notifications for streak reminders is the obvious candidate — does not conflict
with any of this, because it would not be doing identity.

## What an account unlocks

Defined in one place, [`core/src/services/entitlements.ts`](../core/src/services/entitlements.ts).

|                        | Signed out | Signed in |
| ---------------------- | ---------- | --------- |
| Favourite books/shows  | 20         | 300       |
| Favourite chapters     | 20         | 300       |
| Streak history         | 14 days    | 400 days  |
| Themes                 | 3 of 8     | all 8     |
| Sync across devices    | no         | yes       |

Nothing that makes the app useful is gated: every book, every podcast, every
download, every focus session and the streak itself work signed out, offline,
forever. If that stops being true, the comment at the top of `entitlements.ts`
should stop reading defensibly — fix the change, not the comment.

## Setup

### 1. Create the project

New project at [supabase.com](https://supabase.com). From
**Project Settings → API**, copy the **Project URL** and the **anon public**
key. The anon key is designed to ship in a client bundle; row level security,
configured below, is what actually protects the data.

### 2. Create the sync table

**SQL Editor → New query**, then run:

```sql
-- One row per user holding the synced blob. A single JSON document rather than
-- per-entity tables: it is small, always read and written whole, and never
-- queried by the server.
create table public.user_state (
  user_id    uuid primary key references auth.users on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

-- Each user reaches exactly their own row and no other. Without this the anon
-- key would let anyone read every row in the table.
create policy "own row read"   on public.user_state
  for select using (auth.uid() = user_id);
create policy "own row insert" on public.user_state
  for insert with check (auth.uid() = user_id);
create policy "own row update" on public.user_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### 3. Allow the redirect

**Authentication → URL Configuration → Redirect URLs**, add both:

```
https://<your-github-username>.github.io/Focuspod/
http://localhost:5173/
```

The trailing slash matters. A link that lands on a URL not in this list fails
in a way that looks exactly like a broken sign-in.

### 4. Point the build at it

Locally, `web/.env.local`:

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

For the deployed site, add the same two as **repository variables** —
Settings → Secrets and variables → Actions → **Variables** — named
`SUPABASE_URL` and `SUPABASE_ANON_KEY`. Variables, not secrets: both values are
public by design and end up in the bundle either way, and secrets are masked in
logs which only makes a failed build harder to read.

## The email list

The addresses are in **Authentication → Users**, exportable as CSV. That is the
whole list — there is no separate marketing table to keep in step, and someone
who deletes their account disappears from it, which is the correct behaviour and
the reason not to copy addresses elsewhere.

What the app promises on the sign-in screen is *"Used for sign-in and occasional
news about FocusPod. Nothing else, ever."* Keep it. An email asked for without a
stated purpose gets a throwaway address, and a throwaway address is worth
nothing to anybody.

Note that analytics never sees an address. Sign-in events are counted;
who signed in is not sent to Google. See the comment in `web/src/analytics.ts`.

## How sync behaves

- **Merge, not last-writer-wins.** Favourites union; streak days take the larger
  count per day. Two devices used offline are both right.
- **The cost, stated plainly:** deleting a favourite on one device does not
  delete it on the other — it returns on the next sync. Tombstones would fix it
  and are a lot of machinery for a list of bookmarks.
- **Theme** transfers on the first sync after signing in on a device, and not
  after, so a local change is never overwritten.
- **Pushes are debounced** by four seconds and flushed on `pagehide`.
- **Failure is never costly.** Every sync error is logged and shown on the
  account screen; nothing local is lost or blocked by it.

Signing out keeps the local library exactly where it is. It does drop a locked
theme back to Classic, since that is what the account was paying for.
