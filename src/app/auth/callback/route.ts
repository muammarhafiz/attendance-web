import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(req: Request) {
  const supabase = createRouteHandlerClient({ cookies })
  await supabase.auth.exchangeCodeForSession(req.url)
  return NextResponse.redirect(new URL('/', req.url))
}