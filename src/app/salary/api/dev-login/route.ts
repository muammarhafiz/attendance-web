// src/app/api/dev-login/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_KEYS } from '@/lib/session';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || '').trim().toLowerCase();
  const name = String(body?.name || '').trim() || null;
  const is_admin = !!body?.is_admin;

  if (!email) {
    return NextResponse.json({ ok: false, error: 'Email required' }, { status: 400 });
  }

  // NOTE: No DB verification (as requested: keep it simple).
  // If you want to verify email exists in staff, you can add a query here.

  const store = cookies();
  store.set(SESSION_COOKIE_KEYS.COOKIE_EMAIL, email, { path: '/', httpOnly: true, sameSite: 'lax' });
  if (name) store.set(SESSION_COOKIE_KEYS.COOKIE_NAME, name, { path: '/', httpOnly: true, sameSite: 'lax' });
  store.set(SESSION_COOKIE_KEYS.COOKIE_ADMIN, is_admin ? '1' : '0', { path: '/', httpOnly: true, sameSite: 'lax' });

  return NextResponse.json({ ok: true });
}