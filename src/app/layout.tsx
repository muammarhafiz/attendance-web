export const dynamic = 'force-dynamic';
import './globals.css';
import NavBar from '@/components/NavBar';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fff', color: '#111' }}>
        <NavBar />
        <main style={{ maxWidth: 1100, margin: '0 auto', padding: '16px' }}>
          {children}
        </main>
      </body>
    </html>
  );
}