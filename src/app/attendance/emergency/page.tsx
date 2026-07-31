import { redirect } from 'next/navigation';

// Emergency absences moved into the unified request inbox. Kept as a redirect so any
// bookmarks still work.
export default function Page() {
  redirect('/attendance/requests?type=emergency');
}
