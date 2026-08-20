/**
 * Supabase implementation of AuthPort — passwordless email sign-in and the
 * synced state blob.
 *
 * Why Supabase and not Firebase, or both
 * ──────────────────────────────────────
 * Only one of them can be the answer to "who is this user". Two identity
 * providers means two user ids, and a favourite saved under one is invisible
 * to the other — so this picks one. Supabase because magic links, a Postgres
 * table you can query for the email list, and row-level security are all on
 * the free tier, and because the client is the only server this app has.
 *
 * The choice is contained in this file. Core talks to `AuthPort`, so swapping
 * providers — or adding Firebase later for something genuinely different, like
 * push notifications — touches nothing else.
 *
 * Absent configuration, `available` is false and every account surface in the
 * app hides itself, exactly as analytics does without a measurement id. A fork
 * or a local checkout gets a working app with no accounts, not a broken one.
 *
 * The SDK is imported dynamically so its bytes are only fetched when a build
 * is actually configured for accounts.
 */

import type { AuthPort, CloudState } from '@focuspod/core';
import type { Account } from '@focuspod/core';
import type { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const CONFIGURED = Boolean(SUPABASE_URL && ANON_KEY);

/** The one-row-per-user table holding the synced blob. See docs/accounts.md. */
const TABLE = 'user_state';

type Listener = (account: Account | null) => void;

let clientPromise: Promise<SupabaseClient> | null = null;
const listeners = new Set<Listener>();

function toAccount(user: { id: string; email?: string } | null | undefined): Account | null {
  if (!user?.email) return null;
  return { id: user.id, email: user.email };
}

async function client(): Promise<SupabaseClient> {
  if (!CONFIGURED) throw new Error('Accounts are not configured in this build.');
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => {
      const supabase = createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // The magic link comes back as a URL fragment. Letting the SDK
          // consume it is what completes the sign-in when the link is opened.
          detectSessionInUrl: true,
        },
      });
      supabase.auth.onAuthStateChange((_event, session) => {
        const account = toAccount(session?.user);
        listeners.forEach(listener => listener(account));
      });
      return supabase;
    });
  }
  return clientPromise;
}

/**
 * Where the link should land. The PWA is served from a sub-path on Pages, so
 * this has to include the base — dropping it sends people to a 404 on the
 * user's own domain, which looks exactly like a broken sign-in.
 */
function redirectUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

export const webAuth: AuthPort = {
  available: CONFIGURED,

  currentAccount: async () => {
    if (!CONFIGURED) return null;
    const supabase = await client();
    const { data } = await supabase.auth.getSession();
    return toAccount(data.session?.user);
  },

  sendMagicLink: async email => {
    const supabase = await client();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl(),
        // New addresses are allowed to sign up. This is the growth surface:
        // there is no separate "register" step to abandon halfway.
        shouldCreateUser: true,
      },
    });
    if (error) throw new Error(error.message);
  },

  signOut: async () => {
    if (!CONFIGURED) return;
    const supabase = await client();
    await supabase.auth.signOut();
  },

  subscribe: listener => {
    listeners.add(listener);
    // Nothing subscribes before startup, but the client is lazy — make sure it
    // exists so the SDK's own auth listener is attached and links resolve.
    if (CONFIGURED) void client().catch(() => undefined);
    return () => listeners.delete(listener);
  },

  pullState: async () => {
    const supabase = await client();
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user.id;
    if (!userId) return null;

    const { data, error } = await supabase
      .from(TABLE)
      .select('state')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data?.state as CloudState | undefined) ?? null;
  },

  pushState: async state => {
    const supabase = await client();
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user.id;
    if (!userId) return;

    const { error } = await supabase
      .from(TABLE)
      .upsert({ user_id: userId, state, updated_at: new Date().toISOString() }, {
        onConflict: 'user_id',
      });
    if (error) throw new Error(error.message);
  },
};

/** Whether this build has accounts at all — used to hide the UI when it doesn't. */
export const accountsConfigured = CONFIGURED;
