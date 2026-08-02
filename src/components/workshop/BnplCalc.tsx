'use client';
// Cashier tool (Workshop → BNPL fee): type a customer's bill, see how much the BNPL service takes
// and what the shop actually receives. Uses each service's own fee (from bnpl_fee_config).
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
  const g = Number(amt) || 0;
  const flat = p ? Number(p.flat_fee) : 0;
  const mdrAmt = p ? g * (Number(p.mdr_pct) / 100) : 0;
  const mdrSst = p ? mdrAmt * (Number(p.sst_pct) / 100) : 0;
  const flatSst = p ? flat * (Number(p.sst_pct) / 100) : 0;
  const fee = mdrAmt + mdrSst + flat + flatSst;
  const net = g - fee;
  const name = p?.display_name || 'BNPL';

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-card bg-card shadow-card p-4">
        <div className="mb-1 text-base font-semibold text-ink">BNPL fee calculator</div>
        <p className="mb-3 text-[13px] text-ink-2">Type the customer&rsquo;s bill to see how much {name} takes and what the shop actually receives.</p>

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

        {p && g > 0 && (
          <div className="mt-4 space-y-1.5 text-sm">
            <Row k={`Commission (${p.mdr_pct}%)`} v={rm(mdrAmt)} />
            <Row k={`SST on commission (${p.sst_pct}%)`} v={rm(mdrSst)} />
            <Row k="Flat fee" v={rm(flat)} />
            <Row k={`SST on flat (${p.sst_pct}%)`} v={rm(flatSst)} />
            <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold text-bad"><span>{name} takes</span><span>{rm(fee)}</span></div>
            <div className="flex justify-between text-xl font-bold text-good"><span>Shop receives</span><span>{rm(net)}</span></div>
          </div>
        )}

        {p && (
          <p className="mt-3 text-[11px] text-ink-3">{name} fee: {p.mdr_pct}% + RM{flat} (+{p.sst_pct}% SST). An estimate — the exact fee is on {name}&rsquo;s settlement report.</p>
        )}
      </div>
    </div>
  );
}
