'use client';
import { useEffect } from 'react';

// Next.js App Router error boundary for /offday
// Catches RSC fetch failures (e.g. Vercel 503) during client-side navigation
export default function OffdayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[offday] RSC error:', error);
  }, [error]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-semibold mb-2">Failed to load Offday / MC page</p>
        <p className="mb-3 text-red-600">
          The server returned an error. This can happen when the server is temporarily busy.
          Please wait a moment and try again.
        </p>
        {error?.message && (
          <p className="mb-3 text-xs text-red-500 font-mono">{error.message}</p>
        )}
        <button
          className="rounded border border-red-300 px-3 py-1.5 text-sm hover:bg-red-100"
          onClick={reset}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
