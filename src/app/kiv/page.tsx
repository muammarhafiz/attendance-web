// src/app/kiv/page.tsx
// Landing on /kiv goes to the Sale Invoice tab for now.
import { redirect } from 'next/navigation';

export default function KivIndex() {
  redirect('/kiv/sale-invoice');
}
