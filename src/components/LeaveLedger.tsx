'use client';
// Shared dated leave-ledger list, used by the admin Leave balances page and the staff
// "My leave" card. Rows come from leave_ledger / my_leave_ledger, grouped by leave TYPE (kind)
// and reconciling to leave_balances / my_leave_balance. Consecutive days with the same
// paid / over-quota / emergency status collapse into a range.

export type LedgerKind = 'ANNUAL' | 'UNPAID' | 'PATERNITY' | 'MATERNITY' | 'HOLIDAY' | 'SICK' | 'HOSPITALISATION' | 'EMERGENCY';
export type LedgerRow = {
  kind: LedgerKind;
  day: string;            // 'YYYY-MM-DD'
  paid: boolean;
  over_quota: boolean;
  is_emergency: boolean;
  note: string | null;
};
export type AdminLedgerRow = LedgerRow & { email: string; name: string };

// Display order + friendly labels for each kind.
const KIND_ORDER: LedgerKind[] = ['ANNUAL', 'UNPAID', 'PATERNITY', 'MATERNITY', 'HOLIDAY', 'SICK', 'HOSPITALISATION', 'EMERGENCY'];
const KIND_LABEL: Record<LedgerKind, string> = {
  ANNUAL: 'Annual leave', UNPAID: 'Unpaid leave', PATERNITY: 'Paternity leave', MATERNITY: 'Maternity leave',
  HOLIDAY: 'Company holiday', SICK: 'Sick leave · MC', HOSPITALISATION: 'Hospitalisation · MC', EMERGENCY: 'Emergency',
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parseISO(iso: string) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; }
function nextDay(iso: string): string {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
// '2026-03-16' + '2026-03-18' -> '16–18 Mar'; cross-month -> '28 Sep – 3 Oct'; single -> '16 Mar'.
function fmtRange(from: string, to: string): string {
  const a = parseISO(from), b = parseISO(to);
  if (from === to) return `${a.d} ${MON[a.m - 1]}`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MON[a.m - 1]}`;
  return `${a.d} ${MON[a.m - 1]} – ${b.d} ${MON[b.m - 1]}`;
}

type Seg = { from: string; to: string; days: number; paid: boolean; over_quota: boolean; is_emergency: boolean };
function collapse(rows: LedgerRow[]): Seg[] {
  const sorted = [...rows].sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0));
  const segs: Seg[] = [];
  for (const r of sorted) {
    const last = segs[segs.length - 1];
    if (last && nextDay(last.to) === r.day && last.paid === r.paid && last.over_quota === r.over_quota && last.is_emergency === r.is_emergency) {
      last.to = r.day; last.days += 1;
    } else {
      segs.push({ from: r.day, to: r.day, days: 1, paid: r.paid, over_quota: r.over_quota, is_emergency: r.is_emergency });
    }
  }
  return segs;
}

function Group({ kind, rows }: { kind: LedgerKind; rows: LedgerRow[] }) {
  const segs = collapse(rows);
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{KIND_LABEL[kind]} · {rows.length} day{rows.length === 1 ? '' : 's'}</div>
      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {segs.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
            <span className="text-ink tabular-nums">
              {fmtRange(s.from, s.to)}
              {s.days > 1 && <span className="ml-1.5 text-[11px] font-normal text-ink-3">· {s.days} days</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {s.is_emergency && <span className="rounded-full bg-bad-soft px-2 py-0.5 text-[10px] font-medium text-bad">emergency</span>}
              {s.over_quota
                ? <span className="rounded-full bg-bad-soft px-2 py-0.5 text-[11px] font-medium text-bad">over quota</span>
                : !s.paid
                  ? <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">unpaid</span>
                  : <span className="text-[11px] text-ink-3">paid</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeaveLedgerList({ rows }: { rows: LedgerRow[] }) {
  if (rows.length === 0) return <div className="py-3 text-center text-xs text-ink-3">No leave taken this year.</div>;
  const anyOver = rows.some((r) => r.over_quota);
  return (
    <div className="space-y-3">
      {KIND_ORDER.map((k) => {
        const g = rows.filter((r) => r.kind === k);
        return g.length > 0 ? <Group key={k} kind={k} rows={g} /> : null;
      })}
      {anyOver && (
        <div className="text-[11px] text-ink-3">Days past the yearly quota show as <b className="text-bad">over quota</b> — the office decides whether to pay or treat them as unpaid.</div>
      )}
    </div>
  );
}

// --- CSV export (admin) ---------------------------------------------------
// Escape a CSV cell, guarding against spreadsheet formula injection (including leading TAB/CR,
// which Excel/Sheets strip before evaluating the formula that follows).
function csvCell(v: string): string {
  let s = v ?? '';
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
function statusLabel(r: LedgerRow): string {
  return r.over_quota ? 'Over quota (may be unpaid)' : r.paid ? 'Paid' : 'Unpaid';
}
export function ledgerToCsv(rows: AdminLedgerRow[]): string {
  const header = ['Staff', 'Email', 'Type', 'Date', 'Status', 'Emergency', 'Note'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.name, r.email, KIND_LABEL[r.kind], r.day, statusLabel(r), r.is_emergency ? 'Yes' : '', r.note ?? '',
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}`; // BOM so Excel reads UTF-8
}
