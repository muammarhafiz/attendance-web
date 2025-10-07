// src/app/salary/page.tsx
import { redirect } from 'next/navigation';

export default function SalaryIndex() {
  redirect('/salary/payroll');
}