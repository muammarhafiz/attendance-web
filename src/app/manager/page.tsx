'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    fetchStaff();
  }, []);

  async function fetchStaff() {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff')
      .select('email, name, is_admin, created_at')
      .order('created_at', { ascending: false });
    if (error) console.error(error);
    else setStaff(data || []);
    setLoading(false);
  }

  async function addStaff() {
    if (!newEmail) return alert('Email required');
    const { error } = await supabase.from('staff').insert([
      {
        email: newEmail,
        name: newName || null,
        is_admin: isAdmin,
      },
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
    <main style={{ padding: 20, fontFamily: 'system-ui' }}>
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
          <table border={1} cellPadding={6}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Admin</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.email}>
                  <td>{s.email}</td>
                  <td>{s.name || '-'}</td>
                  <td>{s.is_admin ? 'Yes' : 'No'}</td>
                  <td>{new Date(s.created_at).toLocaleString()}</td>
                  <td>
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