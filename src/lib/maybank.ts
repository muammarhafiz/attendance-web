// Deterministic parser for a Maybank (SME/current-account) PDF statement's transaction table, plus a
// simple date+amount reconciliation against Niagawan transfer receipts. Amounts are read exactly from
// the statement's text layer (no AI), and the running-balance chain is used to self-verify the parse.

export type Txn = {
  date: string; // YYYY-MM-DD (entry date)
  desc: string; // transaction description (e.g. "TRANSFER TO A/C")
  detail: string; // 2nd-line detail (sender / reference), for display only
  amount: number;
  dir: 'in' | 'out';
  balance: number;
  type: 'card' | 'qr_tng' | 'transfer_in' | 'interbank_in' | 'out' | 'other_in';
};

export type ParsedStatement = {
  year: number | null;
  begin: number;
  endBal: number;
  totDr: number;
  totCr: number;
  rows: Txn[];
  valid: { chainOk: boolean; endMatch: boolean; crMatch: boolean; drMatch: boolean; ok: boolean };
};

function classify(desc: string, detail: string, dir: 'in' | 'out'): Txn['type'] {
  const d = desc.toUpperCase();
  if (/CARD SALES/.test(d)) return 'card';
  if (/TNG DIGITAL/.test((detail || '').toUpperCase())) return 'qr_tng';
  if (/TRANSFER TO A\/C/.test(d) && dir === 'in') return 'transfer_in';
  if (/INTER-BANK PAYMENT INTO A\/C/.test(d) && dir === 'in') return 'interbank_in';
  if (dir === 'out') return 'out';
  return 'other_in';
}

const money = (s: string) => Number(String(s).replace(/,/g, ''));

export function parseMaybank(text: string): ParsedStatement {
  const sd = text.match(/STATEMENT DATE\s*:\s*(\d{2})\/(\d{2})\/(\d{2})/);
  const year = sd ? 2000 + Number(sd[3]) : null;
  const stmtMonth = sd ? Number(sd[2]) : null;
  const begin = money((text.match(/BEGINNING BALANCE\s+([\d,]+\.\d{2})/) || [])[1] || 'NaN');
  const endBal = money((text.match(/ENDING BALANCE\s*:\s*([\d,]+\.\d{2})/) || [])[1] || 'NaN');
  const totDr = money((text.match(/TOTAL DEBIT\s*:\s*([\d,]+\.\d{2})/) || [])[1] || 'NaN');
  const totCr = money((text.match(/TOTAL CREDIT\s*:\s*([\d,]+\.\d{2})/) || [])[1] || 'NaN');

  // Strip the repeated per-page footer + column header. Without this, the statement date "30/06/26" in
  // each footer is matched as a bogus "06/26" transaction whose greedy description swallows the next
  // real transaction's amount — corrupting both. (Header/footer values above are read from the full text.)
  const body = text.replace(/Malayan Banking Berhad[\s\S]*?STATEMENT BALANCE/g, ' ');

  // <entry DD/MM> <description> <amount±> <balance>
  const re = /(\d{2})\/(\d{2})\s+(.+?)\s+([\d,]*\.\d{2})([+-])\s+([\d,]+\.\d{2})/g;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) matches.push(m);

  const rows: Txn[] = [];
  for (let i = 0; i < matches.length; i++) {
    const g = matches[i];
    const full = g[0], dd = g[1], mm = g[2], desc = g[3], amtStr = g[4], sign = g[5], balStr = g[6];
    const dN = Number(dd), mN = Number(mm);
    // A real transaction date is DD/MM (day 1-31, month 1-12). Skip spurious matches — a reference or
    // a differently-spaced fragment (e.g. "06/26") can otherwise look like a row and yield a bad date.
    if (mN < 1 || mN > 12 || dN < 1 || dN > 31) continue;
    let y = year ?? 0;
    if (year && stmtMonth && mN > stmtMonth) y = year - 1; // entry dated in the prior year (Dec on a Jan statement)
    const start = g.index + full.length;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : body.length;
    let detail = body.slice(start, nextStart).split(/Malayan Banking Berhad|URUSNIAGA AKAUN|ENDING BALANCE|TOTAL DEBIT|Perhatian/)[0];
    detail = detail.replace(/\s+/g, ' ').trim();
    const dir: 'in' | 'out' = sign === '+' ? 'in' : 'out';
    const cleanDesc = desc.replace(/\s+/g, ' ').trim();
    rows.push({ date: `${y}-${mm}-${dd}`, desc: cleanDesc, detail, amount: money(amtStr), dir, balance: money(balStr), type: classify(cleanDesc, detail, dir) });
  }

  // self-verify: running balance chain + credit/debit totals
  let bal = begin, chainOk = true, sumIn = 0, sumOut = 0;
  for (const r of rows) {
    bal = Math.round((bal + (r.dir === 'in' ? r.amount : -r.amount)) * 100) / 100;
    if (Math.abs(bal - r.balance) > 0.001) chainOk = false;
    if (r.dir === 'in') sumIn += r.amount; else sumOut += r.amount;
  }
  const endMatch = Number.isFinite(endBal) && Math.abs(bal - endBal) < 0.01;
  const crMatch = Number.isFinite(totCr) && Math.abs(Math.round(sumIn * 100) / 100 - totCr) < 0.01;
  const drMatch = Number.isFinite(totDr) && Math.abs(Math.round(sumOut * 100) / 100 - totDr) < 0.01;
  const ok = rows.length > 0 && chainOk && endMatch && crMatch && drMatch;

  return { year, begin, endBal, totDr, totCr, rows, valid: { chainOk, endMatch, crMatch, drMatch, ok } };
}

