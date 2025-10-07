// src/app/api/logout/route.ts
import { NextResponse } from 'next/server';
import { clearCookie } from '@/lib/simpleSession';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearCookie());
  return res;
}