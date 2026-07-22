// src/app/api/push/test/route.ts
// Sends a test push to the signed-in caller's own devices (powers the "Send test" button).
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';
import { pushAdmin, loadPushSecrets, configureVapid, sendToSubscription, type SubRow } from '@/lib/pushServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supa = createClientServer(req);
  const { data: { user } } = await supa.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const s = await loadPushSecrets();
  configureVapid(s);

  const { data: subs } = await pushAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('email', user.email.toLowerCase());
  if (!subs?.length) return NextResponse.json({ error: 'This device is not subscribed yet.' }, { status: 400 });

  const payload = JSON.stringify({
    title: 'Zordaq test 🔔',
    body: 'Push notifications are working on this device.',
    url: '/',
    icon: '/icon.png',
    tag: 'test',
  });

  let sent = 0;
  const dead: string[] = [];
  for (const sub of subs as SubRow[]) {
    const r = await sendToSubscription(sub, payload);
    if (r.ok) sent++;
    if (r.dead) dead.push(sub.endpoint);
  }
  if (dead.length) await pushAdmin.from('push_subscriptions').delete().in('endpoint', dead);

  return NextResponse.json({ sent });
}
