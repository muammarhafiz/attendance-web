'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

interface Staff {
  email: string;
  name: string | null;
  is_admin: boolean;
  created_at: string;
}

export default function ManagerPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

  useEffect(() => {
    checkAdmin();
  }, []);

  async function checkAdmin() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    const { data, error } = await supabase
      .from('staff')
      .select('is_admin')
      .eq('email', user.email)
      .single();

    if (error || !data?.is_admin) {
      alert('Access denied. Admins only.');
      router.push('/');
      return;
    }

    fetchStaff();
  }

  async function fetchStaff() {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff')
      .select('email, name, is_admin, created_at')
      .order('created_at', { ascending: false });
    if (!error && data) setStaff(data);
    setLoading(false);
  }

  async function addStaff() {
    if (!newEmail) return alert('Email required');
    const { error } = await supabase.from('staff').insert([
      { email: newEmail, name: newName || null, is_admin: isAdmin },
    ]);
    if (error) alert(error.message);
    else {
      setNewEmail('');
      setNewName('');
      setIsAdmin(false);
      fetchStaff();
    }
  }

  async function removeStaff(email: string) {
    if (!confirm(`Remove ${email}?`)) return;
    const { error } = await supabase.from('staff').delete().eq('email', email);
    if (error) alert(error.message);
    else fetchStaff();
  }

  async function toggleAdmin(email: string, current: boolean) {
    const { error } = await supabase
      .from('staff')
      .update({ is_admin: !current })
      .eq('email', email);
    if (error) alert(error.message);
    else fetchStaff();
  }

  return (
    <main style={{ padding: 20, fontFamily: 'system-ui', backgroundColor: '#fff', color: '#000' }}>
      <h1>Manager</h1>

      <section style={{ marginBottom: 20 }}>
        <h2>Add Staff</h2>
        <input
          placeholder="Email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          style={{ marginRight: 8 }}
        />
        <input
          placeholder="Name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ marginRight: 8 }}
        />
        <label>
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
          />{' '}
          Admin
        </label>
        <button onClick={addStaff} style={{ marginLeft: 8 }}>
          Add
        </button>
      </section>

      <section>
        <h2>Staff List</h2>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              backgroundColor: '#f9f9f9',
              color: '#000',
            }}
          >
            <thead>
              <tr>
                <th style={{ border: '1px solid #333', padding: 6 }}>Email</th>
                <th style={{ border: '1px solid #333', padding: 6 }}>Name</th>
                <th style={{ border: '1px solid #333', padding: 6 }}>Admin</th>
                <th style={{ border: '1px solid #333', padding: 6 }}>Created</th>
                <th style={{ border: '1px solid #333', padding: 6 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.email}>
                  <td style={{ border: '1px solid #333', padding: 6 }}>{s.email}</td>
                  <td style={{ border: '1px solid #333', padding: 6 }}>{s.name || '-'}</td>
                  <td style={{ border: '1px solid #333', padding: 6 }}>{s.is_admin ? 'Yes' : 'No'}</td>
                  <td style={{ border: '1px solid #333', padding: 6 }}>
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                  <td style={{ border: '1px solid #333', padding: 6 }}>
                    <button onClick={() => toggleAdmin(s.email, s.is_admin)}>
                      {s.is_admin ? 'Revoke Admin' : 'Make Admin'}
                    </button>{' '}
                    <button onClick={() => removeStaff(s.email)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}