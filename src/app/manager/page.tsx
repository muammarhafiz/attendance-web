'use client';
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Staff = {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
  created_at: string;
};

const th: React.CSSProperties = { textAlign: 'left', padding: '10px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' };

export default function ManagerPage() {
  const router = useRouter();

  // session + auth
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // data state
  const [rows, setRows] = useState<Staff[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  // form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // login guard
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/login?next=/manager');
      } else {
        setAuthedEmail(data.session.user.email ?? null);
      }
      setSessionChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace('/login?next=/manager');
      else setAuthedEmail(session.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  // admin check (RPC ignores RLS; function returns boolean)
  const checkAdmin = useCallback(async (): Promise<boolean> => {
    const { data, error } = await supabase.rpc('is_admin');
    if (error) throw new Error(error.message);
    return Boolean(data);
  }, []);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('staff')
      .select('id, email, name, is_admin, created_at')
      .order('created_at', { ascending: false });
    if (error) setErr(error.message);
    else setRows((data ?? []) as Staff[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      if (!sessionChecked || !authedEmail) return;
      try {
        const ok = await checkAdmin();
        setIsAdmin(ok);
        if (!ok) {
          router.replace('/'); // not admin
          return;
        }
        await fetchStaff();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [sessionChecked, authedEmail, checkAdmin, fetchStaff, router]);

  // actions
  const addStaff = async () => {
    const n = name.trim();
    const e = email.trim().toLowerCase();
    if (!n || !e) { alert('Name and email are required'); return; }
    const { error } = await supabase.from('staff').insert({ name: n, email: e, is_admin: false });
    if (error) { alert(error.message); return; }
    setName(''); setEmail('');
    await fetchStaff();
  };

  const removeStaff = async (id: number, sEmail: string) => {
    if (authedEmail && authedEmail === sEmail) {
      alert('You cannot remove yourself.');
      return;
    }
    if (!confirm('Remove this staff?')) return;
    const { error } = await supabase.from('staff').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    await fetchStaff();
  };

  const toggleAdmin = async (id: number, makeAdmin: boolean, sEmail: string) => {
    if (authedEmail && authedEmail === sEmail && !makeAdmin) {
      alert('You cannot remove your own admin role.');
      return;
    }
    const { error } = await supabase.from('staff').update({ is_admin: makeAdmin }).eq('id', id);
    if (error) { alert(error.message); return; }
    await fetchStaff();
  };

  const myRow = useMemo(() => rows.find(r => r.email === authedEmail) ?? null, [rows, authedEmail]);

  if (!sessionChecked) return <div style={{ padding: 16 }}>Checking login…</div>;
  if (isAdmin === false) return <div style={{ padding: 16 }}>Redirecting…</div>;
  if (isAdmin === null) return <div style={{ padding: 16 }}>Authorizing…</div>;

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Manager</h2>
      <div style={{ marginBottom: 8, color: '#555' }}>
        Signed in as <b>{authedEmail}</b> {myRow?.is_admin ? '(admin)' : ''}
      </div>

      {/* Add staff */}
      <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: 12, margin: '12px 0' }}>
        <h3 style={{ marginTop: 0 }}>Add staff</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ padding: 8, border: '1px solid #ccc', borderRadius: 8, minWidth: 240 }}
          />
          <input
            placeholder="Email (Google sign-in email)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 8, border: '1px solid #ccc', borderRadius: 8, minWidth: 260 }}
          />
          <button onClick={addStaff} style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 8 }}>
            Add
          </button>
        </div>
      </div>

      {/* Staff table */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Staff list</h3>
        <div style={{ flex: 1 }} />
        <button onClick={fetchStaff} style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 8 }}>
          Reload
        </button>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}

      {!loading && !err && rows.length === 0 && (
        <div style={{ marginTop: 16, color: '#666' }}>No staff yet.</div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 8, marginTop: 10 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: '#f6f6f6' }}>
                <th style={th}>Name</th>
                <th style={th}>Email</th>
                <th style={th}>Role</th>
                <th style={th}>Created</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={td}>{s.name}</td>
                  <td style={td}>{s.email}</td>
                  <td style={td}>{s.is_admin ? 'Admin' : 'Staff'}</td>
                  <td style={td}>
                    {new Date(s.created_at).toLocaleString('en-GB', {
                      timeZone: 'Asia/Kuala_Lumpur',
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </td>
                  <td style={td}>
                    <button
                      onClick={() => toggleAdmin(s.id, !s.is_admin, s.email)}
                      style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6, marginRight: 8 }}
                    >
                      {s.is_admin ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button
                      onClick={() => removeStaff(s.id, s.email)}
                      style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6 }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}