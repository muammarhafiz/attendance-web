// src/components/NavBar.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type NavItem = { href: string; label: string; match?: string; badge?: number; icon: IconName };
type NavGroup = { label: string; items: NavItem[] };
type NotifItem = { type: string; id: string; who: string; detail: string; when: string; href: string };
const NOTIF_ICON: Record<string, string> = { offday: '🌴', halfday: '🕧', advance: '💵', mc: '📄', po: '📦', pinv: '📥', pinv_created: '✅', not_checkin: '⏰', stuckcar: '🚗', debt: '🧾', lowstock: '📉' };
const NOTIF_LABEL: Record<string, string> = { offday: 'off-day request', halfday: 'half-day request', advance: 'advance request', mc: 'MC', po: 'purchase order', pinv: 'purchase invoice', pinv_created: 'created in Niagawan ✓', not_checkin: 'not checked in', stuckcar: 'in shop > 3 days', debt: 'newly overdue', lowstock: 'to restock' };
// Request types the owner can approve/reject right in the bell (each has approve_*/reject_* RPCs).
const ACTIONABLE = new Set(['offday', 'halfday', 'advance', 'mc']);
function relTime(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Monochrome line icons (currentColor) — one per nav item, keyed by IconName.
type IconName = 'dashboard' | 'wrench' | 'sales' | 'box' | 'cart' | 'bars' | 'bank' | 'clock' | 'calendar' | 'users' | 'wallet' | 'office' | 'settings';
function NavIcon({ name }: { name: IconName }) {
  const p: Record<IconName, React.ReactNode> = {
    dashboard: (<><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></>),
    wrench: (<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />),
    sales: (<><path d="M22 7 13.5 15.5 8.5 10.5 2 17" /><path d="M16 7h6v6" /></>),
    box: (<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>),
    cart: (<><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h2l2.4 12.4a1.5 1.5 0 0 0 1.5 1.2h9.2a1.5 1.5 0 0 0 1.5-1.2L21 7H5.2" /></>),
    bars: (<><path d="M4 20V4M4 20h16" /><rect x="7" y="12" width="3" height="5" /><rect x="12" y="8" width="3" height="9" /><rect x="17" y="5" width="3" height="12" /></>),
    bank: (<path d="M3 21h18M4 21V10l8-5 8 5v11M9 21v-6h6v6" />),
    clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
    calendar: (<><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17" /><path d="M8 2.5v4M16 2.5v4" /></>),
    users: (<><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="10" cy="7.5" r="3.5" /><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.7-3.4" /><path d="M15 4.1a3.5 3.5 0 0 1 0 6.8" /></>),
    wallet: (<><rect x="2.5" y="6" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /><path d="M16 15h2" /></>),
    office: (<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />),
    settings: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.5 1.5 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.5 1.5 0 0 0-2.5 1V21a2 2 0 1 1-4 0v-.1a1.5 1.5 0 0 0-2.5-1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.5 1.5 0 0 0-1-2.5H3a2 2 0 1 1 0-4h.1a1.5 1.5 0 0 0 1-2.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.5 1.5 0 0 0 1.7.3H9a1.5 1.5 0 0 0 1-1.4V3a2 2 0 1 1 4 0v.1a1.5 1.5 0 0 0 2.5 1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.5 1.5 0 0 0 1 2.5H21a2 2 0 1 1 0 4h-.1a1.5 1.5 0 0 0-1.4 1Z" /></>),
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">{p[name]}</svg>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [canBoard, setCanBoard] = useState<boolean>(false); // can open the Workshop board
  const [access, setAccess] = useState<Record<string, boolean>>({}); // per-feature flags from my_access()
  const [counts, setCounts] = useState<{ mc: number; offday: number; halfday: number; advance: number; po: number; pinv: number; pinv_created: number }>({ mc: 0, offday: 0, halfday: 0, advance: 0, po: 0, pinv: 0, pinv_created: 0 });
  const [items, setItems] = useState<NotifItem[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string>('');
  const [open, setOpen] = useState(false);
  useEffect(() => { setSeenAt(localStorage.getItem('notif_seen_at') || ''); }, []);

  useEffect(() => {
    let unsub: { unsubscribe: () => void } | null = null;
    const readAuthAndRole = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userEmail = userData.user?.email ?? null;
      setEmail(userEmail);
      if (userEmail) {
        const { data } = await supabase.rpc('my_access');
        const a = (data ?? {}) as Record<string, boolean>;
        setAccess(a); setCanBoard(!!a.workshop);
      } else { setCanBoard(false); setAccess({}); }
    };
    readAuthAndRole();
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      const userEmail = session?.user?.email ?? null;
      setEmail(userEmail);
      if (userEmail) {
        supabase.rpc('my_access').then(({ data }) => {
          const a = (data ?? {}) as Record<string, boolean>;
          setAccess(a); setCanBoard(!!a.workshop);
        });
      } else { setCanBoard(false); setAccess({}); }
    });
    unsub = data?.subscription ?? null;
    return () => unsub?.unsubscribe();
  }, []);

  // Owner sees the full feed; Office/Manager (month_end) see ONLY the "PI created in Niagawan" items.
  const canBell = !!access.owner || !!access.month_end;

  const reloadFeed = useCallback(async () => {
    if (!canBell) { setCounts({ mc: 0, offday: 0, halfday: 0, advance: 0, po: 0, pinv: 0, pinv_created: 0 }); setItems([]); return; }
    // Don't hit the DB from a hidden/backgrounded tab; we refresh on focus (listeners below).
    if (typeof document !== 'undefined' && document.hidden) return;
    const { data } = await supabase.rpc('notification_feed'); // one round-trip: counts + items
    const d = (data ?? {}) as { counts?: { mc?: number; offday?: number; halfday?: number; advance?: number; po?: number; pinv?: number; pinv_created?: number }; items?: NotifItem[] };
    const c = d.counts ?? {};
    setCounts({ mc: c.mc ?? 0, offday: c.offday ?? 0, halfday: c.halfday ?? 0, advance: c.advance ?? 0, po: c.po ?? 0, pinv: c.pinv ?? 0, pinv_created: c.pinv_created ?? 0 });
    setItems(Array.isArray(d.items) ? (d.items as NotifItem[]) : []);
  }, [canBell]);

  useEffect(() => {
    if (!canBell) { setCounts({ mc: 0, offday: 0, halfday: 0, advance: 0, po: 0, pinv: 0, pinv_created: 0 }); setItems([]); return; }
    reloadFeed();
    const id = setInterval(reloadFeed, 60000);
    const onVisible = () => { if (typeof document === 'undefined' || !document.hidden) reloadFeed(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [canBell, reloadFeed]);

  // Approve / reject a staff request right from the bell (same RPCs the pages use).
  const act = useCallback(async (item: NotifItem, action: 'approve' | 'reject') => {
    let params: Record<string, unknown>;
    if (item.type === 'mc') {
      if (action === 'reject' && !window.confirm('Reject this MC?')) return;
      params = { p_id: item.id };
    } else if (action === 'reject') {
      const reason = window.prompt('Reason for rejecting (optional):', '');
      if (reason === null) return; // cancelled
      params = { p_id: item.id, p_note: reason };
    } else {
      params = { p_id: item.id, p_note: null };
    }
    setActing(item.id);
    const { error } = await supabase.rpc(`${action}_${item.type}`, params);
    setActing(null);
    if (error) { window.alert(error.message); return; }
    setItems((prev) => prev.filter((x) => !(x.type === item.type && String(x.id) === String(item.id))));
    reloadFeed();
  }, [reloadFeed]);

  // Dismiss a bell item / clear all. Keyed by type|id|when (matches the push key), stored per-user so a
  // dismissed alert stays gone until its situation changes (then it re-appears).
  const keyOf = (i: NotifItem) => `${i.type}|${i.id}|${i.when}`;
  const dismiss = useCallback(async (i: NotifItem) => {
    setItems((prev) => prev.filter((x) => keyOf(x) !== keyOf(i)));
    await supabase.rpc('dismiss_notifications', { p_keys: [keyOf(i)] });
  }, []);
  const clearAll = useCallback(async () => {
    const keys = items.map(keyOf);
    setItems([]);
    if (keys.length) await supabase.rpc('dismiss_notifications', { p_keys: keys });
  }, [items]);

  // Close the mobile drawer / notifications whenever the route changes.
  useEffect(() => { setOpen(false); setBellOpen(false); }, [pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  const openBell = () => {
    setBellOpen((v) => {
      if (!v) { const now = new Date().toISOString(); setSeenAt(now); try { localStorage.setItem('notif_seen_at', now); } catch {} }
      return !v;
    });
  };
  const goTo = (href: string) => { setBellOpen(false); router.push(href); };
  const unseen = items.filter((i) => !seenAt || i.when > seenAt).length;
  const pendingTotal = counts.mc + counts.offday + counts.halfday + counts.advance + counts.po + counts.pinv + counts.pinv_created;

  const isActive = useMemo(
    () => (item: NavItem) => {
      const base = item.match ?? item.href;
      return pathname === base || pathname?.startsWith(base + '/') || pathname === base + '/';
    },
    [pathname]
  );

  // Grouped navigation. Each item shows only if the signed-in person's position grants that feature —
  // same gates as before, just reorganised into a sidebar. Empty groups are dropped.
  const navGroups: NavGroup[] = useMemo(() => {
    const reqBadge = counts.mc + counts.offday + counts.halfday + counts.advance;
    const groups: NavGroup[] = [
      { label: 'Overview', items: [
        ...(access.owner ? [{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard' } as NavItem] : []),
      ] },
      { label: 'Shop', items: [
        ...(canBoard ? [{ href: '/workshop', label: 'Workshop', icon: 'wrench' } as NavItem] : []),
        ...(access.niagawan ? [
          { href: '/niagawan/sales', match: '/niagawan/sales', label: 'Sales', icon: 'sales' } as NavItem,
          { href: '/niagawan/inventory-v4', match: '/niagawan/inventory', label: 'Inventory', icon: 'box', badge: counts.po } as NavItem,
          { href: '/niagawan/purchase', match: '/niagawan/purchase', label: 'Purchase', icon: 'cart', badge: counts.pinv } as NavItem,
        ] : []),
      ] },
      { label: 'Finance', items: [
        ...((access.niagawan || access.pnl) ? [{ href: '/niagawan/pnl', match: '/niagawan/pnl', label: 'P&L', icon: 'bars' } as NavItem] : []),
        ...(access.owner ? [{ href: '/bank-recon', label: 'Bank', icon: 'bank' } as NavItem] : []),
      ] },
      { label: 'People', items: [
        // Owners' Check-in points at /checkin so it isn't bounced to the dashboard like "/".
        { href: access.owner ? '/checkin' : '/', match: access.owner ? '/checkin' : undefined, label: 'Check-in', icon: 'clock' } as NavItem,
        ...(access.attendance ? [{ href: '/attendance/checkin', match: '/attendance', label: 'Attendance', icon: 'calendar', badge: reqBadge } as NavItem] : []),
        ...(access.employees ? [{ href: '/employees', label: 'Employees', icon: 'users' } as NavItem] : []),
        ...(access.payroll ? [{ href: '/payroll/v3', match: '/payroll', label: 'Payroll', icon: 'wallet' } as NavItem] : []),
      ] },
      { label: 'Office', items: [
        ...(access.month_end ? [{ href: '/office', match: '/office', label: 'Office', icon: 'office' } as NavItem] : []),
      ] },
      { label: 'System', items: [
        ...((access.access_admin || access.owner || access.month_end) ? [{ href: '/settings', label: 'Settings', icon: 'settings' } as NavItem] : []),
      ] },
    ];
    return groups.filter((g) => g.items.length > 0);
  }, [access, canBoard, counts]);

  // Sidebar row — active gets the brand pill; the rest are quiet slate.
  const rowClass = (item: NavItem) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive(item) ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  const SideBadge = ({ n }: { n?: number }) =>
    n && n > 0 ? (
      <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-semibold leading-4 text-white">{n}</span>
    ) : null;

  // The bell button (same markup for the mobile top bar and the desktop sidebar).
  const bellButton = (
    <button onClick={openBell} aria-label="Notifications" className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      {unseen > 0 && <span className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white">{unseen}</span>}
    </button>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="no-print fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
          aria-expanded={open}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          {canBell && pendingTotal > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500" />}
        </button>
        <Link href="/" prefetch={false} className="flex min-w-0 items-center gap-2" aria-label="ZORDAQ Auto Service — Home">
          <Image src="/zordaq-auto.png" alt="ZORDAQ Auto Service" width={717} height={1174} priority className="h-8 w-auto" />
          <span className="truncate text-sm font-extrabold tracking-tight text-slate-900">Zordaq Auto Services</span>
        </Link>
        {email && canBell && <div className="ml-auto">{bellButton}</div>}
      </header>

      {/* Backdrop for the mobile drawer */}
      {open && <button className="no-print fixed inset-0 z-40 bg-slate-900/20 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)} />}

      {/* Sidebar — fixed on desktop, slide-in drawer on mobile */}
      <aside
        className={`no-print fixed left-0 top-0 z-50 flex h-screen w-64 max-w-[85vw] flex-col border-r border-slate-200 bg-white transition-transform lg:z-30 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Brand + desktop bell */}
        <div className="flex items-center gap-2 px-4 py-3">
          <Link href="/" prefetch={false} className="flex min-w-0 items-center gap-2" aria-label="ZORDAQ Auto Service — Home" onClick={() => setOpen(false)}>
            <Image src="/zordaq-auto.png" alt="ZORDAQ Auto Service" width={717} height={1174} priority className="h-9 w-auto" />
            <span className="truncate text-sm font-extrabold tracking-tight text-slate-900">Zordaq Auto Services</span>
          </Link>
          {email && canBell && <div className="ml-auto hidden lg:block">{bellButton}</div>}
        </div>

        {/* Grouped links */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-1">
              <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map((l) => (
                  <Link key={l.href} href={l.href} prefetch={false} className={rowClass(l)} onClick={() => setOpen(false)}>
                    <NavIcon name={l.icon} />
                    <span className="truncate">{l.label}</span>
                    <SideBadge n={l.badge} />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer — account */}
        <div className="border-t border-slate-200 p-3">
          {email ? (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={email}>{email}</span>
              <button onClick={handleSignOut} className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200">Sign out</button>
            </div>
          ) : (
            <Link href="/login" prefetch={false} className="block rounded-md bg-brand-700 px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand-800">Sign in</Link>
          )}
        </div>
      </aside>

      {/* Notifications dropdown — anchored under the top bar (mobile) / beside the sidebar (desktop) */}
      {email && canBell && bellOpen && (
        <>
          <button className="no-print fixed inset-0 z-40 cursor-default" aria-label="Close notifications" onClick={() => setBellOpen(false)} />
          <div className="no-print fixed right-3 top-16 z-50 w-80 max-w-[88vw] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg lg:left-[268px] lg:right-auto lg:top-14">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <span className="text-sm font-semibold text-slate-700">Notifications</span>
              {items.length > 0 && <button onClick={clearAll} className="text-xs font-medium text-slate-400 hover:text-slate-700">Clear all</button>}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-slate-400">Nothing pending</div>
              ) : (
                items.map((i) => {
                  const canAct = ACTIONABLE.has(i.type);
                  return (
                    <div key={i.type + i.id} className="border-b border-slate-50 px-3 py-2">
                      <div className="flex items-start gap-2">
                        <button onClick={() => goTo(i.href)} className="flex min-w-0 flex-1 items-start gap-2 text-left hover:opacity-80">
                          <span className="mt-0.5 text-base leading-none">{NOTIF_ICON[i.type] ?? '🔔'}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-slate-800"><span className="font-medium">{i.who}</span> · {NOTIF_LABEL[i.type] ?? i.type}</span>
                            <span className="block truncate text-xs text-slate-500">{i.detail} · {relTime(i.when)}</span>
                          </span>
                        </button>
                        <button onClick={() => dismiss(i)} aria-label="Dismiss" className="shrink-0 leading-none text-slate-300 hover:text-slate-600">✕</button>
                      </div>
                      {canAct && (
                        <div className="mt-1.5 flex gap-2 pl-6">
                          <button onClick={() => act(i, 'approve')} disabled={acting === i.id} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">✓ Approve</button>
                          <button onClick={() => act(i, 'reject')} disabled={acting === i.id} className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50">✗ Reject</button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
