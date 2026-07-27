'use client';
// Settings → Notifications tab. Phone-push control for the signed-in person's own devices.
// Reachable by Owner + Manager + Office (the notification audience).
import PushToggle from '@/components/PushToggle';

export default function NotificationsSettings() {
  return <PushToggle />;
}
