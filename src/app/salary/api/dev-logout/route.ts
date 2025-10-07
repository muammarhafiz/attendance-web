// src/app/api/dev-logout/route.ts
import { NextResponse } from 'next/server';
import { clearSessionCookies } from '@/lib/session';

export async function POST() {
  clearSessionCookies();
  return NextResponse.json({ ok: true });
}