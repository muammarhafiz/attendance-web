// src/lib/supabaseServer.ts
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Minimal read-only cookie shape to avoid `any`. */
type ReadonlyRequestCookiesLike = {
  get(name: string): { value?: string } | undefined;
};

export const createClientServer = () => {
  const jar = cookies() as unknown as ReadonlyRequestCookiesLike;

  return createServerClient(URL, ANON, {
    cookies: {
      get(name: string) {
        return jar.get(name)?.value;
      },
      // No-ops in route handlers (typed to satisfy @supabase/ssr)
      set(_name: string, _value: string, _options: CookieOptions) {},
      remove(_name: string, _options: CookieOptions) {},
    },
  });
};