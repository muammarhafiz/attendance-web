// src/app/employees/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import EmployeesClient from '@/components/EmployeesClient';
import { createClientBrowser } from '@/lib/supabaseBrowser';

type Staff = {
  email: string;
  name: string;
  base_salary: number | null;
  include_in_payroll: boolean | null;
};

export default function EmployeesPage() {
  const supabase = createClientBrowser();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Staff[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // 1) Check session on the client (has your cookies)
        const { data: { user } } = await supabase.auth.getUser();
        if (!mounted) return;

        setUserEmail(user?.email ?? null);

        // 2) Check admin (best effort)
        let isAdmin = false;
        try {
          const { data } = await supabase.rpc('is_admin');
          isAdmin = !!data;
        } catch {
          isAdmin = false;
        }
        if (!mounted) return;
        setCanEdit(isAdmin);

        // 3) Load staff
        const { data, error } = await supabase
          .from('staff')
          .select('email, name, base_salary, include_in_payroll')
          .order('name', { ascending: true });

        if (error) throw error;
        if (!mounted) return;

        setRows((data || []) as Staff[]);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load staff.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [supabase]);

  if (loading) return <div style={{ padding: 24, color: '#6b7280' }}>Loading…</div>;
  if (error)   return <div style={{ padding: 24, color: '#b91c1c' }}>{error}</div>;
  if (!userEmail) {
    return <div style={{ padding: 24 }}>Please login.</div>;
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Employees</h1>
      <p style={{ color: '#6b7280', marginBottom: 12 }}>
        Manage base salary and whether each staff is included in payroll generation.
      </p>

      <EmployeesClient rows={rows} canEdit={canEdit} />

      {!canEdit && (
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
          You are not an admin; fields are read-only.
        </p>
      )}
    </div>
  );
}