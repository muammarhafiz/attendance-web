// src/lib/supabaseServer.ts
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions, type SupabaseClient } from '@supabase/ssr';

type ReadonlyRequestCookiesLike = {
  get(name: string): { value?: string } | undefined;
};

/** Read a cookie value safely in a route handler (no exceptions during build/SSG). */
function readCookie(name: string): string | undefined {
  try {
    const store = cookies() as unknown as ReadonlyRequestCookiesLike;
    return store.get(name)?.value;
  } catch {
    // In edge/build contexts cookies() can throw; treat as missing cookie.
    return undefined;
  }
}

/** Create a Supabase server client that reads auth cookies but never mutates them here. */
export function createClientServer(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(url, anon, {
    cookies: {
      get(name: string): string | undefined {
        return readCookie(name);
      },
      // No-ops in route handlers; we don’t set/remove cookies here.
      set(_name: string, _value: string, _options: CookieOptions): void {},
      remove(_name: string, _options: CookieOptions): void {},
    },
  });
}