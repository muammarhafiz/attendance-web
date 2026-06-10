// src/app/niagawan/kiv/page.tsx
// Landing on /niagawan/kiv goes to the Sale Invoice sub-tab.
import { redirect } from 'next/navigation';

export default function KivIndex() {
  redirect('/niagawan/kiv/sale-invoice');
}
