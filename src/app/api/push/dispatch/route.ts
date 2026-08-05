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
  pinv_created: 'Purchase invoice created ✓',
  not_checkin: 'Not checked in',
  stuckcar: 'Cars stuck in shop',
  debt: 'Newly overdue bills',
  lowstock: 'Items to restock',
  bnpl_payout: 'New BNPL payout',
  probation_review: 'Probation review due',
  job_done: 'Job finished',
  po_created: 'PO created',
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

  // Two audiences: most bell content is OWNER-ONLY; the "PI created" item also goes to the office team
  // (Manager + Office — anyone with month_end access). Everything else stays owner-only.
  const { data: staffRows } = await pushAdmin.from('staff').select('email, is_admin, position').is('archived_at', null);
  const { data: paRows } = await pushAdmin.from('position_access').select('position').eq('feature', 'month_end').eq('allowed', true);
  const officePositions = new Set((paRows ?? []).map((r) => String((r as { position: string }).position)));
  const adminEmails = new Set<string>();
  const officeEmails = new Set<string>(); // Owner + Manager + Office (pinv_created audience)
  for (const r of (staffRows ?? []) as { email: string | null; is_admin: boolean | null; position: string | null }[]) {
    const e = String(r.email ?? '').toLowerCase();
    if (!e) continue;
    if (r.is_admin) { adminEmails.add(e); officeEmails.add(e); }
    else if (r.position && officePositions.has(r.position)) officeEmails.add(e);
  }

  const { data: allSubs } = await pushAdmin.from('push_subscriptions').select('endpoint, p256dh, auth, email');
  type Sub = import('@/lib/pushServer').SubRow & { email: string };
  const subsFor = (emails: Set<string>) => ((allSubs ?? []) as Sub[]).filter((x) => emails.has(String(x.email).toLowerCase()));
  const adminSubs = subsFor(adminEmails);
  const officeSubs = subsFor(officeEmails);

  if (adminSubs.length === 0 && officeSubs.length === 0) return NextResponse.json({ sent: 0, items: items.length, devices: 0 });

  // Per-user push preferences: skip a device whose owner turned that notification type off.
  const { data: prefRows } = await pushAdmin.from('push_prefs').select('email, ntype').eq('enabled', false);
  const muted = new Map<string, Set<string>>();
  for (const r of (prefRows ?? []) as { email: string; ntype: string }[]) {
    const e = String(r.email).toLowerCase();
    if (!muted.has(e)) muted.set(e, new Set());
    muted.get(e)!.add(r.ntype);
  }
  const notMuted = (sub: Sub, type: string) => !muted.get(String(sub.email).toLowerCase())?.has(type);

  const base = s.app_base_url ?? '';
  let sent = 0;
  const dead = new Set<string>();

  for (const it of items) {
    const targetSubs = (it.type === 'pinv_created' ? officeSubs : adminSubs).filter((sub) => notMuted(sub, it.type));
    if (targetSubs.length === 0) continue;
    const payload = JSON.stringify({
      title: LABEL[it.type] ?? 'Zordaq alert',
      body: `${it.who} · ${it.detail}`,
      url: base + (it.href || '/'),
      tag: `${it.type}:${it.id}`,
      icon: '/icon.png',
    });
    const results = await Promise.all(targetSubs.map((sub) => sendToSubscription(sub, payload)));
    results.forEach((r, i) => {
      if (r.ok) sent++;
      if (r.dead) dead.add(targetSubs[i].endpoint);
    });
  }

  if (dead.size) await pushAdmin.from('push_subscriptions').delete().in('endpoint', [...dead]);

  return NextResponse.json({ sent, items: items.length, adminDevices: adminSubs.length, officeDevices: officeSubs.length, pruned: dead.size });
}
