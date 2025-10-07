// src/app/api/simple-login/route.ts
import { NextResponse } from 'next/server';
import { fetchStaffRecord } from '@/lib/staffSource';
import { makeCookie } from '@/lib/simpleSession';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ ok: false, error: 'Email required' }, { status: 400 });
    }

    const staff = await fetchStaffRecord(email);
    if (!staff) {
      return NextResponse.json({ ok: false, error: 'Email not found' }, { status: 404 });
    }

    const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
    const cookie = makeCookie(secret, staff.email);

    const res = NextResponse.json({ ok: true, email: staff.email, name: staff.name, is_admin: staff.is_admin });
    res.cookies.set(cookie);
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Login failed' }, { status: 500 });
  }
}