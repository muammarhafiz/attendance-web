'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type DebugState = {
  email: string | null;
  isAdmin: boolean | null;
  todayRows: number | null;
  error: string | null;
};

export default function TodayDebugCard() {
  const [dbg, setDbg] = useState<DebugState>({
    email: null,
    isAdmin: null,
    todayRows: null,
    error: null,
  });

  async function refresh() {
    try {
      setDbg((p) => ({ ...p, error: null }));

      // 1) Session email
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw new Error(`auth.getUser(): ${userErr.message}`);
      const email = userRes.user?.email ?? null;

      // 2) is_admin
      const { data: adminData, error: adminErr } = await supabase.rpc('is_admin');
      if (adminErr) throw new Error(`is_admin(): ${adminErr.message}`);
      const isAdmin = adminData === true;

      // 3) rows from get_today_ui_v1
      const { data: todayData, error: todayErr } = await supabase.rpc('get_today_ui_v1');
      if (todayErr) throw new Error(`get_today_ui_v1(): ${todayErr.message}`);
      const todayRows = Array.isArray(todayData) ? todayData.length : 0;

      setDbg({ email, isAdmin, todayRows, error: null });
    } catch (e: any) {
      setDbg((p) => ({ ...p, error: e?.message ?? String(e) }));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div
      style={{
        marginBottom: 12,
        padding: 12,
        border: '1px solid #ddd',
        borderRadius: 8,
        background: '#fff',
        fontSize: 14,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Debug</div>
      <div><b>Session email:</b> {dbg.email ?? '-'}</div>
      <div><b>is_admin():</b> {dbg.isAdmin === null ? '-' : String(dbg.isAdmin)}</div>
      <div><b>get_today_ui_v1 rows:</b> {dbg.todayRows === null ? '-' : dbg.todayRows}</div>

      {dbg.error && (
        <div style={{ marginTop: 8, color: '#b00020' }}>
          <b>Error:</b> {dbg.error}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <button onClick={refresh} style={{ padding: '8px 12px' }}>
          Refresh Debug
        </button>
      </div>
    </div>
  );
}