export const dynamic = 'force-dynamic';

import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import NavBar from '@/components/NavBar';
import Container from '@/components/Container';
import RouteKeyed from '@/components/RouteKeyed';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'ZORDAQ Auto Service',
  description: 'ZORDAQ Auto Service — staff attendance, payroll & Niagawan operations.',
  icons: { icon: '/icon.png', apple: '/icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen antialiased">
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