// The incoming customer transfers we reconcile (money in via transfer, excluding card + QR/TNG settlements).
export function bankTransfersIn(rows: Txn[]): Txn[] {
  return rows.filter((r) => r.type === 'transfer_in' || r.type === 'interbank_in');
}

export type NiaTransfer = { day: string; amount: number; descp: string | null };
// A dated money-in row from an external statement (bank transfer line OR a QR settlement line).
export type Deposit = { date: string; amount: number; detail: string };
export type ReconRow = { day: string; amount: number; descp: string | null; bankDate?: string; bankDetail?: string };
export type ReconResult = {
  matched: ReconRow[]; // Niagawan transfer found in the bank
  niaOnly: ReconRow[]; // recorded in Niagawan but NOT found in the bank ("not received")
  bankOnly: { date: string; amount: number; detail: string }[]; // in the bank but not recorded in Niagawan
};

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

// Primary direction: for each Niagawan receipt (date+amount), is there a matching statement deposit
// within +/- windowDays? Greedy one-to-one so two same-amount receipts need two matching deposits.
// Used for both bank transfers and QR settlements (the `bank` arg is any dated deposit list).
export function reconcile(nia: NiaTransfer[], bank: Deposit[], windowDays = 3): ReconResult {
  const bankLeft = bank.map((b) => ({ date: b.date, amount: b.amount, detail: b.detail, used: false }));
  const matched: ReconRow[] = [];
  const niaOnly: ReconRow[] = [];
  for (const n of [...nia].sort((a, b) => a.day.localeCompare(b.day))) {
    let bi = -1, best = Infinity;
    for (let i = 0; i < bankLeft.length; i++) {
      const b = bankLeft[i];
      if (b.used || Math.abs(b.amount - n.amount) > 0.01) continue;
      const d = Math.abs(dayDiff(b.date, n.day));
      if (d <= windowDays && d < best) { best = d; bi = i; }
    }
    if (bi >= 0) { bankLeft[bi].used = true; matched.push({ day: n.day, amount: n.amount, descp: n.descp, bankDate: bankLeft[bi].date, bankDetail: bankLeft[bi].detail }); }
    else niaOnly.push({ day: n.day, amount: n.amount, descp: n.descp });
  }
  const bankOnly = bankLeft.filter((b) => !b.used).map((b) => ({ date: b.date, amount: b.amount, detail: b.detail }));
  return { matched, niaOnly, bankOnly };
}

// ---- DuitNow QR merchant settlement report (CSV) ----
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export type QrParse = { rows: Deposit[]; footerTotal: number | null; sum: number; ok: boolean };

// Columns: 0 No, 1 Settlement Date, 2 Transaction Datetime (DD/MM/YYYY HH:MM:SS), ..., 7 Transaction Type,
// 8 Transaction Amount, ..., 12 Payment Details. We key on the TRANSACTION date (when the customer paid =
// the day Niagawan records it), not the T+1 settlement date. A trailing "Total:" row validates the parse.
export function parseQrCsv(text: string): QrParse {
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => /^No,\s*Settlement Date/i.test(l));
  const rows: Deposit[] = [];
  let footerTotal: number | null = null;
  if (hi >= 0) {
    for (let i = hi + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const c = parseCsvLine(line);
      if (/total/i.test(c[7] || '')) { const t = Number(c[8]); if (Number.isFinite(t)) footerTotal = t; continue; }
      const dm = String(c[2] || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const amt = Number(c[8]);
      if (!dm || !Number.isFinite(amt)) continue;
      const kind = (c[7] || '').replace(/^DUITNOW_QR_?/i, '') || 'QR';
      const note = (c[12] || '').trim();
      rows.push({ date: `${dm[3]}-${dm[2]}-${dm[1]}`, amount: amt, detail: note ? `${kind} · ${note}` : kind });
    }
  }
  const sum = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const ok = rows.length > 0 && footerTotal != null && Math.abs(sum - footerTotal) < 0.01;
  return { rows, footerTotal, sum, ok };
}
