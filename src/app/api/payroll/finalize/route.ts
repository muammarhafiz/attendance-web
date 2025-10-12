import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';

// IMPORTANT: use a service role key on server side only
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server env
  { auth: { persistSession: false } }
);

type Row = {
  year: number; month: number;
  staff_name: string | null; staff_email: string;
  total_earn: string | number; base_wage: string | number;
  manual_deduct: string | number;
  epf_emp: string | number; socso_emp: string | number; eis_emp: string | number;
  epf_er: string | number;   socso_er: string | number;   eis_er: string | number;
  net_pay: string | number;
};

function toNum(x: string | number) {
  return typeof x === 'string' ? Number(x) : (x ?? 0);
}

async function fetchPeriod(year: number, month: number) {
  const { data, error } = await supabaseAdmin
    .schema('pay_v2').from('periods')
    .select('id, status').eq('year', year).eq('month', month)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || 'Period not found');
  return data;
}

async function fetchSummary(year: number, month: number) {
  const { data, error } = await supabaseAdmin
    .schema('pay_v2')
    .from('v_payslip_admin_summary')
    .select('*')
    .eq('year', year).eq('month', month)
    .order('staff_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
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

function makePdfBuffer(build: (doc: PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
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

    // header row
    doc.fontSize(10).text(
      ['Employee','Gross','Base','EPF(E)','SOCSO(E)','EIS(E)','Manual','Net','EPF(Er)','SOCSO(Er)','EIS(Er)']
        .join(' | ')
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

    // totals
    const sum = (k: keyof Row) => rows.reduce((a,r)=>a+toNum(r[k]),0);
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
    doc.font('Helvetica');
  });
}

function payslipPdf(year: number, month: number, staff: any, summaryRow: Row, lines: any[]) {
  return makePdfBuffer((doc) => {
    const ym = `${year}-${String(month).padStart(2,'0')}`;
    doc.fontSize(14).text('Payslip', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Period: ${ym}`);
    doc.text(`Employee: ${staff?.full_name || staff?.name || summaryRow.staff_name || summaryRow.staff_email}`);
    if (staff?.position) doc.text(`Position: ${staff.position}`);
    if (staff?.nric) doc.text(`NRIC: ${staff.nric}`);
    if (staff?.epf_no) doc.text(`EPF No: ${staff.epf_no}`);
    if (staff?.socso_no) doc.text(`SOCSO No: ${staff.socso_no}`);
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Earnings');
    doc.font('Helvetica');
    lines.filter(l => l.kind === 'EARN').forEach(l => {
      doc.text(`${l.label || l.code}  —  RM ${Number(l.amount).toFixed(2)}`);
    });

    doc.moveDown();
    doc.font('Helvetica-Bold').text('Deductions');
    doc.font('Helvetica');
    lines.filter(l => l.kind === 'DEDUCT' || (l.kind || '').startsWith('STAT_EMP_')).forEach(l => {
      doc.text(`${l.label || l.code}  —  RM ${Number(l.amount).toFixed(2)}`);
    });

    doc.moveDown();
    doc.font('Helvetica-Bold').text(`Net Pay: RM ${toNum(summaryRow.net_pay).toFixed(2)}`);
  });
}

async function uploadToStorage(path: string, bytes: Buffer, contentType = 'application/pdf') {
  const { error } = await supabaseAdmin.storage.from('payroll').upload(path, bytes, {
    cacheControl: '3600',
    upsert: true,
    contentType,
  });
  if (error) throw new Error(error.message);
  const { data: pub } = supabaseAdmin.storage.from('payroll').getPublicUrl(path);
  return pub.publicUrl;
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));
    if (!year || !month) return NextResponse.json({ error: 'year & month required' }, { status: 400 });

    const period = await fetchPeriod(year, month);
    if (period.status !== 'OPEN') {
      return NextResponse.json({ error: 'This period is not OPEN (already finalized?)' }, { status: 400 });
    }

    // pull data
    const rows = await fetchSummary(year, month);
    const items = await fetchItems(period.id);
    const staffMap = await fetchStaff();

    // build & upload summary
    const summaryBuf = await summaryPdf(year, month, rows);
    const basePath = `${year}-${String(month).padStart(2,'0')}`;
    const summaryPath = `${basePath}/Payroll_Summary_${basePath}.pdf`;
    const summaryUrl = await uploadToStorage(summaryPath, summaryBuf);

    // per-employee payslips
    const payslipResults: { email: string; url: string }[] = [];
    for (const r of rows) {
      const email = r.staff_email;
      const lines = items.filter((i) => i.staff_email === email);
      const staff = staffMap.get(email);
      const buf = await payslipPdf(year, month, staff, r, lines);
      const safeName = (staff?.full_name || staff?.name || email).replace(/[^\w\-]+/g, '_');
      const path = `${basePath}/payslips/${safeName}_${basePath}.pdf`;
      const url = await uploadToStorage(path, buf);
      payslipResults.push({ email, url });
    }

    // lock the period
    await supabaseAdmin.rpc('pay_v2.finalize_period', { p_year: year, p_month: month });

    return NextResponse.json({ summaryUrl, payslips: payslipResults }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}