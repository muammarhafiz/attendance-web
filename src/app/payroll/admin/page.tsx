// /src/app/payroll/admin/page.tsx
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

async function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // In your project, cookies() is async-typed → await it
  const cookieStore = await cookies();

  const sb = createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });

  return sb;
}

export default async function AdminPayrollPage() {
  const supabase = await getSupabaseServer();

  // 1) Session
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-2 text-2xl font-semibold">Payroll (Admin)</h1>
        <p className="text-sm text-gray-600">Please sign in to access Payroll.</p>
      </main>
    );
  }

  // 2) Admin check
  const { data: staff, error } = await supabase
    .from('staff')
    .select('is_admin')
    .eq('email', user.email)
    .maybeSingle();

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-2 text-2xl font-semibold">Payroll (Admin)</h1>
        <p className="text-sm text-red-700">Failed to verify permission: {error.message}</p>
      </main>
    );
  }

  if (!staff?.is_admin) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-2 text-2xl font-semibold">Payroll (Admin)</h1>
        <p className="text-sm text-gray-600">
          You’re signed in as <span className="font-medium">{user.email}</span>, but you’re not authorized to view this page.
        </p>
      </main>
    );
  }

  // 3) Authorized placeholder (we’ll mount the dashboard next)
  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Payroll (Admin)</h1>
        <p className="text-sm text-gray-600">Access granted for admin: {user.email}</p>
      </header>

      <div className="rounded border bg-white p-4">
        <p className="text-sm text-gray-700">
          Guard is working. Next step: wire in the dashboard UI.
        </p>
      </div>
    </main>
  );
}