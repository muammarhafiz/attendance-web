export const dynamic = 'force-dynamic';

import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import NavBar from '@/components/NavBar';
import Container from '@/components/Container';
import RouteKeyed from '@/components/RouteKeyed';
import PwaRegister from '@/components/PwaRegister';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Zordaq Auto Services',
  description: 'Zordaq Auto Services — staff attendance, payroll & Niagawan operations.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.png', apple: '/icon.png' },
  appleWebApp: { capable: true, title: 'Zordaq', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#0f172a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen antialiased">
        <PwaRegister />
        <NavBar />
        <main>
          <Container>
            <RouteKeyed>{children}</RouteKeyed>
          </Container>
        </main>
      </body>
    </html>
  );
}
