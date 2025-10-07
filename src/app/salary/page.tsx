import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ maxWidth: 480, margin: '40px auto', padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Salary System</h1>
      <p><Link href="/login" style={{ textDecoration: 'underline' }}>Go to Login</Link></p>
    </main>
  );
}