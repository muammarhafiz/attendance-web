import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';
// @ts-ignore  // types provided by src/types/pdfkit-standalone.d.ts
import PDFDocument from 'pdfkit/js/pdfkit.standalone.js';

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
function makePdfBuffer(build: (doc: any) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36 });
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

function payslipPdf(year: number, month: number, staff: any, summaryRow: Row, lines: any[]) {
  return makePdfBuffer((doc) => {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const monthLabel = `${MONTH_NAMES[month - 1] || ''} ${year}`.trim();
    const left = doc.page.margins.left;
    const rightEdge = doc.page.width - doc.page.margins.right;
    const fullW = rightEdge - left;

    // label on the left, amount right-aligned on the same line
    const row = (label: string, amount: string, opts: { bold?: boolean; size?: number; color?: string } = {}) => {
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 10).fillColor(opts.color ?? '#000');
      const y = doc.y;
      doc.text(label, left, y, { width: fullW * 0.66 });
      const yLabelEnd = doc.y;
      doc.text(amount, left, y, { width: fullW, align: 'right' });
      doc.y = Math.max(yLabelEnd, doc.y);
    };
    const rule = (color = '#cccccc', w = 0.6) => {
      doc.moveDown(0.25);
      const y = doc.y;
      doc.moveTo(left, y).lineTo(rightEdge, y).lineWidth(w).strokeColor(color).stroke();
      doc.moveDown(0.3);
    };

    // ---- Letterhead ----
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a').text('ZORDAQ AUTO SERVICES', left, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor('#666').text('No. 1, Jalan Industri Putra 1, Presint 14, 62050 Putrajaya');
    rule('#0f172a', 1.2);

    // ---- Title + employee ----
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(`Payslip — ${monthLabel}`);
    doc.moveDown(0.4);
    const name = staff?.full_name || staff?.name || summaryRow.staff_name || summaryRow.staff_email;
    doc.font('Helvetica').fontSize(10).fillColor('#000').text(`Employee: ${name}`);
    if (staff?.position) doc.text(`Position: ${staff.position}`);
    const idLine = [
      staff?.nric ? `NRIC: ${staff.nric}` : '',
      staff?.epf_no ? `EPF: ${staff.epf_no}` : '',
      staff?.socso_no ? `SOCSO: ${staff.socso_no}` : '',
    ].filter(Boolean).join('     ');
    if (idLine) doc.fontSize(9).fillColor('#666').text(idLine).fillColor('#000');
    doc.moveDown(0.5);

    // ---- Earnings ----
    const earnLines = lines.filter((l: any) => l.kind === 'EARN');
    doc.font('Helvetica-Bold').fontSize(11).text('Earnings');
    doc.moveDown(0.15);
    let earnSum = 0;
    earnLines.forEach((l: any) => { earnSum += toNum(l.amount); row(l.label || l.code, money(l.amount)); });
    if (!earnLines.length) row('—', money(0));
    rule();
    row('Gross earnings', money(earnSum), { bold: true });
    doc.moveDown(0.5);

    // ---- Deductions (employee only) ----
    const dedLines = lines.filter((l: any) => l.kind === 'DEDUCT' || (l.kind || '').startsWith('STAT_EMP_'));
    doc.font('Helvetica-Bold').fontSize(11).text('Deductions');
    doc.moveDown(0.15);
    let dedSum = 0;
    dedLines.forEach((l: any) => { dedSum += toNum(l.amount); row(l.label || l.code, money(l.amount)); });
    if (!dedLines.length) row('None', money(0), { color: '#666' });
    rule();
    row('Total deductions', money(dedSum), { bold: true });
    doc.moveDown(0.5);

    // ---- Net pay ----
    rule('#0f172a', 1);
    row('NET PAY', money(summaryRow.net_pay), { bold: true, size: 13, color: '#0f172a' });
    doc.moveDown(0.8);

    // ---- Employer contributions (informational — NOT deducted from the employee) ----
    const erLines = lines.filter((l: any) => (l.kind || '').startsWith('STAT_ER_'));
    if (erLines.length) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text("Employer's Contributions");
      doc.font('Helvetica').fontSize(8).fillColor('#888').text('Paid by the company on top of your pay — not deducted from you.').fillColor('#000');
      doc.moveDown(0.15);
      let erSum = 0;
      erLines.forEach((l: any) => { erSum += toNum(l.amount); row(l.label || l.code, money(l.amount), { size: 9 }); });
      rule();
      row('Total employer contributions', money(erSum), { bold: true, size: 9 });
      doc.moveDown(0.6);
    }

    // ---- Footer ----
    doc.font('Helvetica').fontSize(8).fillColor('#999')
      .text(`Generated for ${ym} · Computer-generated payslip; no signature required.`, left, doc.y, { width: fullW });
    doc.fillColor('#000');
  });
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