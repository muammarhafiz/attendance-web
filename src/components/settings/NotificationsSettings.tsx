'use client';
// Settings → Notifications tab. Phone-push control (per device) + notification preferences (per type).
// Reachable by Owner + Manager + Office (the notification audience).
import PushToggle from '@/components/PushToggle';
import NotificationPrefs from '@/components/NotificationPrefs';

export default function NotificationsSettings() {
  return (
    <div className="space-y-4">
      <PushToggle />
      <NotificationPrefs />
    </div>
  );
}
