// src/lib/supabaseServer.ts
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/** minimal cookie interface (avoid any) */
type ReadonlyRequestCookiesLike = {
  get(name: string): { value?: string } | undefined;
};

function readCookie(name: string): string {
  try {
    const store = cookies() as unknown as ReadonlyRequestCookiesLike;
    return store.get(name)?.value ?? '';
  } catch {
    // if cookies() throws (edge/runtime mismatch), just return empty
    return '';
  }
}

/** Server-side Supabase client that reads auth from request cookies */
export function createClientServer(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return readCookie(name);
      },
      // Route handlers generally shouldn't mutate cookies.
      // We still implement the interface to keep SSR helper happy.
      set(name: string, value: string, options: CookieOptions) {
        void name; void value; void options;
        // no-op
      },
      remove(name: string, options: CookieOptions) {
        void name; void options;
        // no-op
      },
    },
  }) as unknown as SupabaseClient;
}