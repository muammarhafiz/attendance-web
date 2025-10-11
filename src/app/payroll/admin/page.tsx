'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function PayrollAdmin() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [periods, setPeriods] = useState<any[]>([]);

  useEffect(() => {
    const loadData = async () => {
      const { data: sessionData } = await supabase.auth.getUser();
      const email = sessionData?.user?.email ?? null;
      setUserEmail(email);

      if (!email) {
        setMsg('Please sign in to access Payroll.');
        setLoading(false);
        return;
      }

      // check if admin
      const { data: adminCheck } = await supabase
        .from('staff')
        .select('is_admin')
        .eq('email', email)
        .maybeSingle();

      if (!adminCheck?.is_admin) {
        setMsg('Access denied: Admins only.');
        setLoading(false);
        return;
      }

      // load payroll periods
      const { data: res, error } = await supabase.from('payroll_periods').select('*').order('created_at', { ascending: false });
      if (error) setMsg(error.message);
      else setPeriods(res ?? []);
      setLoading(false);
    };
    loadData();
  }, []);

  if (loading) return <main style={{ padding: 20 }}>Loading...</main>;
  if (msg) return <main style={{ padding: 20 }}>{msg}</main>;

  return (
    <main style={{ padding: 20 }}>
      <h2>Payroll Periods</h2>
      <table style={{ marginTop: 16, width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ borderBottom: '1px solid #ddd', textAlign: 'left' }}>Year</th>
            <th style={{ borderBottom: '1px solid #ddd', textAlign: 'left' }}>Month</th>
            <th style={{ borderBottom: '1px solid #ddd', textAlign: 'left' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id}>
              <td style={{ borderBottom: '1px solid #eee' }}>{p.year}</td>
              <td style={{ borderBottom: '1px solid #eee' }}>{p.month}</td>
              <td style={{ borderBottom: '1px solid #eee' }}>{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}