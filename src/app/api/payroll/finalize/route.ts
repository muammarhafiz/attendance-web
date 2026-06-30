import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';
// @ts-ignore  // types provided by src/types/pdfkit-standalone.d.ts
import PDFDocument from 'pdfkit/js/pdfkit.standalone.js';
import { ZORDAQ_LOGO_DATA_URI } from '@/lib/payslipLogo';

export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type Row = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: string | number;
  base_wage: string | number;
  manual_deduct: string | number;
  epf_emp: string | number;
  socso_emp: string | number;
  eis_emp: string | number;
  epf_er: string | number;
  socso_er: string | number;
  eis_er: string | number;
  net_pay: string | number;
};

function toNum(x: string | number | null | undefined): number {
  return typeof x === 'string' ? Number(x) : x ?? 0;
}

async function fetchPeriod(year: number, month: number) {
  const { data, error } = await supabaseAdmin
    .schema('pay_v2')
    .from('periods')
    .select('id, status')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || 'Period not found');
  return data;
}

async function fetchSummary(year: number, month: number): Promise<Row[]> {
  const { data, error } = await supabaseAdmin
    .schema('pay_v2')
    .from('v_payslip_admin_summary')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .order('staff_name', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchItems(period_id: string) {
  const { data, error } = await supabaseAdmin
    .schema('pay_v2')
    .from('items')
    .select('staff_email, kind, code, label, amount')
    .eq('period_id', period_id);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchStaff() {
  const { data, error } = await supabaseAdmin
    .from('staff')
    .select('email, full_name, name, position, nric, epf_no, socso_no');
  if (error) throw new Error(error.message);
  const map = new Map<string, any>();
  (data ?? []).forEach((s) => map.set(s.email, s));
  return map;
}

// keep typing minimal to avoid external type deps
function makePdfBuffer(build: (doc: any) => void, opts: any = { margin: 36 }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(opts);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function summaryPdf(year: number, month: number, rows: Row[]) {
  return makePdfBuffer((doc) => {
    doc.fontSize(16).text(`Payroll Summary — ${year}-${String(month).padStart(2, '0')}`, { underline: true });
    doc.moveDown();

    doc.fontSize(10).text(
      [
        'Employee', 'Gross', 'Base',
        'EPF(E)', 'SOCSO(E)', 'EIS(E)',
        'Manual', 'Net',
        'EPF(Er)', 'SOCSO(Er)', 'EIS(Er)'
      ].join(' | ')
    );
    doc.moveDown(0.25);

    rows.forEach(r => {
      const line = [
        (r.staff_name || r.staff_email),
        toNum(r.total_earn).toFixed(2),
        toNum(r.base_wage).toFixed(2),
        toNum(r.epf_emp).toFixed(2),
        toNum(r.socso_emp).toFixed(2),
        toNum(r.eis_emp).toFixed(2),
        toNum(r.manual_deduct).toFixed(2),
        toNum(r.net_pay).toFixed(2),
        toNum(r.epf_er).toFixed(2),
        toNum(r.socso_er).toFixed(2),
        toNum(r.eis_er).toFixed(2),
      ].join(' | ');
      doc.text(line);
    });

    const sum = (k: keyof Row) => rows.reduce((a, r) => a + toNum(r[k]), 0);
    doc.moveDown();
    doc.font('Helvetica-Bold').text(
      [
        'TOTALS',
        sum('total_earn').toFixed(2),
        sum('base_wage').toFixed(2),
        sum('epf_emp').toFixed(2),
        sum('socso_emp').toFixed(2),
        sum('eis_emp').toFixed(2),
        sum('manual_deduct').toFixed(2),
        sum('net_pay').toFixed(2),
        sum('epf_er').toFixed(2),
        sum('socso_er').toFixed(2),
        sum('eis_er').toFixed(2),
      ].join(' | ')
    );
  });
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function money(x: string | number | null | undefined): string {
  return `RM ${toNum(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STAT_LABELS: Record<string, string> = {
  STAT_EMP_EPF: 'EPF (Employee)', STAT_EMP_SOCSO: 'SOCSO + Lindung 24 Jam', STAT_EMP_EIS: 'EIS (Employee)',
  STAT_ER_EPF: 'EPF (Employer)', STAT_ER_SOCSO: 'SOCSO (Employer)', STAT_ER_EIS: 'EIS (Employer)',
  BASE: 'Basic salary', UNPAID: 'Unpaid leave',
};
function proLabel(l: any): string {
  const c = String(l.code || l.kind || '').toUpperCase();
  return STAT_LABELS[c] || l.label || l.code || '—';
}

function netInWords(amount: number): string {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const below1000 = (n: number): string => {
    let s = '';
    if (n >= 100) { s += ones[Math.floor(n / 100)] + ' hundred'; n %= 100; if (n) s += ' '; }
    if (n >= 20) { s += tens[Math.floor(n / 10)]; if (n % 10) s += '-' + ones[n % 10]; }
    else if (n > 0) { s += ones[n]; }
    return s;
  };
  const whole = (n: number): string => {
    if (n === 0) return 'zero';
    const parts: string[] = [];
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    if (th) parts.push(below1000(th) + ' thousand');
    if (r) parts.push(below1000(r));
    return parts.join(' ');
  };
  const rm = Math.floor(amount);
  const sen = Math.round((amount - rm) * 100);
  let w = 'Ringgit ' + whole(rm);
  if (sen > 0) w += ' and ' + below1000(sen) + ' sen';
  w += ' only';
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function payslipPdf(year: number, month: number, staff: any, summaryRow: Row, lines: any[]) {
  return makePdfBuffer((doc) => {
    const navy = '#1e3a8a';
    const monthLabel = `${MONTH_NAMES[month - 1] || ''} ${year}`.trim();
    const lastDay = new Date(year, month, 0).getDate();
    const payPeriod = `1–${lastDay} ${monthLabel}`;
    const paymentDate = `${lastDay} ${monthLabel}`;
    const left = doc.page.margins.left;
    const rightEdge = doc.page.width - doc.page.margins.right;
    const fullW = rightEdge - left;
    const name = staff?.full_name || staff?.name || summaryRow.staff_name || summaryRow.staff_email;
    const baseWage = toNum(summaryRow.base_wage);
    const unpaidLine = lines.find((l: any) => l.kind === 'DEDUCT' && String(l.code || '').toUpperCase() === 'UNPAID');
    const daysUnpaid = baseWage > 0 && unpaidLine ? Math.round(toNum(unpaidLine.amount) / (baseWage / 26)) : 0;

    const row = (label: string, amount: string, opts: { bold?: boolean; size?: number; color?: string } = {}) => {
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 10).fillColor(opts.color ?? '#0f172a');
      const y = doc.y;
      doc.text(label, left, y, { width: fullW * 0.66 });
      const yLabelEnd = doc.y;
      doc.text(amount, left, y, { width: fullW, align: 'right' });
      doc.y = Math.max(yLabelEnd, doc.y);
      doc.fillColor('#000000');
    };
    const rule = (color = '#cbd5e1', w = 0.6) => {
      doc.moveDown(0.25);
      const y = doc.y;
      doc.moveTo(left, y).lineTo(rightEdge, y).lineWidth(w).strokeColor(color).stroke();
      doc.moveDown(0.3);
    };

    // ---- Letterhead — matches the website header: emblem + "Zordaq Auto Services" ----
    const top = doc.y;
    const logoH = 34;
    const logoW = logoH * (134 / 220); // preserve slim-emblem aspect ratio
    try { doc.image(ZORDAQ_LOGO_DATA_URI, left, top, { height: logoH }); } catch { /* logo optional */ }
    const tx = left + logoW + 9;
    doc.fillColor('#0f172a').font('Helvetica').fontSize(14).text('Zordaq ', tx, top + 3, { continued: true });
    doc.font('Helvetica-Bold').text('Auto Services');
    doc.fillColor('#64748b').font('Helvetica').fontSize(8).text('Co. Reg. KT0429673-U', tx, top + 20);
    doc.fillColor('#475569').font('Helvetica').fontSize(8).text('No. 1, Jalan Industri Putra 1, Presint 14\n62050 Putrajaya, Malaysia\n017-933 3995 · zordaqputrajaya@gmail.com', left, top + 1, { width: fullW, align: 'right' });
    const ruleY = top + logoH + 6;
    doc.moveTo(left, ruleY).lineTo(rightEdge, ruleY).lineWidth(1.4).strokeColor(navy).stroke();
    doc.y = ruleY + 12;
    doc.fillColor('#000000');

    // ---- Title + confidential ----
    const ty = doc.y;
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text('Payslip', left, ty, { continued: true });
    doc.font('Helvetica').fontSize(10).fillColor('#64748b').text(`   ·   ${monthLabel}`);
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text('Confidential', left, ty + 3, { width: fullW, align: 'right' });
    doc.y = ty + 22;

    // ---- Employee details ----
    doc.font('Helvetica').fontSize(9.5).fillColor('#0f172a').text(`Employee: ${name}${staff?.position ? '     Position: ' + staff.position : ''}`, left, doc.y);
    const ids = [staff?.nric ? `NRIC: ${staff.nric}` : '', staff?.epf_no ? `EPF no.: ${staff.epf_no}` : '', staff?.socso_no ? `SOCSO no.: ${staff.socso_no}` : ''].filter(Boolean).join('     ');
    if (ids) doc.fillColor('#64748b').text(ids, left, doc.y);
    doc.fillColor('#64748b').text(`Pay period: ${payPeriod}     Payment date: ${paymentDate}     Days unpaid: ${daysUnpaid}`, left, doc.y);
    doc.fillColor('#000000');
    rule();

    // ---- Earnings ----
    const earnLines = lines.filter((l: any) => l.kind === 'EARN');
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Earnings');
    doc.moveDown(0.15);
    let earnSum = 0;
    earnLines.forEach((l: any) => { earnSum += toNum(l.amount); row(proLabel(l), money(l.amount)); });
    if (!earnLines.length) row('—', money(0));
    rule();
    row('Gross earnings', money(earnSum), { bold: true });
    doc.moveDown(0.5);

    // ---- Deductions (employee only) ----
    const dedLines = lines.filter((l: any) => l.kind === 'DEDUCT' || (l.kind || '').startsWith('STAT_EMP_'));
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Deductions');
    doc.moveDown(0.15);
    let dedSum = 0;
    dedLines.forEach((l: any) => { dedSum += toNum(l.amount); row(proLabel(l), money(l.amount)); });
    if (!dedLines.length) row('None', money(0), { color: '#64748b' });
    rule();
    row('Total deductions', money(dedSum), { bold: true });
    doc.moveDown(0.4);

    // ---- Net pay — navy band ----
    const ny = doc.y;
    const netH = 38;
    doc.save(); doc.rect(left, ny, fullW, netH).fill(navy); doc.restore();
    doc.fillColor('#c7d2fe').font('Helvetica').fontSize(9).text('Net pay', left + 12, ny + 7, { lineBreak: false });
    doc.fillColor('#aab4e6').fontSize(8).text(netInWords(toNum(summaryRow.net_pay)), left + 12, ny + 20, { width: fullW * 0.62, lineBreak: false });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(money(summaryRow.net_pay), left, ny + 12, { width: fullW - 12, align: 'right' });
    doc.y = ny + netH + 14;
    doc.fillColor('#000000');

    // ---- Employer contributions (informational — NOT deducted from the employee) ----
    const erLines = lines.filter((l: any) => (l.kind || '').startsWith('STAT_ER_'));
    if (erLines.length) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text("Employer's contributions");
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text('Paid by the company — not deducted from your pay.').fillColor('#000000');
      doc.moveDown(0.15);
      let erSum = 0;
      erLines.forEach((l: any) => { erSum += toNum(l.amount); row(proLabel(l), money(l.amount), { size: 9 }); });
      rule();
      row('Total employer contributions', money(erSum), { bold: true, size: 9 });
      doc.moveDown(0.6);
    }

    // ---- Footer ----
    doc.font('Helvetica').fontSize(8).fillColor('#999999')
      .text(`Issued on ${paymentDate} · Computer-generated payslip; no signature required.`, left, doc.y, { width: fullW });
    doc.fillColor('#000000');
  }, { size: 'A5', margin: 28 });
}

async function uploadToStorage(path: string, bytes: Buffer, contentType = 'application/pdf') {
  const { error } = await supabaseAdmin.storage.from('payroll').upload(path, bytes, {
    cacheControl: '3600',
    upsert: true,
    contentType,
  });
  if (error) throw new Error(error.message);
  // Bucket is PRIVATE — return a short-lived signed URL instead of a public one.
  const { data: signed, error: sErr } = await supabaseAdmin.storage
    .from('payroll')
    .createSignedUrl(path, 60 * 60); // 1 hour
  if (sErr || !signed) throw new Error(sErr?.message || 'could not sign url');
  return signed.signedUrl;
}

export async function POST(req: Request) {
  try {
    // --- admin gate: this route uses the service-role key, so it MUST verify the caller ---
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const sb = createClientServer(req);
    const { data: auth, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: isAdmin } = await sb.rpc('is_admin');
    if (isAdmin !== true) {
      return NextResponse.json({ error: 'Forbidden — admins only' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'valid year & month required' }, { status: 400 });
    }

    const period = await fetchPeriod(year, month);
    if (period.status !== 'OPEN') {
      return NextResponse.json({ error: 'This period is not OPEN (already finalized?)' }, { status: 400 });
    }

    // Refresh unpaid-leave deductions from the LATEST attendance before issuing payslips, so a
    // stale snapshot (attendance edited since the last "Generate") can never be finalized.
    // The period is still OPEN here, so the write is allowed; this recomputes UNPAID + statutories
    // and leaves manual earnings/deductions untouched.
    const { error: syncErr } = await supabaseAdmin
      .schema('pay_v2')
      .rpc('sync_absent_deductions', { p_year: year, p_month: month });
    if (syncErr) throw new Error('Could not refresh attendance deductions before finalizing: ' + syncErr.message);

    const rows = await fetchSummary(year, month);
    const items = await fetchItems(period.id);
    const staffMap = await fetchStaff();

    const summaryBuf = await summaryPdf(year, month, rows);
    const basePath = `${year}-${String(month).padStart(2, '0')}`;
    const summaryPath = `${basePath}/Payroll_Summary_${basePath}.pdf`;
    const summaryUrl = await uploadToStorage(summaryPath, summaryBuf);

    const payslipResults: { email: string; url: string }[] = [];
    for (const r of rows) {
      const email = r.staff_email;
      const lines = items.filter((i: any) => i.staff_email === email);
      const staff = staffMap.get(email);
      const buf = await payslipPdf(year, month, staff, r, lines);
      const safeName = (staff?.full_name || staff?.name || email).replace(/[^\w\-]+/g, '_');
      const path = `${basePath}/payslips/${safeName}_${basePath}.pdf`;
      const url = await uploadToStorage(path, buf);
      payslipResults.push({ email, url });
    }

    await supabaseAdmin.schema('pay_v2').rpc('finalize_period', { p_year: year, p_month: month });

    return NextResponse.json({ summaryUrl, payslips: payslipResults }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}