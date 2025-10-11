// src/app/api/auth/callback/route.ts
import { NextResponse } from 'next/server'
import { createClientServer } from '@/lib/supabaseServer'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') || '/'

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

  return NextResponse.redirect(new URL(next, url.origin))
}