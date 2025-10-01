

'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import PageShell from '../components/PageShell';
import { Card, CardBody } from '../components/ui/Card';

dayjs.extend(utc);
dayjs.extend(timezone);

const Map = dynamic(() => import('../components/Map'), { ssr: false });

export default function HomePage() {
  const [now, setNow] = useState<string>('');

  useEffect(() => {
    const t = setInterval(() => {
      setNow(dayjs().tz('Asia/Kuala_Lumpur').format('DD/MM/YYYY, h:mm:ss a'));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <PageShell title="Workshop Attendance" subtitle={now}>
      <Card>
        <CardBody className="p-0">
          <div className="h-[360px] w-full">
            <Map />
          </div>
        </CardBody>
      </Card>
    </PageShell>
  );
}