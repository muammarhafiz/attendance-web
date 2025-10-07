import Link from 'next/link';
import { createClientServer } from '@/lib/supabaseServer';

export default async function Dashboard() {
  const supabase = createClientServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main style={{ maxWidth: 480, margin: '40px auto', padding: 16 }}>
        <p>Not signed in.</p>
        <Link href="/login" style={{ textDecoration: 'underline' }}>Go to Login</Link>
      </main>
    );
  }

  // ask DB if this UID is admin
  const { data: isAdmin } = await supabase.rpc('is_admin');
  const displayRole = isAdmin ? 'admin' : 'staff';

  return (
    <main style={{ maxWidth: 520, margin: '40px auto', padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Dashboard</h1>
      <div style={{ marginBottom: 8 }}>
        <div>User (username): {user.email}</div>
        <div><b>UID:</b> {user.id}</div>   {/* ← copy this value */}
        <div>Role: {displayRole}</div>
      </div>
      <p><Link href="/employees" style={{ textDecoration: 'underline' }}>Employees</Link></p>
    </main>
  );
}
