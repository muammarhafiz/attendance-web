// src/components/NavBar.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type NavItem = { href: string; label: string; match?: string; badge?: number };
type NotifItem = { type: string; id: string; who: string; detail: string; when: string; href: string };
const NOTIF_ICON: Record<string, string> = { offday: '🌴', halfday: '🕧', advance: '💵', mc: '📄', po: '📦' };
const NOTIF_LABEL: Record<string, string> = { offday: 'off-day request', halfday: 'half-day request', advance: 'advance request', mc: 'MC', po: 'purchase order' };
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
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [canBoard, setCanBoard] = useState<boolean>(false); // supervisor or admin -> sees Workshop
  const [counts, setCounts] = useState<{ mc: number; offday: number; halfday: number; advance: number; po: number }>({ mc: 0, offday: 0, halfday: 0, advance: 0, po: 0 });
  const [items, setItems] = useState<NotifItem[]>([]);
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
        const { data, error } = await supabase.rpc('is_admin');
        setIsAdmin(Boolean(data) && !error);
        const { data: bw } = await supabase.rpc('can_access', { p_feature: 'workshop' });
        setCanBoard(bw === true);
      } else { setIsAdmin(false); setCanBoard(false); }
    };
    readAuthAndRole();
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      const userEmail = session?.user?.email ?? null;
      setEmail(userEmail);
      if (userEmail) {
        supabase.rpc('is_admin').then(({ data, error }) => setIsAdmin(Boolean(data) && !error));
        supabase.rpc('can_access', { p_feature: 'workshop' }).then(({ data }) => setCanBoard(data === true));
      } else { setIsAdmin(false); setCanBoard(false); }
    });
    unsub = data?.subscription ?? null;
    return () => unsub?.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAdmin) { setCounts({ mc: 0, offday: 0, halfday: 0, advance: 0, po: 0 }); setItems([]); return; }
    let active = true;
    const load = async () => {
      // Don't poll a hidden/backgrounded tab — a left-open admin tab would otherwise hit the DB
      // every 60s forever. We refresh the moment the tab is focused again (listeners below).
      if (typeof document !== 'undefined' && document.hidden) return;
      const { data } = await supabase.rpc('notification_feed'); // one round-trip: counts + items (incl. PO)
      if (!active) return;
      const d = (data ?? {}) as { counts?: { mc?: number; offday?: number; halfday?: number; advance?: number; po?: number }; items?: NotifItem[] };
      const c = d.counts ?? {};
      setCounts({ mc: c.mc ?? 0, offday: c.offday ?? 0, halfday: c.halfday ?? 0, advance: c.advance ?? 0, po: c.po ?? 0 });
      setItems(Array.isArray(d.items) ? (d.items as NotifItem[]) : []);
    };
    load();
    const id = setInterval(load, 60000);
    const onVisible = () => { if (typeof document === 'undefined' || !document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { active = false; clearInterval(id); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [isAdmin]);

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
  const adminLinks: NavItem[] = [
    { href: '/attendance/checkin', match: '/attendance', label: 'Attendance', badge: counts.mc + counts.offday + counts.halfday + counts.advance },
    { href: '/niagawan/sales', match: '/niagawan', label: 'Niagawan', badge: counts.po },
    { href: '/employees', label: 'Employees' },
    // Records is a sub-tab inside the Payroll page now (PayrollTabs), not a navbar item.
    { href: '/payroll/v3', match: '/payroll', label: 'Payroll' },
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

  const allAdmin = isAdmin ? adminLinks : [];

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
                        items.map((i) => (
                          <button key={i.type + i.id} onClick={() => goTo(i.href)} className="flex w-full items-start gap-2 border-b border-slate-50 px-3 py-2 text-left hover:bg-slate-50">
                            <span className="mt-0.5 text-base leading-none">{NOTIF_ICON[i.type] ?? '🔔'}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-slate-800"><span className="font-medium">{i.who}</span> · {NOTIF_LABEL[i.type] ?? i.type}</span>
                              <span className="block truncate text-xs text-slate-500">{i.detail} · {relTime(i.when)}</span>
                            </span>
                          </button>
                        ))
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
            {!open && isAdmin && (counts.mc + counts.offday + counts.halfday + counts.advance + counts.po) > 0 && (
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
            {isAdmin && (
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
