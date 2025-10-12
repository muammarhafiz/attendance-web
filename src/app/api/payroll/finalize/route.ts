import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// Helper to stream a pdfkit doc into a Buffer
function makePdfBuffer(build: (doc: InstanceType<typeof PDFDocument>) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));
    if (!year || !month) {
      return NextResponse.json({ error: 'Missing year/month' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Supabase env vars missing' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    // Check if period is OPEN
    const { data: period } = await supabase
      .schema('pay_v2')
      .from('periods')
      .select('id,status')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();
    if (!period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 });
    }
    if (period.status !== 'OPEN') {
      return NextResponse.json({ error: 'Period not OPEN (already locked)' }, { status: 400 });
    }

    // Load payroll summary data
    const { data: rows, error: rowsErr } = await supabase
      .schema('pay_v2')
      .from('v_payslip_admin_summary')
      .select('*')
      .eq('year', year)
      .eq('month', month);
    if (rowsErr || !rows?.length) {
      return NextResponse.json({ error: 'No data found for period' }, { status: 404 });
    }

    // Build summary PDF
    const summaryBuffer = await makePdfBuffer((doc) => {
      doc.fontSize(14).text(`Payroll Summary ${year}-${month}`, { align: 'center' });
      doc.moveDown();
      rows.forEach((r: any) => {
        doc.fontSize(10).text(`${r.staff_name || r.staff_email} — Net RM ${r.net_pay}`);
      });
    });

    const folder = `${year}-${String(month).padStart(2, '0')}`;
    const summaryPath = `${folder}/Payroll_Summary_${folder}.pdf`;

    const uploadSummary = await supabase.storage
      .from('payroll')
      .upload(summaryPath, summaryBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });
    if (uploadSummary.error) throw uploadSummary.error;

    const { data: summaryPublic } = supabase
      .storage
      .from('payroll')
      .getPublicUrl(summaryPath);

    // Build per-staff payslips
    const payslips: any[] = [];
    for (const r of rows) {
      const slipBuf = await makePdfBuffer((doc) => {
        doc.fontSize(14).text(`Payslip ${year}-${month}`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(10)
          .text(`Name: ${r.staff_name || r.staff_email}`)
          .text(`Email: ${r.staff_email}`)
          .text(`Gross: RM ${r.total_earn}`)
          .text(`Base: RM ${r.base_wage}`)
          .text(`Net Pay: RM ${r.net_pay}`);
      });

      const safeName = (r.staff_name || r.staff_email || 'unknown').replace(/[^a-z0-9]/gi, '_');
      const slipPath = `${folder}/payslips/${safeName}_${folder}.pdf`;
      const up = await supabase.storage.from('payroll').upload(slipPath, slipBuf, {
        contentType: 'application/pdf',
        upsert: true
      });
      if (!up.error) {
        const { data: slipPublic } = supabase.storage.from('payroll').getPublicUrl(slipPath);
        payslips.push({ email: r.staff_email, url: slipPublic.publicUrl });
      }
    }

    // Lock the period
    await supabase.rpc('finalize_period', { p_year: year, p_month: month });

    return NextResponse.json({
      summaryUrl: summaryPublic.publicUrl,
      payslips,
      message: 'Finalized successfully'
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message ?? e }, { status: 500 });
  }
}

// Allow GET for convenience (so you can open it in Safari)
export async function GET(req: Request) {
  return POST(req);
}