'use client';
// Cashier tool (Workshop → BNPL fee): type the customer's bill and see how much to ADD when they
// pay by a BNPL service, so that after the service takes its cut the shop still receives the full
// bill. Gross-up per service (bnpl_fee_config): to net B you must charge
//   G = (B + flat·(1+sst)) / (1 − mdr·(1+sst))
// NOT B + fee(B) — the fee is charged on the grossed-up total, so a plain markup under-recovers.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Prov = { provider: string; display_name: string; mdr_pct: number; flat_fee: number; sst_pct: number };

const rm = (n: number) => `RM${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-ink-2">{k}</span><span className="font-medium text-ink-2">{v}</span></div>;
}

export default function BnplCalc() {
  const [provs, setProvs] = useState<Prov[]>([]);
  const [sel, setSel] = useState('');
  const [amt, setAmt] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('bnpl_fee_config');
      const list = (data ?? []) as Prov[];
      setProvs(list);
      if (list[0]) setSel(list[0].provider);
    })();
  }, []);

  const p = provs.find((x) => x.provider === sel);
  const bill = Number(amt) || 0;                     // what the shop wants to actually receive
  const mdr = p ? Number(p.mdr_pct) / 100 : 0;
  const sst = p ? Number(p.sst_pct) / 100 : 0;
  const flat = p ? Number(p.flat_fee) : 0;
  const name = p?.display_name || 'BNPL';

  // Gross-up so the shop nets the full bill: charge G where G − [G·mdr·(1+sst) + flat·(1+sst)] = bill.
  const denom = 1 - mdr * (1 + sst);
  const chargeExact = denom > 0 ? (bill + flat * (1 + sst)) / denom : 0;
  const charge = Math.round(chargeExact * 100) / 100;         // to the cent
  const fee = Math.round((charge * mdr * (1 + sst) + flat * (1 + sst)) * 100) / 100;
  const add = Math.round((charge - bill) * 100) / 100;        // the surcharge to add to the bill
  const net = Math.round((charge - fee) * 100) / 100;         // what the shop actually keeps (≈ bill)

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-card bg-card shadow-card p-4">
        <div className="mb-1 text-base font-semibold text-ink">BNPL fee calculator</div>
        <p className="mb-3 text-[13px] text-ink-2">Type the customer&rsquo;s bill to see how much to <b>add</b> when they pay by {name}, so that after {name}&rsquo;s cut the shop still receives the full bill.</p>

        {provs.length > 1 && (
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-ink-2">Service</span>
            <select value={sel} onChange={(e) => setSel(e.target.value)} className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm">
              {provs.map((x) => <option key={x.provider} value={x.provider}>{x.display_name}</option>)}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2 text-base">
          <span className="text-ink-2">Bill RM</span>
          <input
            type="number" inputMode="decimal" step="0.01" min="0" value={amt}
            onChange={(e) => setAmt(e.target.value)} placeholder="200.00"
            className="w-40 rounded-lg border border-line px-3 py-2 text-lg font-semibold"
          />
        </div>

        {p && bill > 0 && (
          <div className="mt-4 space-y-1.5 text-sm">
            <Row k="Your bill" v={rm(bill)} />
            <Row k={`Add for ${name}`} v={`+ ${rm(add)}`} />
            <div className="mt-1 flex justify-between border-t border-line pt-2 text-xl font-bold text-ink"><span>Charge customer</span><span>{rm(charge)}</span></div>
            <div className="mt-2 flex justify-between text-[13px]"><span className="text-ink-3">{name} takes</span><span className="text-bad">− {rm(fee)}</span></div>
            <div className="flex justify-between text-base font-semibold text-good"><span>Shop receives</span><span>{rm(net)}</span></div>
          </div>
        )}

        {p && (
          <p className="mt-3 text-[11px] text-ink-3">{name} fee: {p.mdr_pct}% + RM{flat} (+{p.sst_pct}% SST), charged on the total the customer pays. An estimate — the exact fee is on {name}&rsquo;s settlement report.</p>
        )}
      </div>
    </div>
  );
}
