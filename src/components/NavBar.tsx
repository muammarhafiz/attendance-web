// src/components/NavBar.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type NavChild = { href: string; label: string; match?: string; badge?: number };
type NavItem = { href?: string; label: string; match?: string; badge?: number; icon: IconName; children?: NavChild[] };
type NavGroup = { label: string; items: NavItem[] };
type NotifItem = { type: string; id: string; who: string; detail: string; when: string; href: string };
const NOTIF_ICON: Record<string, string> = { offday: '🌴', halfday: '🕧', advance: '💵', mc: '📄', po: '📦', pinv: '📥', pinv_created: '✅', not_checkin: '⏰', stuckcar: '🚗', debt: '🧾', lowstock: '📉', bnpl_payout: '💳', probation_review: '🎓', job_done: '⚙️',
  // staff-facing outcomes (their own request was decided)
  offday_result: '🌴', halfday_result: '🕧', mc_result: '📄', advance_result: '💵',
  // holiday reminders (owner/office/manager)
  holiday_decide: '🗓️', holiday_load: '📅',
  // staff upload reminders
  mc_cert: '📄', doc_needed: '📎' };
const NOTIF_LABEL: Record<string, string> = { offday: 'off-day request', halfday: 'half-day request', advance: 'advance request', mc: 'MC', po: 'purchase order', pinv: 'purchase invoice', pinv_created: 'created in Niagawan ✓', not_checkin: 'not checked in', stuckcar: 'in shop > 3 days', debt: 'newly overdue', lowstock: 'to restock', bnpl_payout: 'new payout', probation_review: 'trial review', job_done: 'finished',
  offday_result: 'off-day request', halfday_result: 'half-day request', mc_result: 'MC', advance_result: 'advance',
  holiday_decide: 'public holiday', holiday_load: 'to load',
  mc_cert: 'to upload', doc_needed: 'to upload' };
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

