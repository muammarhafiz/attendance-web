import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

type DebugState = {
  email: string | null;
  isAdmin: boolean | null;
  todayRowsCount: number | null;
  error: string | null;
};

export default function TodayDebugCard() {
  const supabase = createClientComponentClient();
  const [dbg, setDbg] = useState<DebugState>({
    email: null,
    isAdmin: null,
    todayRowsCount: null,
    error: null,
  });

  useEffect(() => {
    (async () => {
      try {
        // 1) who am I?
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;

        const email = userRes.user?.email ?? null;

        // 2) am I admin?
        const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin");
        if (adminErr) throw adminErr;

        // 3) how many rows does Today UI return?
        const { data: rows, error: todayErr } = await supabase.rpc("get_today_ui_v1");
        if (todayErr) throw todayErr;

        setDbg({
          email,
          isAdmin: typeof isAdmin === "boolean" ? isAdmin : null,
          todayRowsCount: Array.isArray(rows) ? rows.length : 0,
          error: null,
        });
      } catch (e: any) {
        setDbg((prev) => ({
          ...prev,
          error: e?.message ?? String(e),
        }));
      }
    })();
  }, [supabase]);

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        border: "1px solid #ddd",
        borderRadius: 8,
        background: "#fff",
        fontSize: 14,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Today Debug</div>

      <div><b>Email:</b> {dbg.email ?? "-"}</div>
      <div><b>is_admin():</b> {dbg.isAdmin === null ? "-" : String(dbg.isAdmin)}</div>
      <div><b>get_today_ui_v1 rows:</b> {dbg.todayRowsCount ?? "-"}</div>

      {dbg.error && (
        <div style={{ marginTop: 8, color: "crimson" }}>
          <b>Error:</b> {dbg.error}
        </div>
      )}
    </div>
  );
}