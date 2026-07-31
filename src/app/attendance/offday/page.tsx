import { redirect } from 'next/navigation';

// The direct/bulk-set page was retired: public holidays are managed in Attendance → Holidays,
// and per-day changes (including require-proof) are done on Attendance → Report. Kept as a
// redirect so any bookmarks still work.
export default function Page() {
  redirect('/attendance/report');
}
