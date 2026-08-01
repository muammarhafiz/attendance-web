// src/app/auth/callback/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  // Only allow same-site relative paths, to prevent an open-redirect via ?next=
  const nextRaw = url.searchParams.get('next') || '/';
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/';

  // Collect any auth cookies the code-exchange sets, then write them onto the redirect response
  // so the browser actually keeps the session (the previous set()/remove() were no-ops).
  const collected: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          collected.push({ name, value, options });
        },
        remove(name: string, options: CookieOptions) {
          collected.push({ name, value: '', options });
        },
      },
    }
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
      );
    }
  }

  // Owners land on their dashboard by default (Check-in stays in the nav).
  let dest = next;
  if (next === '/') {
    try {
      const { data: acc } = await supabase.rpc('my_access');
      if (acc && (acc as { owner?: boolean }).owner) dest = '/dashboard';
    } catch { /* fall back to next */ }
  }

  const res = NextResponse.redirect(new URL(dest, url.origin));
  for (const c of collected) res.cookies.set(c.name, c.value, c.options);
  return res;
}
