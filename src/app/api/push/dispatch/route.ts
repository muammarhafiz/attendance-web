// src/app/api/push/dispatch/route.ts
// Called every minute by pg_cron (net.http_post). Pushes any NEW bell alert to admin devices.
import { NextResponse } from 'next/server';
import { pushAdmin, loadPushSecrets, configureVapid, sendToSubscription } from '@/lib/pushServer';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// Server-side titles for each bell item type (mirrors NavBar's NOTIF_LABEL, phrased as a heading).
const LABEL: Record<string, string> = {
  offday: 'Off-day request',
  halfday: 'Half-day request',
  advance: 'Advance request',
  mc: 'MC request',
  po: 'Purchase order',
  pinv: 'Purchase invoice',
  stuckcar: 'Cars stuck in shop',
  debt: 'Newly overdue bills',
  lowstock: 'Items to restock',
};

type FeedItem = { type: string; id: string; who: string; detail: string; when: string; href: string };

export async function POST(req: Request) {
  const s = await loadPushSecrets();

  // Shared-secret guard (pg_cron passes it in the header).
  const token = req.headers.get('x-dispatch-token') ?? '';
  if (!s.push_dispatch_token || token !== s.push_dispatch_token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Claim + fetch the new, recent bell items.
  const { data: pending, error } = await pushAdmin.rpc('push_pending');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const items = (Array.isArray(pending) ? pending : []) as FeedItem[];
  if (items.length === 0) return NextResponse.json({ sent: 0, items: 0 });

  configureVapid(s);

  // Bell content is admin-only, so only push to admins' devices.
  const { data: adminRows } = await pushAdmin.from('staff').select('email').eq('is_admin', true);
  const adminEmails = new Set((adminRows ?? []).map((r) => String((r as { email: string }).email).toLowerCase()));
  const { data: allSubs } = await pushAdmin.from('push_subscriptions').select('endpoint, p256dh, auth, email');
  const subs = (allSubs ?? []).filter((x) => adminEmails.has(String((x as { email: string }).email).toLowerCase())) as
    (import('@/lib/pushServer').SubRow & { email: string })[];

  if (subs.length === 0) return NextResponse.json({ sent: 0, items: items.length, devices: 0 });

  const base = s.app_base_url ?? '';
  let sent = 0;
  const dead = new Set<string>();

  for (const it of items) {
    const payload = JSON.stringify({
      title: LABEL[it.type] ?? 'Zordaq alert',
      body: `${it.who} · ${it.detail}`,
      url: base + (it.href || '/'),
      tag: `${it.type}:${it.id}`,
      icon: '/icon.png',
    });
    const results = await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
    results.forEach((r, i) => {
      if (r.ok) sent++;
      if (r.dead) dead.add(subs[i].endpoint);
    });
  }

  if (dead.size) await pushAdmin.from('push_subscriptions').delete().in('endpoint', [...dead]);

  return NextResponse.json({ sent, items: items.length, devices: subs.length, pruned: dead.size });
}
