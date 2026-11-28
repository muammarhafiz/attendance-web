// src/app/api/push/dispatch/route.ts
// Called every minute by pg_cron (net.http_post). Pushes any NEW bell alert to the right audience.
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
  not_checkin: 'Morning attendance',
  stuckcar: 'Cars stuck in shop',
  debt: 'Newly overdue bills',
  lowstock: 'Items to restock',
  bnpl_payout: 'New BNPL payout',
  probation_review: 'Probation review due',
  job_done: 'Job finished',
  po_created: 'PO created',
  owner_digest: 'End-of-day summary',
  robot_health: '⚠️ Import health',
  sales_unmapped: '👤 New salesperson',
  bnpl_premature: '⚠️ BNPL paid, no payout',
  tyre_miscoded: '🛞 Tyre booked wrong',
  // Approve/reject outcome of a staff request (goes to all staff).
  offday_result: 'Off-day request',
  halfday_result: 'Half-day request',
  mc_result: 'MC request',
  advance_result: 'Advance request',
};

// A staff REQUEST submit notifies the owner + all supervisors.
const SUBMIT_TYPES = new Set(['offday', 'halfday', 'mc', 'advance']);
// A staff request DECISION (approve/reject) notifies all active staff.
const RESULT_TYPES = new Set(['offday_result', 'halfday_result', 'mc_result', 'advance_result']);

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

  // Audiences by item type:
  //  - most bell content  → OWNER-ONLY (admins)
  //  - pinv_created       → office team (admins + month_end positions)
  //  - request submit     → admins + supervisors
  //  - request decision   → all active staff
  const { data: staffRows } = await pushAdmin.from('staff').select('email, is_admin, position').is('archived_at', null);
  const { data: paRows } = await pushAdmin.from('position_access').select('position').eq('feature', 'month_end').eq('allowed', true);
  const officePositions = new Set((paRows ?? []).map((r) => String((r as { position: string }).position)));
  const adminEmails = new Set<string>();
  const officeEmails = new Set<string>();      // Owner + Manager + Office (pinv_created audience)
  const supervisorEmails = new Set<string>();  // position = 'Supervisor'
  const allStaffEmails = new Set<string>();     // every active staff (decision audience)
  for (const r of (staffRows ?? []) as { email: string | null; is_admin: boolean | null; position: string | null }[]) {
    const e = String(r.email ?? '').toLowerCase();
    if (!e) continue;
    allStaffEmails.add(e);
    if (r.is_admin) { adminEmails.add(e); officeEmails.add(e); }
    else if (r.position && officePositions.has(r.position)) officeEmails.add(e);
    if (r.position === 'Supervisor') supervisorEmails.add(e);
  }
  const reqEmails = new Set<string>([...adminEmails, ...supervisorEmails]); // owner + supervisors (deduped)

  const { data: allSubs } = await pushAdmin.from('push_subscriptions').select('endpoint, p256dh, auth, email');
  type Sub = import('@/lib/pushServer').SubRow & { email: string };
  const subsFor = (emails: Set<string>) => ((allSubs ?? []) as Sub[]).filter((x) => emails.has(String(x.email).toLowerCase()));
  const adminSubs = subsFor(adminEmails);
  const officeSubs = subsFor(officeEmails);
  const reqSubs = subsFor(reqEmails);
  const allStaffSubs = subsFor(allStaffEmails);

  if (allStaffSubs.length === 0) return NextResponse.json({ sent: 0, items: items.length, devices: 0 });

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
    // Pick the audience + the mute key for this item type.
    let pool: Sub[];
    let muteType = it.type;
    if (it.type === 'pinv_created') pool = officeSubs;
    else if (RESULT_TYPES.has(it.type)) { pool = allStaffSubs; muteType = 'request_result'; }
    else if (SUBMIT_TYPES.has(it.type)) pool = reqSubs;
    else pool = adminSubs;

    const targetSubs = pool.filter((sub) => notMuted(sub, muteType));
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

  return NextResponse.json({
    sent,
    items: items.length,
    adminDevices: adminSubs.length,
    officeDevices: officeSubs.length,
    supervisorAudience: reqSubs.length,
    allStaffDevices: allStaffSubs.length,
    pruned: dead.size,
  });
}
