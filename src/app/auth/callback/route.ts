// src/app/api/auth/callback/route.ts
import { NextResponse } from 'next/server'
import { createClientServer } from '@/lib/supabaseServer'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  // Only allow same-site relative paths, to prevent an open-redirect via ?next=
  const nextRaw = url.searchParams.get('next') || '/'
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/'

  // Server-side Supabase client; handles cookies internally
  const supabase = createClientServer(req)

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
      )
    }
  }

  // Owners land on their dashboard by default (Check-in stays in the nav).
  let dest = next
  if (next === '/') {
    try {
      const { data: acc } = await supabase.rpc('my_access')
      if (acc && (acc as { owner?: boolean }).owner) dest = '/dashboard'
    } catch { /* fall back to next */ }
  }

  return NextResponse.redirect(new URL(dest, url.origin))
}