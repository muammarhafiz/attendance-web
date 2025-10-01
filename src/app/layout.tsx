export const dynamic = 'force-dynamic';
import './globals.css';
import NavBar from '@/components/NavBar';
import Container from '@/components/Container';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fff', color: '#111' }}>
        <NavBar />
        <main>
          <Container>
            {children}
          </Container>
        </main>
      </body>
    </html>
  );
}