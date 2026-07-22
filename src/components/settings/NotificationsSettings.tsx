'use client';
// Settings → Notifications tab. Per-device phone push control.
import PushToggle from '@/components/PushToggle';

export default function NotificationsSettings() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Notifications</h2>
        <p className="mt-1 text-sm text-gray-500">
          Turn on push notifications so bell alerts reach your phone even when the app is closed. Do this once on each device you use.
        </p>
      </div>
      <PushToggle />
    </div>
  );
}
