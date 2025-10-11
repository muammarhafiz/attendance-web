// src/app/api/auth/callback/route.ts
import { NextResponse } from 'next/server'
import { createClientServer } from '@/lib/supabaseServer'

export const runtime = 'nodejs' // ensure Node runtime for cookie setting

export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/'

  // Server-side Supabase client; handles cookies internally
  const supabase = createClientServer(req)

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, origin)
      )
    }
  }

  return NextResponse.redirect(new URL(next, origin))
}