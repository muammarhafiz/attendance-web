import { NextResponse } from 'next/server';
import { STAFF_SOURCE_URL, STAFF_API_KEY } from '@/lib/staffSource';

export async function GET() {
  try {
    const res = await fetch(`${STAFF_SOURCE_URL}?select=email,name,is_admin`, {
      headers: {
        apikey: STAFF_API_KEY,
        Authorization: `Bearer ${STAFF_API_KEY}`,
      },
      cache: 'no-store',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || 'Fetch failed');
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
  }
}