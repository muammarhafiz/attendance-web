// src/app/niagawan/page.tsx
// Landing on /niagawan goes to the Sales tab for now.
// (An "Overview" dashboard will replace this redirect later.)
import { redirect } from 'next/navigation';

export default function NiagawanIndex() {
  redirect('/niagawan/sales');
}
