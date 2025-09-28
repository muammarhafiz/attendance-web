"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@supabase/supabase-js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// ✅ Corrected path here
const Map = dynamic(() => import("../components/Map"), { ssr: false });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function HomePage() {
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(dayjs().tz("Asia/Kuala_Lumpur").format("DD/MM/YYYY, h:mm:ss a"));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">
          Workshop Attendance <br />
          <span className="text-sm font-normal">{now}</span>
        </h2>
      </div>

      {/* Map section */}
      <Map />
    </div>
  );
}