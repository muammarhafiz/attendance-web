// src/app/api/cash-report/route.ts
// Month-end Cash Book report as a PDF. GET /api/cash-report?month=YYYY-MM
// Returns application/pdf: day-by-day bill breakdown vs Niagawan cash book, with month totals.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';
// @ts-ignore  // types provided by src/types/pdfkit-standalone.d.ts
import PDFDocument from 'pdfkit/js/pdfkit.standalone.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const DENOMS = [100, 50, 20, 10, 5, 1] as const;
type CountRow = { day: string; n100: number; n50: number; n20: number; n10: number; n5: number; n1: number; counted_total: number };
type DailyRow = { day: string; cash_in: number | null; cash_out: number | null };

function makePdfBuffer(build: (doc: any) => void, opts: any = { size: 'A4', margin: 36 }): Promise<Buffer> {
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

const money = (n: number) =>
  'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n: number) => Number(n || 0).toLocaleString('en-MY');
const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
const dayCell = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    '  ' +
    d.toLocaleDateString('en-GB', { weekday: 'short' })
  );
};

export async function GET(req: Request) {
  try {
    // --- auth: signed-in staff with workshop access (same gate as the Cash Book page) ---
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !auth?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: ok } = await sb.rpc('can_access', { p_feature: 'workshop' });
    if (ok !== true) return NextResponse.json({ error: 'This report is for supervisors.' }, { status: 403 });

    // --- month param (YYYY-MM), default to the Malaysia-current month ---
    const url = new URL(req.url);
    let month = (url.searchParams.get('month') || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      const kl = new Date(Date.now() + 8 * 3600e3);
      month = kl.toISOString().slice(0, 7);
    }
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`;
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // --- data (service role; access already verified above) ---
    const { data: counts } = await admin
      .from('niagawan_cash_count')
      .select('day,n100,n50,n20,n10,n5,n1,counted_total')
      .gte('day', first)
      .lt('day', nextMonth)
      .order('day');
    const { data: daily } = await admin
      .from('niagawan_cash_daily')
      .select('day,cash_in,cash_out')
      .gte('day', first)
      .lt('day', nextMonth);

    const rows = (counts ?? []) as CountRow[];
    const niaMap = new Map<string, number>();
    for (const d of (daily ?? []) as DailyRow[]) niaMap.set(d.day, (d.cash_in ?? 0) - (d.cash_out ?? 0));

    // totals
    const tot = [0, 0, 0, 0, 0, 0];
    let tCount = 0,
      tNia = 0;
    for (const r of rows) {
      [r.n100, r.n50, r.n20, r.n10, r.n5, r.n1].forEach((c, i) => (tot[i] += c || 0));
      tCount += Number(r.counted_total) || 0;
      tNia += niaMap.get(r.day) ?? 0;
    }
    const tVar = tCount - tNia;
    const flagged = rows.filter((r) => Math.abs((Number(r.counted_total) || 0) - (niaMap.get(r.day) ?? 0)) >= 0.01).length;

    const INK = '#1b2430',
      MUT = '#6b7480',
      LINE = '#d3d8de',
      TEAL = '#0e5a63',
      GOOD = '#15803d',
      OVER = '#b45309',
      SHORT = '#b91c1c';

    const pdf = await makePdfBuffer((doc) => {
      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const fullW = right - left;

      // header
      doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(9).text('MONTH-END CASH RECONCILIATION', left, left, { characterSpacing: 1 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('Cash Reconciliation', left, doc.y + 2);
      doc.fillColor(MUT).font('Helvetica').fontSize(11).text(`${monthName(month)}  ·  ${rows.length} trading days  ·  ZORDAQ workshop`, left, doc.y + 1);
      doc.moveDown(0.6);
      doc.rect(left, doc.y, 46, 3).fill(TEAL);
      doc.moveDown(0.8);

      // summary line
      let sy = doc.y;
      const col = fullW / 3;
      const stat = (x: number, k: string, v: string, color: string) => {
        doc.fillColor(MUT).font('Helvetica').fontSize(8).text(k.toUpperCase(), x, sy, { width: col - 10, characterSpacing: 0.5 });
        doc.fillColor(color).font('Helvetica-Bold').fontSize(15).text(v, x, sy + 11, { width: col - 10 });
      };
      stat(left, 'Counted — physical', money(tCount), INK);
      stat(left + col, 'Niagawan cash book', money(tNia), INK);
      stat(left + col * 2, 'Variance', (tVar >= 0 ? '+' : '') + money(tVar), Math.abs(tVar) < 0.01 ? GOOD : tVar > 0 ? OVER : SHORT);
      doc.y = sy + 34;
      if (flagged > 0) {
        doc.fillColor(OVER).font('Helvetica').fontSize(8.5).text(`${flagged} day${flagged !== 1 ? 's' : ''} to review (counted differs from Niagawan).`, left, doc.y);
      }
      doc.moveDown(0.5);

      // collect-this
      doc.fillColor(MUT).font('Helvetica').fontSize(8).text('NOTES TO COLLECT THIS MONTH — COUNT THE STACK AGAINST THIS', left, doc.y, { characterSpacing: 0.5 });
      const collect = DENOMS.map((d, i) => (tot[i] > 0 ? `${tot[i]} × RM${d}` : null)).filter(Boolean).join('     ');
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(collect || '—', left, doc.y + 3, { width: fullW });
      doc.fillColor(MUT).font('Helvetica').fontSize(9).text(`= ${money(tCount)} in notes`, left, doc.y + 2);
      doc.moveDown(0.8);

      // --- table ---
      const cols = [
        { t: 'Date', w: 74, a: 'left' as const },
        { t: '×100', w: 38, a: 'right' as const },
        { t: '×50', w: 38, a: 'right' as const },
        { t: '×20', w: 38, a: 'right' as const },
        { t: '×10', w: 38, a: 'right' as const },
        { t: '×5', w: 32, a: 'right' as const },
        { t: '×1', w: 32, a: 'right' as const },
        { t: 'Counted', w: 75, a: 'right' as const },
        { t: 'Niagawan', w: 75, a: 'right' as const },
        { t: 'Variance', w: 65, a: 'right' as const },
      ];
      const xs: number[] = [];
      let acc = left;
      for (const c of cols) { xs.push(acc); acc += c.w; }
      const rowH = 16;

      const drawHeader = (yy: number) => {
        doc.rect(left, yy - 2, fullW, rowH).fill('#f0f2f4');
        doc.fillColor(MUT).font('Helvetica-Bold').fontSize(7.5);
        cols.forEach((c, i) => doc.text(c.t.toUpperCase(), xs[i] + (c.a === 'right' ? 0 : 2), yy + 3, { width: c.w - 4, align: c.a, characterSpacing: 0.3 }));
        return yy + rowH;
      };

      let ty = drawHeader(doc.y);

      const cell = (txt: string, i: number, yy: number, color: string, bold = false) => {
        doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(txt, xs[i] + (cols[i].a === 'right' ? 0 : 2), yy + 3, { width: cols[i].w - 4, align: cols[i].a, lineBreak: false });
      };

      for (const r of rows) {
        if (ty + rowH > doc.page.height - doc.page.margins.bottom - 40) { doc.addPage(); ty = drawHeader(doc.page.margins.top); }
        const nia = niaMap.get(r.day) ?? 0;
        const hasNia = niaMap.has(r.day);
        const v = (Number(r.counted_total) || 0) - nia;
        const mism = Math.abs(v) >= 0.01;
        if (mism) { doc.rect(left, ty - 2, fullW, rowH).fill('#fbf0e2'); }
        cell(dayCell(r.day), 0, ty, mism ? OVER : INK, true);
        const cs = [r.n100, r.n50, r.n20, r.n10, r.n5, r.n1];
        cs.forEach((c, i) => cell(c ? String(c) : '·', i + 1, ty, c ? INK : '#c5cad0'));
        cell(intf(Number(r.counted_total) || 0), 7, ty, INK, true);
        cell(hasNia ? intf(nia) : (Number(r.counted_total) ? '—' : '0'), 8, ty, MUT);
        const vc = Math.abs(v) < 0.01 ? GOOD : v > 0 ? OVER : SHORT;
        const vt = Math.abs(v) < 0.01 ? 'OK' : (v > 0 ? '+' : '') + intf(v);
        cell(vt, 9, ty, vc, true);
        doc.strokeColor('#f0f1f3').lineWidth(0.5).moveTo(left, ty + rowH - 2).lineTo(right, ty + rowH - 2).stroke();
        ty += rowH;
      }

      // totals row
      if (ty + rowH > doc.page.height - doc.page.margins.bottom - 40) { doc.addPage(); ty = doc.page.margins.top; }
      doc.strokeColor(LINE).lineWidth(1.4).moveTo(left, ty - 1).lineTo(right, ty - 1).stroke();
      ty += 4;
      cell('MONTH TOTAL', 0, ty, MUT, true);
      tot.forEach((t, i) => cell(String(t), i + 1, ty, INK, true));
      cell(intf(tCount), 7, ty, INK, true);
      cell(intf(tNia), 8, ty, INK, true);
      cell(Math.abs(tVar) < 0.01 ? 'OK' : (tVar > 0 ? '+' : '') + intf(tVar), 9, ty, Math.abs(tVar) < 0.01 ? GOOD : tVar > 0 ? OVER : SHORT, true);
      ty += rowH + 10;

      // footer
      const genAt = new Date(Date.now() + 8 * 3600e3).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      doc.fillColor('#9aa2ad').font('Helvetica').fontSize(7.5).text(`Generated ${genAt} (MYT) · ZORDAQ cash book · computer-generated, no signature required.`, left, Math.min(ty, doc.page.height - doc.page.margins.bottom - 12), { width: fullW });
    });

    const fname = `cash-report-${month}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fname}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
