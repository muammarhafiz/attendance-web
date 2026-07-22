'use client';
// Explicit Check-in route — where owners' "Check-in" nav points (so it doesn't get
// redirected to the dashboard the way "/" does). Renders the same self-service page.
import CheckinV2 from '@/components/CheckinV2';

export default function CheckinPage() {
  return (
    <div className="py-2">
      <CheckinV2 />
    </div>
  );
}
