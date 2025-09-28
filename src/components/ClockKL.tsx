'use client';

import { useEffect, useState } from 'react';

export default function ClockKL() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(now);

  const date = new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
  }).format(now);

  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'flex-end',
      gap:2, fontFamily:'system-ui'
    }}>
      <div style={{fontSize:20, fontWeight:700}}>{time}</div>
      <div style={{fontSize:12, color:'#6b7280'}}>KL — {date}</div>
    </div>
  );
}