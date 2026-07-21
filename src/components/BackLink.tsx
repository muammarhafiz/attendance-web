// src/components/BackLink.tsx
import Link from 'next/link';

// A clearly-visible, thumb-friendly back button — replaces the faint gray "← Back" text links
// on the workshop sub-pages (check-in, part-arrived, cash). Bordered pill, dark text, big tap area.
export default function BackLink({ href = '/workshop', label = 'Back' }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100"
    >
      <span aria-hidden className="text-base leading-none">←</span> {label}
    </Link>
  );
}
