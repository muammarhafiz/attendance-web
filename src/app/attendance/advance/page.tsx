import { redirect } from 'next/navigation';

// Advance requests moved into the unified request inbox. Kept as a redirect so the
// notification-bell links and any bookmarks still work.
export default function Page() {
  redirect('/attendance/requests?type=advance');
}
