// src/components/BackLink.tsx
import Link from 'next/link';

// A clearly-visible, thumb-friendly back button — replaces the faint gray "← Back" text links
// on the workshop sub-pages (check-in, part-arrived, cash). Bordered pill, dark text, big tap area.
export default function BackLink({ href = '/workshop', label = 'Back' }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-2 shadow-sm hover:bg-ink/5 active:bg-ink/5"
    >
      <span aria-hidden className="text-base leading-none">←</span> {label}
    </Link>
  );
}
