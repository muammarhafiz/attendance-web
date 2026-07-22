// src/components/NavBar.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type NavItem = { href: string; label: string; match?: string; badge?: number };
type NotifItem = { type: string; id: string; who: string; detail: string; when: string; href: string };
const NOTIF_ICON: Record<string, string> = { offday: '🌴', halfday: '🕧', advance: '💵', mc: '📄', po: '📦', pinv: '📥', stuckcar: '🚗', debt: '🧾', lowstock: '📉' };
const NOTIF_LABEL: Record<string, string> = { offday: 'off-day request', halfday: 'half-day request', advance: 'advance request', mc: 'MC', po: 'purchase order', pinv: 'purchase invoice', stuckcar: 'in shop > 3 days', debt: 'newly overdue', lowstock: 'to restock' };
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

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false); // owner (full access) — gates the bell
  const [canBoard, setCanBoard] = useState<boolean>(false); // can open the Workshop board
  const [access, setAccess] = useState<Record<string, boolean>>({}); // per-feature flags from my_access()
  const [counts, setCounts] = useState<{ mc: number; offday: number; halfday: number; advance: number; po: number; pinv: number }>({ mc: 0, offday: 0, halfday: 0, advance: 0, po: 0, pinv: 0 });
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
        setAccess(a); setIsAdmin(!!a.owner); setCanBoard(!!a.workshop);
      } else { setIsAdmin(false); setCanBoard(false); setAccess({}); }
    };
    readAuthAndRole();
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      const userEmail = session?.user?.email ?? null;
      setEmail(userEmail);
      if (userEmail) {
        supabase.rpc('my_access').then(({ data }) => {
          const a = (data ?? {}) as Record<string, boolean>;
          setAccess(a); setIsAdmin(!!a.owner); setCanBoard(!!a.workshop);
        });
      } else { setIsAdmin(false); setCanBoard(false); setAccess({}); }
    });
    unsub = data?.subscription ?? null;
    return () => unsub?.unsubscribe();
  }, []);

  const reloadFeed = useCallback(async () => {
    if (!isAdmin) { setCounts({ mc: 0, offday: 0, halfday: 0, advance: 0, po: 0, pinv: 0 }); setItems([]); return; }
    // Don't hit the DB from a hidden/backgrounded tab; we refresh on focus (listeners below).
    if (typeof document !== 'undefined' && document.hidden) return;
    const { data } = await supabase.rpc('notification_feed'); // one round-trip: counts + items
    const d = (data ?? {}) as { counts?: { mc?: number; offday?: number; halfday?: number; advance?: number; po?: number; pinv?: number }; items?: NotifItem[] };
    const c = d.counts ?? {};
    setCounts({ mc: c.mc ?? 0, offday: c.offday ?? 0, halfday: c.halfday ?? 0, advance: c.advance ?? 0, po: c.po ?? 0, pinv: c.pinv ?? 0 });
    setItems(Array.isArray(d.items) ? (d.items as NotifItem[]) : []);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) { setCounts({ mc: 0, offday: 0, halfday: 0, advance: 0, po: 0, pinv: 0 }); setItems([]); return; }
    reloadFeed();
    const id = setInterval(reloadFeed, 60000);
    const onVisible = () => { if (typeof document === 'undefined' || !document.hidden) reloadFeed(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [isAdmin, reloadFeed]);

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

  const isActive = useMemo(
    () => (item: NavItem) => {
      const base = item.match ?? item.href;
      return pathname === base || pathname?.startsWith(base + '/') || pathname === base + '/';
    },
    [pathname]
  );

  const mainLinks: NavItem[] = [
    { href: '/', label: 'Check-in' },
    // The job board — supervisors and admins only.
    ...(canBoard ? [{ href: '/workshop', label: 'Workshop' } as NavItem] : []),
  ];
  // Each admin link shows only if the signed-in person's position grants that feature.
  const adminLinks: NavItem[] = [
    ...(access.attendance ? [{ href: '/attendance/checkin', match: '/attendance', label: 'Attendance', badge: counts.mc + counts.offday + counts.halfday + counts.advance } as NavItem] : []),
    ...((access.niagawan || access.pnl) ? [{ href: '/niagawan/sales', match: '/niagawan', label: 'Niagawan', badge: counts.po + counts.pinv } as NavItem] : []),
    ...(access.employees ? [{ href: '/employees', label: 'Employees' } as NavItem] : []),
    // Records is a sub-tab inside the Payroll page now (PayrollTabs), not a navbar item.
    ...(access.payroll ? [{ href: '/payroll/v3', match: '/payroll', label: 'Payroll' } as NavItem] : []),
    ...((access.access_admin || access.owner) ? [{ href: '/settings', label: 'Settings' } as NavItem] : []),
  ];

  const Badge = ({ n }: { n?: number }) =>
    n && n > 0 ? (
      <span className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-semibold leading-4 text-white">{n}</span>
    ) : null;

  // Desktop pill
  const deskClass = (item: NavItem) =>
    `inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition ${
      isActive(item) ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
    }`;

  // Mobile drawer row (large tap target)
  const mobClass = (item: NavItem) =>
    `flex items-center justify-between rounded-lg px-4 py-3 text-base font-medium transition ${
      isActive(item) ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-100 active:bg-slate-100'
    }`;

  const allAdmin = adminLinks; // already filtered per-feature above

  return (
    <nav className="no-print sticky top-0 z-40 w-full border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        {/* Brand */}
        <Link href="/" prefetch={false} className="flex shrink-0 items-center gap-2" aria-label="ZORDAQ Auto Service — Home">
          <Image src="/zordaq-auto.png" alt="ZORDAQ Auto Service" width={717} height={1174} priority className="h-9 w-auto" />
          <span className="text-sm font-extrabold tracking-tight text-slate-900 sm:text-base">Zordaq Auto Services</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden flex-1 flex-wrap items-center gap-1 lg:flex">
          {mainLinks.map((l) => (
            <Link key={l.href} href={l.href} prefetch={false} className={deskClass(l)}>{l.label}<Badge n={l.badge} /></Link>
          ))}
          {allAdmin.map((l) => (
            <Link key={l.href} href={l.href} prefetch={false} className={deskClass(l)}>{l.label}<Badge n={l.badge} /></Link>
          ))}
        </div>

        {/* Right side */}
        <div className="flex shrink-0 items-center gap-2">
          {email && isAdmin && (
            <div className="relative">
              <button onClick={openBell} aria-label="Notifications" className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                {unseen > 0 && <span className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white">{unseen}</span>}
              </button>
              {bellOpen && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" aria-label="Close notifications" onClick={() => setBellOpen(false)} />
                  <div className="absolute right-0 z-50 mt-1 w-80 max-w-[88vw] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                    <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">Notifications</div>
                    <div className="max-h-96 overflow-y-auto">
                      {items.length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm text-slate-400">Nothing pending</div>
                      ) : (
                        items.map((i) => {
                          const canAct = ACTIONABLE.has(i.type);
                          return (
                            <div key={i.type + i.id} className="border-b border-slate-50 px-3 py-2">
                              <button onClick={() => goTo(i.href)} className="flex w-full items-start gap-2 text-left hover:opacity-80">
                                <span className="mt-0.5 text-base leading-none">{NOTIF_ICON[i.type] ?? '🔔'}</span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm text-slate-800"><span className="font-medium">{i.who}</span> · {NOTIF_LABEL[i.type] ?? i.type}</span>
                                  <span className="block truncate text-xs text-slate-500">{i.detail} · {relTime(i.when)}</span>
                                </span>
                              </button>
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
            </div>
          )}
          {email ? (
            <>
              <span className="hidden max-w-[180px] truncate text-sm text-slate-500 xl:inline">{email}</span>
              <button onClick={handleSignOut} className="hidden items-center rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 lg:inline-flex">Sign out</button>
            </>
          ) : (
            <Link href="/login" prefetch={false} className="hidden items-center rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-800 lg:inline-flex">Sign in</Link>
          )}

          {/* Hamburger (mobile) */}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={open}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 lg:hidden"
          >
            {open ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            )}
            {!open && isAdmin && (counts.mc + counts.offday + counts.halfday + counts.advance + counts.po + counts.pinv) > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden">
          <button className="fixed inset-0 top-[57px] z-30 bg-slate-900/20" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="relative z-40 max-h-[calc(100vh-57px)] overflow-y-auto border-t border-slate-200 bg-white px-3 pb-4 pt-2 shadow-lg">
            <div className="space-y-1">
              {mainLinks.map((l) => (
                <Link key={l.href} href={l.href} prefetch={false} className={mobClass(l)}>{l.label}<Badge n={l.badge} /></Link>
              ))}
            </div>
            {adminLinks.length > 0 && (
              <>
                <div className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Admin</div>
                <div className="space-y-1">
                  {adminLinks.map((l) => (
                    <Link key={l.href} href={l.href} prefetch={false} className={mobClass(l)}>{l.label}<Badge n={l.badge} /></Link>
                  ))}
                </div>
              </>
            )}
            <div className="mt-4 border-t border-slate-200 pt-3">
              {email ? (
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-500">{email}</span>
                  <button onClick={handleSignOut} className="shrink-0 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">Sign out</button>
                </div>
              ) : (
                <Link href="/login" prefetch={false} className="block rounded-md bg-brand-700 px-4 py-3 text-center text-base font-semibold text-white hover:bg-brand-800">Sign in</Link>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
