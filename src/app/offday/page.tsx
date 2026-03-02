'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Staff = { name: string; email: string; is_admin: boolean; archived_at?: string | null };

type Status = '' | 'ABSENT' | 'MC' | 'OFFDAY';

type Row = {
  staff_email: string;
  day: string; // YYYY-MM-DD
  status: string;
  note: string | null;
};

const ALL = '__ALL__';

function klTodayISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  return d.toISOString().slice(0, 10);
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseISODate(s: string) {
  // treat as local date (safe for YYYY-MM-DD)
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function eachDateInclusive(fromISO: string, toISO: string): string[] {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISO);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return [];
  if (a.getTime() > b.getTime()) return [];
  const out: string[] = [];
  const cur = new Date(a);
  // Hard safety: max 60 days to prevent accidental huge runs
  for (let i = 0; i < 60; i++) {
    out.push(toISODate(cur));
    if (toISODate(cur) === toISO) break;
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export default function OffdayPage() {
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const staffMap = useMemo(() => new Map(staff.map((s) => [s.email.toLowerCase(), s])), [staff]);

  // Range inputs
  const today = klTodayISO();
  const [fromDay, setFromDay] = useState<string>(today);
  const [toDay, setToDay] = useState<string>(today);

  // Staff selector + status
  const [selected, setSelected] = useState<string>(ALL); // default all staff (most common for public holiday)
  const [status, setStatus] = useState<Status>('OFFDAY');
  const [note, setNote] = useState<string>('');

  // Month viewer (existing overrides)
  const [year, setYear] = useState<number>(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState<number>(() => Number(today.slice(5, 7)));

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');

  // Admin gate
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email ?? null;

      if (!mounted) return;

      if (!email) {
        router.replace('/login');
        return;
      }

      // Load active staff list (admin can still apply to ALL)
      const sRes = await supabase
        .from('staff')
        .select('name,email,is_admin,archived_at')
        .order('name', { ascending: true });

      if (sRes.error) {
        setErr(sRes.error.message);
        return;
      }

      const list = (sRes.data ?? []) as Staff[];
      setStaff(list);

      const me = list.find((x) => x.email === email);
      const adminOk = !!me?.is_admin;

      setIsAdmin(adminOk);
      if (!adminOk) {
        router.replace('/');
        return;
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  // Load month rows
  const loadMonth = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setErr('');

    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const { data, error } = await supabase
      .from('day_status')
      .select('staff_email, day, status, note')
      .gte('day', start)
      .lt('day', end)
      .order('day', { ascending: true })
      .order('staff_email', { ascending: true });

    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [isAdmin, month, year]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  const saveRange = async () => {
    if (!isAdmin) return;
    setErr('');

    if (!fromDay || !toDay) {
      alert('Please select From and To dates.');
      return;
    }

    const days = eachDateInclusive(fromDay, toDay);
    if (days.length === 0) {
      alert('Invalid date range.');
      return;
    }
    if (days.length >= 60) {
      alert('Date range too large. Please keep it under 60 days.');
      return;
    }

    if (!status) {
      alert('Please select status.');
      return;
    }

    setWorking(true);
    try {
      if (selected === ALL) {
        // Apply to all staff, per-day
        for (const d of days) {
          const { error } = await supabase.rpc('set_day_status_all', {
            p_day: d,
            p_status: status,
            p_note: note || null,
          });
          if (error) throw error;
        }
        await loadMonth();
        alert(`Saved for ALL staff (${days.length} day(s)).`);
        return;
      }

      // Apply to one staff, per-day
      for (const d of days) {
        const { error } = await supabase.rpc('set_day_status', {
          p_email: selected,
          p_day: d,
          p_status: status,
          p_note: note || null,
        });
        if (error) throw error;
      }

      await loadMonth();
      alert(`Saved for ${selected} (${days.length} day(s)).`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setWorking(false);
    }
  };

  const clearRange = async () => {
    if (!isAdmin) return;
    setErr('');

    if (!fromDay || !toDay) {
      alert('Please select From and To dates.');
      return;
    }

    const days = eachDateInclusive(fromDay, toDay);
    if (days.length === 0) {
      alert('Invalid date range.');
      return;
    }
    if (days.length >= 60) {
      alert('Date range too large. Please keep it under 60 days.');
      return;
    }

    setWorking(true);
    try {
      if (selected === ALL) {
        for (const d of days) {
          const { error } = await supabase.rpc('clear_day_status_all', { p_day: d });
          if (error) throw error;
        }
        await loadMonth();
        alert(`Cleared for ALL staff (${days.length} day(s)).`);
        return;
      }

      for (const d of days) {
        const { error } = await supabase.rpc('clear_day_status', {
          p_email: selected,
          p_day: d,
        });
        if (error) throw error;
      }

      await loadMonth();
      alert(`Cleared for ${selected} (${days.length} day(s)).`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setWorking(false);
    }
  };

  // Simple UI styles (iPad friendly)
  const input = 'w-full rounded border px-3 py-2';
  const btn =
    'rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed';

  if (!isAdmin) return <main className="mx-auto max-w-4xl p-6">Loading…</main>;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Offday / MC</h1>

      {err && <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

      {/* Controls */}
      <div className="mb-4 rounded border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <div className="mb-1 text-xs text-gray-600">From</div>
            <input className={input} type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-600">To</div>
            <input className={input} type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-gray-600">Staff</div>
            <select className={input} value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value={ALL}>✅ All staff</option>
              {staff
                .filter((s) => !s.archived_at)
                .map((s) => (
                  <option key={s.email} value={s.email}>
                    {s.name} ({s.email})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <div className="mb-1 text-xs text-gray-600">Status</div>
            <select className={input} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              <option value="">Pick…</option>
              <option value="OFFDAY">OFFDAY</option>
              <option value="MC">MC</option>
              <option value="ABSENT">ABSENT</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <div className="mb-1 text-xs text-gray-600">Note (optional)</div>
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Chinese New Year" />
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button className={btn} disabled={working} onClick={saveRange}>
            {working ? 'Working…' : 'Save'}
          </button>
          <button className={btn} disabled={working} onClick={clearRange}>
            {working ? 'Working…' : 'Clear'}
          </button>
        </div>

        <div className="mt-2 text-xs text-gray-500">
          Tip: Use <b>All staff</b> + <b>OFFDAY</b> for public holidays. Range is limited to 60 days for safety.
        </div>
      </div>

      {/* Month viewer */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <div className="mb-1 text-xs text-gray-600">Year</div>
          <input className={input} type="number" value={year} onChange={(e) => setYear(Number(e.target.value || 0))} />
        </div>
        <div>
          <div className="mb-1 text-xs text-gray-600">Month</div>
          <input className={input} type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value || 1))} />
        </div>
        <button className={btn} onClick={loadMonth} disabled={loading || working}>
          {loading ? 'Loading…' : 'Reload month'}
        </button>
      </div>

      {/* List */}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-[900px] w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="border-b px-3 py-2">Day</th>
              <th className="border-b px-3 py-2">Staff</th>
              <th className="border-b px-3 py-2">Email</th>
              <th className="border-b px-3 py-2">Status</th>
              <th className="border-b px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                  No day status records for this month.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const s = staffMap.get((r.staff_email || '').toLowerCase());
                return (
                  <tr key={`${r.day}-${r.staff_email}`} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2">{r.day}</td>
                    <td className="px-3 py-2">{s?.name ?? '—'}</td>
                    <td className="px-3 py-2">{r.staff_email}</td>
                    <td className="px-3 py-2 font-medium">{r.status}</td>
                    <td className="px-3 py-2">{r.note ?? '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}