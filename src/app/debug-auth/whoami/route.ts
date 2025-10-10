// Quick diagnostic: confirms whether the server sees your Supabase session cookies
import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

type ReadonlyCookies = { get(name: string): { value?: string } | undefined };

function readCookie(name: string): string {
  try {
    const store = cookies() as unknown as ReadonlyCookies;
    return store.get(name)?.value ?? '';
  } catch {
    return '';
  }
}

function createClientServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return readCookie(name);
      },
      set(_n: string, _v: string, _o: CookieOptions) {},
      remove(_n: string, _o: CookieOptions) {},
    },
  });
}

export async function GET() {
  const supabase = createClientServer();
  const { data, error } = await supabase.auth.getUser();

  const cookieHints = {
    access: !!readCookie('sb-access-token'),
    refresh: !!readCookie('sb-refresh-token'),
    generic: !!readCookie('sb:token'),
  };

  return NextResponse.json({
    ok: !error && !!data?.user,
    userEmail: data?.user?.email ?? null,
    error: error?.message ?? null,
    cookieHints,
  });
}