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
 * Server-side Supabase client that:
 *  - reads auth cookies (if present)
 *  - ALSO honors an Authorization: Bearer <token> header (if the client forwards it)
 */
export function createClientServer(req?: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase env is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const authHeader = req?.headers.get('authorization') ?? '';

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
    // Allow bearer token to authenticate server-side if cookies aren’t present
    global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
  });
}

/** Convenience: schema-agnostic server client (no Request object needed). */
export function supabaseServer() {
  return createClientServer();
}

/** pay_v2-scoped client (tables, views, RPCs all hit the pay_v2 schema). */
export function supabasePayV2(req?: Request) {
  // @ts-expect-error supabase-js v2 has .schema() at runtime even if types lag
  return createClientServer(req).schema('pay_v2');
}