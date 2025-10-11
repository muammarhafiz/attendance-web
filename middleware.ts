// middleware.ts
import { NextResponse, type NextRequest } from 'next/server'

export function middleware(_req: NextRequest) {
  // No auth logic here — just let requests pass through.
  return NextResponse.next()
}

// Optional: run on everything except Next.js assets
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}