// Notification-count badge (rose → bad token).
function Badge({ n, className = 'ml-auto' }: { n?: number; className?: string }) {
  if (!n || n <= 0) return null;
  return <span className={`${className} inline-flex min-w-[18px] items-center justify-center rounded-full bg-bad px-1 text-[11px] font-semibold leading-4 text-white`}>{n}</span>;
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
  const [collapsed, setCollapsed] = useState(false); // desktop-only: sidebar hidden to reclaim width
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // which expandable areas are open
  const [salesPending, setSalesPending] = useState(0); // count of not-final sales days (Sales badge)
  const [emergencyNew, setEmergencyNew] = useState(0); // count of new emergency-absence reports (Attendance badge)
  useEffect(() => { setSeenAt(localStorage.getItem('notif_seen_at') || ''); }, []);
  // The <html> class is applied pre-paint by an inline script in layout.tsx (no flash on reload);
  // mirror it into state so the toggle button reflects the current mode.
  useEffect(() => { setCollapsed(document.documentElement.hasAttribute('data-nav-collapsed')); }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      document.documentElement.toggleAttribute('data-nav-collapsed', next);
      try { localStorage.setItem('nav_collapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);
  // Theme: explicit data-theme (set pre-paint from localStorage) wins; otherwise follow the OS.
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') setTheme(explicit);
    else setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((v) => {
      const next = v === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch {}
      return next;
    });
  }, []);
  const toggleArea = useCallback((label: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(label)) n.delete(label); else n.add(label); return n; });
  }, []);

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
  // Any signed-in user gets the bell: approvers see pending approvals, staff see their own decided requests.
  const showBell = !!email;

  const reloadFeed = useCallback(async () => {
    if (!showBell) { setCounts({ mc: 0, offday: 0, halfday: 0, advance: 0, po: 0, pinv: 0, pinv_created: 0 }); setItems([]); return; }
    // Don't hit the DB from a hidden/backgrounded tab; we refresh on focus (listeners below).
    if (typeof document !== 'undefined' && document.hidden) return;
    const { data } = await supabase.rpc('notification_feed'); // one round-trip: counts + items
    const d = (data ?? {}) as { counts?: { mc?: number; offday?: number; halfday?: number; advance?: number; po?: number; pinv?: number; pinv_created?: number }; items?: NotifItem[] };
    const c = d.counts ?? {};
    setCounts({ mc: c.mc ?? 0, offday: c.offday ?? 0, halfday: c.halfday ?? 0, advance: c.advance ?? 0, po: c.po ?? 0, pinv: c.pinv ?? 0, pinv_created: c.pinv_created ?? 0 });
    setItems(Array.isArray(d.items) ? (d.items as NotifItem[]) : []);
  }, [showBell]);

  useEffect(() => {
    if (!showBell) { setCounts({ mc: 0, offday: 0, halfday: 0, advance: 0, po: 0, pinv: 0, pinv_created: 0 }); setItems([]); return; }
    reloadFeed();
    const id = setInterval(reloadFeed, 60000);
    const onVisible = () => { if (typeof document === 'undefined' || !document.hidden) reloadFeed(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [showBell, reloadFeed]);

  // Count of "not final" sales days (unpaid or zero-cost) → badge on the Sales tab. Available to
  // anyone with Niagawan access (independent of the bell); refreshes on focus.
  const loadSalesPending = useCallback(async () => {
    if (!access.niagawan) { setSalesPending(0); return; }
    if (typeof document !== 'undefined' && document.hidden) return;
    const { data } = await supabase.rpc('sales_pending_days_count');
    setSalesPending(Number(data) || 0);
  }, [access.niagawan]);
  useEffect(() => {
    loadSalesPending();
    const onVisible = () => { if (typeof document === 'undefined' || !document.hidden) loadSalesPending(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [loadSalesPending]);

  // Count of NEW emergency-absence reports → badge on the Attendance area. Attendance approvers only.
  const loadEmergencyNew = useCallback(async () => {
    if (!access.attendance) { setEmergencyNew(0); return; }
    if (typeof document !== 'undefined' && document.hidden) return;
    const { count } = await supabase.from('emergency_absences').select('id', { count: 'exact', head: true }).eq('status', 'new');
    setEmergencyNew(count || 0);
  }, [access.attendance]);
  useEffect(() => {
    loadEmergencyNew();
    const onVis = () => { if (typeof document === 'undefined' || !document.hidden) loadEmergencyNew(); };
    window.addEventListener('focus', onVis);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('focus', onVis); document.removeEventListener('visibilitychange', onVis); };
  }, [loadEmergencyNew]);

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

  // True when `base` matches the current path (exact, or a parent of it).
  const pathActive = useCallback((base?: string) => {
    if (!base) return false;
    return pathname === base || (pathname?.startsWith(base + '/') ?? false) || pathname === base + '/';
  }, [pathname]);
  const isActive = useCallback((item: NavItem) => pathActive(item.match ?? item.href), [pathActive]);

  // Grouped navigation. Each item shows only if the signed-in person's position grants that feature.
  // Areas (Niagawan / Attendance / Payroll) hold their sub-tabs as `children`; the rest are leaves.
  const navGroups: NavGroup[] = useMemo(() => {
    const reqBadge = counts.mc + counts.offday + counts.halfday + counts.advance + emergencyNew;
    const niagawanChildren: NavChild[] = access.niagawan
      ? [
          { href: '/niagawan/sales', label: 'Sales', badge: salesPending },
          { href: '/niagawan/cogs', label: 'COGS' },
          { href: '/niagawan/inventory-v4', match: '/niagawan/inventory', label: 'Inventory', badge: counts.po },
          { href: '/niagawan/purchase', match: '/niagawan/purchase', label: 'Purchase Invoice', badge: counts.pinv },
          { href: '/niagawan/kiv', label: 'KIV Invoices' },
          { href: '/niagawan/pnl', label: 'P&L' },
        ]
      : access.pnl
      ? [{ href: '/niagawan/pnl', label: 'P&L' }]
      : [];
    const groups: NavGroup[] = [
      { label: 'Overview', items: [
        ...(access.owner ? [{ label: 'Dashboard', href: '/dashboard', icon: 'dashboard' } as NavItem] : []),
      ] },
      { label: 'Shop', items: [
        ...(canBoard ? [{ label: 'Workshop', href: '/workshop', icon: 'wrench' } as NavItem] : []),
        ...(niagawanChildren.length ? [{ label: 'Niagawan', icon: 'box', badge: counts.po + counts.pinv + salesPending, children: niagawanChildren } as NavItem] : []),
      ] },
      { label: 'Finance', items: [
        ...(access.owner ? [{ label: 'Bank', href: '/bank-recon', icon: 'bank' } as NavItem] : []),
      ] },
      { label: 'People', items: [
        // Owners' Check-in points at /checkin so it isn't bounced to the dashboard like "/".
        { label: 'Check-in', href: access.owner ? '/checkin' : '/', match: access.owner ? '/checkin' : undefined, icon: 'clock' } as NavItem,
        ...(access.attendance ? [{ label: 'Attendance', icon: 'calendar', badge: reqBadge, children: [
          { href: '/attendance/today', label: 'Today' },
          { href: '/attendance/report', label: 'Report' },
          { href: '/attendance/balances', label: 'Leave balances' },
          { href: '/attendance/requests', label: 'Requests', badge: counts.offday + counts.halfday + counts.advance + counts.mc + emergencyNew },
          ...(access.owner ? [
            { href: '/attendance/holidays', label: 'Holidays' },
            { href: '/attendance/preview', label: 'Preview as staff' },
          ] : []),
        ] } as NavItem] : []),
        ...(access.employees ? [{ label: 'Employees', href: '/employees', icon: 'users' } as NavItem] : []),
        ...(access.payroll ? [{ label: 'Payroll', icon: 'wallet', children: [
          { href: '/payroll/v3', match: '/payroll/v3', label: 'Run payroll' },
          { href: '/payroll/records', label: 'Records' },
          { href: '/payroll/settings', label: 'Settings' },
        ] } as NavItem] : []),
      ] },
      { label: 'Office', items: [
        ...(access.month_end ? [{ label: 'Office', href: '/office', match: '/office', icon: 'office' } as NavItem] : []),
      ] },
      { label: 'System', items: [
        ...((access.access_admin || access.owner || access.month_end) ? [{ label: 'Settings', href: '/settings', icon: 'settings' } as NavItem] : []),
      ] },
    ];
    return groups.filter((g) => g.items.length > 0);
  }, [access, canBoard, counts, salesPending, emergencyNew]);

  // Auto-open the area that contains the current route (so you always see where you are).
  useEffect(() => {
    setExpanded((prev) => {
      let changed = false;
      const n = new Set(prev);
      for (const g of navGroups) for (const it of g.items) {
        if (it.children && !n.has(it.label) && it.children.some((c) => pathActive(c.match ?? c.href))) { n.add(it.label); changed = true; }
      }
      return changed ? n : prev;
    });
  }, [navGroups, pathActive]);

  // Leaf row — active gets a soft accent tint; the rest are quiet ink.
  const rowClass = (item: NavItem) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive(item) ? 'bg-accent-weak font-semibold text-accent' : 'text-ink-2 hover:bg-ink/5 hover:text-ink'
    }`;

  // The bell button (same markup for the mobile top bar and the desktop sidebar).
  const bellButton = (
    <button onClick={openBell} aria-label="Notifications" className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-2 hover:bg-ink/5">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      {unseen > 0 && <span className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold leading-4 text-white">{unseen}</span>}
    </button>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="no-print fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-card/90 px-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
          aria-expanded={open}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-2 hover:bg-ink/5"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          {showBell && (pendingTotal > 0 || unseen > 0) && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-bad" />}
        </button>
        <Link href="/" prefetch={false} className="flex min-w-0 items-center gap-2" aria-label="ZORDAQ Auto Service — Home">
          <Image src="/zordaq-auto.png" alt="ZORDAQ Auto Service" width={717} height={1174} priority className="h-8 w-auto" />
          <span className="truncate text-sm font-extrabold tracking-tight text-ink">Zordaq Auto Services</span>
        </Link>
        {email && showBell && <div className="ml-auto">{bellButton}</div>}
      </header>

      {/* Show-sidebar button — desktop only, appears when the sidebar is collapsed */}
      {collapsed && (
        <button onClick={toggleCollapsed} aria-label="Show sidebar" title="Show sidebar"
          className="no-print fixed left-3 top-3 z-50 hidden h-9 w-9 items-center justify-center rounded-md border border-line bg-card/95 text-ink-2 shadow-sm backdrop-blur transition hover:bg-ink/5 lg:inline-flex">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      )}

      {/* Backdrop for the mobile drawer */}
      {open && <button className="no-print fixed inset-0 z-40 bg-black/20 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)} />}

      {/* Sidebar — fixed on desktop, slide-in drawer on mobile */}
      <aside
        className={`app-sidebar no-print fixed left-0 top-0 z-50 flex h-screen w-64 max-w-[85vw] flex-col border-r border-line bg-card transition-transform lg:z-30 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Brand + desktop bell */}
        <div className="flex items-center gap-2 px-4 py-3">
          <Link href="/" prefetch={false} className="flex min-w-0 items-center gap-2" aria-label="ZORDAQ Auto Service — Home" onClick={() => setOpen(false)}>
            <Image src="/zordaq-auto.png" alt="ZORDAQ Auto Service" width={717} height={1174} priority className="h-9 w-auto" />
            <span className="truncate text-sm font-extrabold tracking-tight text-ink">Zordaq Auto Services</span>
          </Link>
          <div className="ml-auto hidden items-center gap-0.5 lg:flex">
            {email && showBell && bellButton}
            <button onClick={toggleCollapsed} aria-label="Hide sidebar" title="Hide sidebar" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-3 transition hover:bg-ink/5 hover:text-ink">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
          </div>
        </div>

        {/* Grouped links */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-1">
              <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  // Leaf link
                  if (!item.children) {
                    return (
                      <Link key={item.label} href={item.href ?? '#'} prefetch={false} className={rowClass(item)} onClick={() => setOpen(false)}>
                        <NavIcon name={item.icon} />
                        <span className="truncate">{item.label}</span>
                        <Badge n={item.badge} />
                      </Link>
                    );
                  }
                  // Expandable area
                  const isOpen = expanded.has(item.label);
                  const areaActive = item.children.some((c) => pathActive(c.match ?? c.href));
                  return (
                    <div key={item.label}>
                      <button
                        onClick={() => toggleArea(item.label)}
                        aria-expanded={isOpen}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${areaActive ? 'text-ink' : 'text-ink-2 hover:bg-ink/5 hover:text-ink'}`}
                      >
                        <NavIcon name={item.icon} />
                        <span className="flex-1 truncate text-left">{item.label}</span>
                        <Badge n={item.badge} className="" />
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-ink-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}><path d="M9 6l6 6-6 6" /></svg>
                      </button>
                      {isOpen && (
                        <div className="mb-1 mt-0.5 space-y-0.5 pl-[30px]">
                          {item.children.map((c) => {
                            const cActive = pathActive(c.match ?? c.href);
                            return (
                              <Link
                                key={c.href}
                                href={c.href}
                                prefetch={false}
                                onClick={() => setOpen(false)}
                                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition ${cActive ? 'bg-accent-weak text-accent' : 'text-ink-2 hover:bg-ink/5 hover:text-ink'}`}
                              >
                                <span className="truncate">{c.label}</span>
                                <Badge n={c.badge} />
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer — theme toggle + account */}
        <div className="border-t border-line p-3">
          <button onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="mb-2 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-ink/5">
            <span className="text-ink-3">
              {theme === 'dark'
                ? (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>)
                : (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>)}
            </span>
            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
          {email ? (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-ink-3" title={email}>{email}</span>
              <button onClick={handleSignOut} className="shrink-0 rounded-md bg-ink/5 px-2.5 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-ink/10">Sign out</button>
            </div>
          ) : (
            <Link href="/login" prefetch={false} className="block rounded-md bg-accent px-3 py-2 text-center text-sm font-semibold text-white transition hover:opacity-90">Sign in</Link>
          )}
        </div>
      </aside>

      {/* Notifications dropdown — anchored under the top bar (mobile) / beside the sidebar (desktop) */}
      {email && showBell && bellOpen && (
        <>
          <button className="no-print fixed inset-0 z-40 cursor-default" aria-label="Close notifications" onClick={() => setBellOpen(false)} />
          <div className="no-print fixed right-3 top-16 z-50 w-80 max-w-[88vw] overflow-hidden rounded-lg border border-line bg-card shadow-lg lg:left-[268px] lg:right-auto lg:top-14">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-sm font-semibold text-ink-2">Notifications</span>
              {items.length > 0 && <button onClick={clearAll} className="text-xs font-medium text-ink-3 hover:text-ink">Clear all</button>}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-ink-3">Nothing pending</div>
              ) : (
                items.map((i) => {
                  const canAct = ACTIONABLE.has(i.type);
                  return (
                    <div key={i.type + i.id} className="border-b border-line px-3 py-2">
                      <div className="flex items-start gap-2">
                        <button onClick={() => goTo(i.href)} className="flex min-w-0 flex-1 items-start gap-2 text-left hover:opacity-80">
                          <span className="mt-0.5 text-base leading-none">{NOTIF_ICON[i.type] ?? '🔔'}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-ink"><span className="font-medium">{i.who}</span> · {NOTIF_LABEL[i.type] ?? i.type}</span>
                            <span className="block truncate text-xs text-ink-3">{i.detail} · {relTime(i.when)}</span>
                          </span>
                        </button>
                        <button onClick={() => dismiss(i)} aria-label="Dismiss" className="shrink-0 leading-none text-ink-3 hover:text-ink">✕</button>
                      </div>
                      {canAct && (
                        <div className="mt-1.5 flex gap-2 pl-6">
                          <button onClick={() => act(i, 'approve')} disabled={acting === i.id} className="rounded-md bg-good px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">✓ Approve</button>
                          <button onClick={() => act(i, 'reject')} disabled={acting === i.id} className="rounded-md border border-line bg-bad-soft px-2.5 py-1 text-xs font-semibold text-bad hover:bg-bad-soft disabled:opacity-50">✗ Reject</button>
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
