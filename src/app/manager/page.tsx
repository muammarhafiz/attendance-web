'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

type StaffRow = {
  email: string;
  name: string;
  is_admin: boolean;
  created_at: string | null;
};

const wrap: React.CSSProperties = { maxWidth: 980, margin: '16px auto', padding: 16 };
const h2: React.CSSProperties = { margin: '0 0 12px', fontWeight: 700 };
const pill: React.CSSProperties = { padding: '2px 8px', borderRadius: 999, background: '#e8f5e9', color: '#1b5e20', fontSize: 12 };
const pillGray: React.CSSProperties = { padding: '2px 8px', borderRadius: 999, background: '#f0f0f0', color: '#333', fontSize: 12 };

const input: React.CSSProperties = { padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, outline: 'none' };
const btn: React.CSSProperties = { padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#f7f7f7' };

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontWeight: 600, background: '#f5fafc', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #f1f1f1', verticalAlign: 'top' };
const tableWrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid #eee', borderRadius: 10 };

export default function ManagerPage() {
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Add form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newAdmin, setNewAdmin] = useState(false);

  // Inline edit state
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');

  // session + admin check
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email ?? null;
      setMeEmail(email);

      if (email) {
        const { data: staff, error } = await supabase
          .from('staff')
          .select('is_admin')
          .eq('email', email)
          .maybeSingle();
        if (error) {
          console.error(error);
        }
        setIsAdmin(staff?.is_admin === true);
      } else {
        setIsAdmin(false);
      }
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange(() => init());
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('staff')
        .select('email,name,is_admin,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as StaffRow[]);
    } catch (e) {
      alert(`Failed to load staff: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) loadStaff(); }, [isAdmin, loadStaff]);

  const addStaff = async () => {
    if (!newName.trim() || !newEmail.trim()) {
      alert('Please enter name and email.');
      return;
    }
    try {
      const { error } = await supabase
        .from('staff')
        .insert([{ name: newName.trim(), email: newEmail.trim(), is_admin: newAdmin }]);
      if (error) throw error;
      setNewName('');
      setNewEmail('');
      setNewAdmin(false);
      await loadStaff();
    } catch (e) {
      alert(`Add failed: ${(e as Error).message}`);
    }
  };

  const startEdit = (r: StaffRow) => {
    setEditingEmail(r.email);
    setEditName(r.name);
    setEditEmail(r.email);
  };

  const saveEdit = async (originalEmail: string) => {
    try {
      const { error } = await supabase
        .from('staff')
        .update({ name: editName.trim(), email: editEmail.trim() })
        .eq('email', originalEmail);
      if (error) throw error;
      setEditingEmail(null);
      await loadStaff();
    } catch (e) {
      alert(`Update failed: ${(e as Error).message}`);
    }
  };

  const setAdminFlag = async (email: string, makeAdmin: boolean) => {
    try {
      const { error } = await supabase.from('staff').update({ is_admin: makeAdmin }).eq('email', email);
      if (error) throw error;
      await loadStaff();
    } catch (e) {
      alert(`Role change failed: ${(e as Error).message}`);
    }
  };

  const removeStaff = async (email: string) => {
    if (!confirm('Remove this staff? This cannot be undone.')) return;
    try {
      const { error } = await supabase.from('staff').delete().eq('email', email);
      if (error) throw error;
      await loadStaff();
    } catch (e) {
      alert(`Remove failed: ${(e as Error).message}`);
    }
  };

  const sorted = useMemo(
    () => rows.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );

  if (meEmail && !isAdmin) {
    return (
      <div style={wrap}>
        <p>You are signed in as <b>{meEmail}</b>, but you’re not an admin.</p>
        <p><Link href="/">Back to Check-in</Link></p>
      </div>
    );
  }

  if (!meEmail) {
    return (
      <div style={wrap}>
        <p>Please <Link href="/login">sign in</Link> to access Manager.</p>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <h2 style={h2}>Manager</h2>
      <p>
        You are: <span style={pill}>Admin</span> &nbsp;|&nbsp; <Link href="/">Back to Check-in</Link>
      </p>

      {/* ADD STAFF PANEL */}
      <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 12, margin: '12px 0' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Add staff</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            style={{ ...input, minWidth: 180 }}
            placeholder="Full name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <input
            style={{ ...input, minWidth: 220 }}
            placeholder="Email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            inputMode="email"
          />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={newAdmin} onChange={e => setNewAdmin(e.target.checked)} />
            Make admin
          </label>
          <button style={btn} onClick={addStaff}>Add</button>
        </div>
      </div>

      {/* STAFF TABLE */}
      <div style={tableWrap}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Email</th>
              <th style={th}>Role</th>
              <th style={th}>Created</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td style={td} colSpan={5}>Loading…</td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td style={td} colSpan={5}>No staff yet.</td></tr>
            )}
            {!loading && sorted.map(r => {
              const editing = editingEmail === r.email;
              return (
                <tr key={r.email}>
                  <td style={td}>
                    {editing ? (
                      <input style={input} value={editName} onChange={e => setEditName(e.target.value)} />
                    ) : r.name}
                  </td>
                  <td style={td}>
                    {editing ? (
                      <input style={{ ...input, minWidth: 220 }} value={editEmail} onChange={e => setEditEmail(e.target.value)} />
                    ) : <span style={{ textDecoration: 'underline' }}>{r.email}</span>}
                  </td>
                  <td style={td}>
                    {r.is_admin ? <span style={pill}>Admin</span> : <span style={pillGray}>Staff</span>}
                  </td>
                  <td style={td}>
                    {r.created_at ? new Date(r.created_at).toLocaleString('en-GB', { hour12: true }) : '—'}
                  </td>
                  <td style={{ ...td, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {!editing ? (
                      <button style={{ ...btn, background: '#e6f2ff', borderColor: '#cfe3ff' }} onClick={() => startEdit(r)}>
                        Edit
                      </button>
                    ) : (
                      <>
                        <button style={{ ...btn, background: '#e6f2ff', borderColor: '#cfe3ff' }}
                          onClick={() => saveEdit(r.email)}>Save</button>
                        <button style={btn} onClick={() => setEditingEmail(null)}>Cancel</button>
                      </>
                    )}

                    {r.is_admin ? (
                      <button
                        style={{ ...btn, background: '#ffe7c2', borderColor: '#ffd79c' }}
                        onClick={() => setAdminFlag(r.email, false)}
                      >
                        Revoke
                      </button>
                    ) : (
                      <button
                        style={{ ...btn, background: '#d7fbe8', borderColor: '#b8f1d6' }}
                        onClick={() => setAdminFlag(r.email, true)}
                      >
                        Admin
                      </button>
                    )}

                    <button
                      style={{ ...btn, background: '#ffd8d6', borderColor: '#ffc0bd' }}
                      onClick={() => removeStaff(r.email)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}