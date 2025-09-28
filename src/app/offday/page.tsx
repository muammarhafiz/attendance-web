'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Staff = { name: string; email: string; is_admin: boolean };
type Status = 'ABSENT' | 'MC' | 'OFFDAY' | '';

type Row = {
  staff_email: string;
  day: string;          // YYYY-MM-DD
  status: Exclude<Status, ''>;
  note: string | null;
};

function klTodayISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  return d.toISOString().slice(0, 10);
}

export default function OffdayPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<string>('');
  const [day, setDay] = useState<string>(klTodayISO());
  const [status, setStatus] = useState<Status>('');
  const [note, setNote] = useState<string>('');

  const [month, setMonth] = useState<number>(() => parseInt(klTodayISO().slice(5, 7), 10));
  const [year, setYear] = useState<number>(() => parseInt(klTodayISO().slice(0, 4), 10));

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Auth + admin check
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email ?? null;

      if (!mounted) return;

      if (!email) {
        alert('Please sign in first.');
        router.replace('/login');
        return;
      }

      const { data, error } = await supabase
        .from('staff')
        .select('name, email, is_admin')
        .order('name', { ascending: true });

      if (error) {
        setErr(error.message);
        return;
      }

      const list = (data || []) as Staff[];
      setStaff(list);

      const me = list.find(s => s.email === email);
      const admin = !!me?.is_admin;
      setIsAdmin(admin);

      if (!admin) {
        alert('Only admins can use Offday/MC page.');
        router.replace('/');
        return;
      }

      setSelectedEmail(email);
    })();

    return () => { mounted = false; };
  }, [router]);

  // Month loader (no `id` column)
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
      .select('staff_email, day, status, note') // <-- no id
      .gte('day', start)
      .lt('day', end)
      .order('day', { ascending: true });

    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [isAdmin, month, year]);

  useEffect(() => { loadMonth(); }, [loadMonth]);

  const staffMap = useMemo(() => new Map(staff.map(s => [s.email, s])), [staff]);

  // Actions
  const save = async () => {
    if (!selectedEmail || !day || !status) {
      alert('Pick staff, day and status');
      return;
    }
    setErr('');
    const { error } = await supabase.rpc('set_day_status', {
      p_email: selectedEmail,
      p_day: day,
      p_status: status as Exclude<Status, ''>,
      p_note: note || null,
    });
    if (error) { setErr(error.message); return; }
    setNote('');
    await loadMonth();
    alert('Saved');
  };

  const clear = async () => {
    if (!selectedEmail || !day) {
      alert('Pick staff and day');
      return;
    }
    setErr('');
    const { error } = await supabase.rpc('clear_day_status', {
      p_email: selectedEmail,
      p_day: day,
    });
    if (error) { setErr(error.message); return; }
    await loadMonth();
    alert('Cleared');
  };

  // styles
  const page: React.CSSProperties = { padding: 16, fontFamily: 'system-ui', maxWidth: 920, margin: '0 auto' };
  const grid: React.CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: '1fr', marginBottom: 12 };
  const wide: React.CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3,minmax(0,1fr))', marginBottom: 12 };
  const input: React.CSSProperties = { padding: 10, border: '1px solid #d0d5dd', borderRadius: 8, fontSize: 16, width: '100%' };
  const button: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#f5f7fb', cursor: 'pointer', fontSize: 16 };

  return (
    <main style={page}>
      <h2 style={{ marginBottom: 12 }}>Offday / MC (Admin)</h2>

      {/* Controls */}
      <div style={grid}>
        <select
          value={selectedEmail}
          onChange={(e) => setSelectedEmail(e.currentTarget.value)}
          style={input}
        >
          <option value="">{staff.length ? 'Select staff…' : 'Loading staff…'}</option>
          {staff.map(s => (
            <option key={s.email} value={s.email}>
              {s.name} ({s.email}) {s.is_admin ? '• Admin' : ''}
            </option>
          ))}
        </select>

        <div style={wide}>
          <input type="date" value={day} onChange={(e) => setDay(e.currentTarget.value)} style={input} />
          <select
            value={status}
            onChange={(e) => setStatus(e.currentTarget.value as Status)}
            style={input}
          >
            <option value="">Pick status…</option>
            <option value="ABSENT">Absent</option>
            <option value="MC">MC</option>
            <option value="OFFDAY">Offday</option>
          </select>
          <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.currentTarget.value)} style={input} />
        </div>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
          <button onClick={save} style={button}>Save</button>
          <button onClick={clear} style={button}>Clear</button>
        </div>
      </div>

      {/* Month selector */}
      <div style={wide}>
        <div>
          <div style={{ marginBottom: 4 }}>Year</div>
          <input type="number" value={year} onChange={(e) => setYear(parseInt(e.currentTarget.value || '0', 10))} style={input} />
        </div>
        <div>
          <div style={{ marginBottom: 4 }}>Month</div>
          <input type="number" value={month} onChange={(e) => setMonth(parseInt(e.currentTarget.value || '0', 10))} style={input} />
        </div>
        <div>
          <div style={{ marginBottom: 4, visibility: 'hidden' }}>Reload</div>
          <button onClick={loadMonth} style={button}>Reload</button>
        </div>
      </div>

      {err && <p style={{ color: '#b00020' }}>{err}</p>}
      {loading && <p>Loading…</p>}

      {/* List existing overrides for the month (no id; use composite key) */}
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f7fb' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Day</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Staff</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Email</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td style={{ padding: 8 }} colSpan={5}>No overrides set for this month.</td></tr>
            )}
            {rows.map(r => {
              const s = staffMap.get(r.staff_email);
              return (
                <tr key={`${r.staff_email}-${r.day}`}>
                  <td style={{ padding: 8 }}>{r.day}</td>
                  <td style={{ padding: 8 }}>{s?.name ?? '—'}</td>
                  <td style={{ padding: 8 }}>{r.staff_email}</td>
                  <td style={{ padding: 8 }}>{r.status}</td>
                  <td style={{ padding: 8 }}>{r.note ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}