// src/lib/supabaseServer.ts
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/** Minimal cookie reader so this works in Route Handlers & Server Components */
type ReadonlyRequestCookiesLike = {
  get(name: string): { value?: string } | undefined;
};

function readCookie(name: string): string {
  try {
    const store = cookies() as unknown as ReadonlyRequestCookiesLike;
    return store.get(name)?.value ?? '';
  } catch {
    return '';
  }
}

/**
 * Server-side Supabase client that reads the auth cookies.
 * We do not mutate cookies from route handlers, so set/remove are no-ops.
 */
export function createClientServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase env is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return readCookie(name);
      },
      set(_name: string, _value: string, _options: CookieOptions) {
        // no-op in route handlers
      },
      remove(_name: string, _options: CookieOptions) {
        // no-op in route handlers
      },
    },
  });
}