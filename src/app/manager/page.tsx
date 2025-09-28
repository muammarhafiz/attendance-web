'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

type StaffRow = {
  email: string;
  name: string | null;
  is_admin: boolean;
  created_at: string | null;
};

export default function ManagerPage() {
  const [meIsAdmin, setMeIsAdmin] = useState(false);
  const [list, setList] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // inline edit states
  const [editKey, setEditKey] = useState<string | null>(null); // email being edited (original key)
  const [editEmail, setEditEmail] = useState('');
  const [editName, setEditName] = useState('');
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const wrap = { maxWidth: 1100, margin: '0 auto', padding: 16, fontFamily: 'system-ui' } as const;
  const th  = { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb', background: '#f8fafc' } as const;
  const td  = { padding: '10px 12px', borderBottom: '1px solid #eee', verticalAlign: 'middle' } as const;
  const row = { borderBottom: '1px solid #eee' } as const;
  const pill= { padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:8, background:'#fff' } as const;
  const btn = (color:'#0ea5e9'|'#f59e0b'|'#16a34a'|'#ef4444'|'#6b7280') => ({
    padding:'6px 10px', border:0, borderRadius:8, background:color, color:'#fff'
  } as const);

  const displayName = (r: StaffRow) => (r.name ?? r.email);

  const fetchMeAndList = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setMsg(null);
    // who am I
    const { data: au } = await supabase.auth.getUser();
    const myEmail = au.user?.email ?? null;
    let isAdmin = false;
    if (myEmail) {
      const { data: me } = await supabase.from('staff').select('is_admin').eq('email', myEmail).maybeSingle();
      isAdmin = Boolean(me?.is_admin);
    }
    setMeIsAdmin(isAdmin);

    // staff list
    const { data, error } = await supabase
      .from('staff')
      .select('email,name,is_admin,created_at')
      .order('name', { ascending: true })
      .order('email', { ascending: true });
    if (error) { setErr(error.message); setLoading(false); return; }
    setList((data ?? []) as StaffRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchMeAndList(); }, [fetchMeAndList]);

  const startEdit = (r: StaffRow) => {
    setEditKey(r.email);
    setEditEmail(r.email);
    setEditName(r.name ?? '');
    setMsg(null);
  };
  const cancelEdit = () => {
    setEditKey(null);
    setEditEmail('');
    setEditName('');
    setMsg(null);
  };

  const saveEdit = async () => {
    if (!meIsAdmin) { setMsg('Only admin can edit.'); return; }
    if (!editKey) return;
    if (!editEmail.trim()) { setMsg('Email is required.'); return; }

    setBusyRow(editKey);
    setMsg(null);

    // Try updating row (including primary key email). If your RLS/PK blocks this,
    // we fall back to: insert new + copy flags + delete old.
    const { error: upErr } = await supabase
      .from('staff')
      .update({ email: editEmail.trim(), name: editName.trim() || null })
      .eq('email', editKey);

    if (upErr) {
      // fallback path: insert new, then delete old (preserve is_admin)
      const original = list.find(x => x.email === editKey);
      const is_admin = !!original?.is_admin;

      const { error: insErr } = await supabase
        .from('staff')
        .insert([{ email: editEmail.trim(), name: editName.trim() || null, is_admin }]);
      if (insErr) {
        setBusyRow(null);
        setMsg(`Edit failed: ${upErr.message || insErr.message}`);
        return;
      }
      const { error: delErr } = await supabase.from('staff').delete().eq('email', editKey);
      if (delErr) {
        setBusyRow(null);
        setMsg(`Warning: created new but failed to remove old (${delErr.message}). Remove manually.`);
        await fetchMeAndList();
        setEditKey(null);
        return;
      }
    }

    setBusyRow(null);
    setEditKey(null);
    await fetchMeAndList();
    setMsg('Saved.');
  };

  const toggleAdmin = async (email: string, wantAdmin: boolean) => {
    if (!meIsAdmin) { setMsg('Only admin can change roles.'); return; }
    setBusyRow(email);
    const { error } = await supabase.from('staff').update({ is_admin: wantAdmin }).eq('email', email);
    setBusyRow(null);
    if (error) { setMsg(error.message); return; }
    await fetchMeAndList();
  };

  const removeStaff = async (email: string) => {
    if (!meIsAdmin) { setMsg('Only admin can remove staff.'); return; }
    if (!confirm(`Remove ${email}? This cannot be undone.`)) return;
    setBusyRow(email);
    const { error } = await supabase.from('staff').delete().eq('email', email);
    setBusyRow(null);
    if (error) { setMsg(error.message); return; }
    await fetchMeAndList();
  };

  return (
    <main style={wrap}>
      <h2 style={{margin:'6px 0 12px'}}>Manager</h2>
      <div style={{marginBottom:10, color:'#6b7280'}}>
        You are: <b>{meIsAdmin ? 'Admin' : 'Staff'}</b>
        {' '}| <Link href="/" style={{textDecoration:'underline'}}>Back to Check-in</Link>
      </div>

      {msg && <div style={{margin:'8px 0', color: msg==='Saved.' ? '#16a34a' : '#b91c1c'}}>{msg}</div>}
      {err && <div style={{margin:'8px 0', color:'#b91c1c'}}>Load error: {err}</div>}

      <div style={{overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8}}>
        <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
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
            {list.length === 0 && (
              <tr><td colSpan={5} style={{...td, color:'#6b7280'}}>No staff.</td></tr>
            )}

            {list.map((r) => {
              const isEditing = editKey === r.email;
              const created = r.created_at
                ? new Intl.DateTimeFormat('en-MY', { dateStyle:'short', timeStyle:'short', timeZone:'Asia/Kuala_Lumpur' }).format(new Date(r.created_at))
                : '-';

              return (
                <tr key={r.email} style={row}>
                  <td style={td}>
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e)=>setEditName(e.target.value)}
                        placeholder="Name"
                        style={{padding:8, border:'1px solid #d1d5db', borderRadius:8, minWidth:200}}
                      />
                    ) : (
                      <span>{displayName(r)}</span>
                    )}
                  </td>
                  <td style={td}>
                    {isEditing ? (
                      <input
                        value={editEmail}
                        onChange={(e)=>setEditEmail(e.target.value)}
                        placeholder="email@example.com"
                        style={{padding:8, border:'1px solid #d1d5db', borderRadius:8, minWidth:260}}
                      />
                    ) : (
                      <span>{r.email}</span>
                    )}
                  </td>
                  <td style={td}>
                    {r.is_admin ? <span style={{color:'#16a34a', fontWeight:600}}>Admin</span> : 'Staff'}
                  </td>
                  <td style={td}>{created}</td>
                  <td style={{...td, display:'flex', gap:8, flexWrap:'wrap'}}>
                    {isEditing ? (
                      <>
                        <button disabled={busyRow===r.email} onClick={saveEdit} style={btn('#16a34a')}>Save</button>
                        <button disabled={busyRow===r.email} onClick={cancelEdit} style={btn('#6b7280')}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button disabled={!meIsAdmin || busyRow===r.email} onClick={()=>startEdit(r)} style={btn('#0ea5e9')}>Edit</button>
                        {r.is_admin
                          ? <button disabled={!meIsAdmin || busyRow===r.email} onClick={()=>void toggleAdmin(r.email, false)} style={btn('#f59e0b')}>Revoke</button>
                          : <button disabled={!meIsAdmin || busyRow===r.email} onClick={()=>void toggleAdmin(r.email, true)}  style={btn('#16a34a')}>Admin</button>}
                        <button disabled={!meIsAdmin || busyRow===r.email} onClick={()=>void removeStaff(r.email)} style={btn('#ef4444')}>Remove</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}