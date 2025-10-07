// src/app/login/page.tsx
'use client';

import React, { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [name, setName]   = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const doLogin = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch('/api/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, is_admin: isAdmin }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Login failed');
      setMsg('Logged in. Redirecting…');
      // refresh current page
      window.location.href = '/';
    } catch (e: any) {
      setMsg(e?.message || 'Login error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: 16, border: '1px solid #e5e7eb', borderRadius: 12 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Login (Simple)</h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
        Enter your email (and optional name). This sets a local cookie session — no Supabase Auth required.
      </p>

      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ fontSize: 13 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={input}
            placeholder="user@example.com"
          />
        </label>
        <label style={{ fontSize: 13 }}>
          Name (optional)
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            style={input}
            placeholder="Your name"
          />
        </label>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={isAdmin} onChange={e => setIsAdmin(e.target.checked)} />
          Treat me as admin
        </label>

        <button onClick={doLogin} disabled={saving || !email} style={btnPrimary}>
          {saving ? 'Logging in…' : 'Login'}
        </button>
        {msg && <div style={{ fontSize: 12, color: msg.includes('error') ? '#991b1b' : '#065f46' }}>{msg}</div>}
      </div>
    </div>
  );
}

const input: React.CSSProperties = { width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8 };
const btnPrimary: React.CSSProperties = { padding: '9px 12px', borderRadius: 8, border: '1px solid #111827', background: '#111827', color: '#fff', cursor: 'pointer' };
