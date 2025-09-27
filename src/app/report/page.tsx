'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function ReportPage() {
  const [month, setMonth] = useState('01');
  const [year, setYear] = useState('2025');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('month_attendance', {
      start_date: `${year}-${month}-01`
    });
    if (error) {
      console.error(error);
      alert(error.message);
    } else {
      setData(data || []);
    }
    setLoading(false);
  };

  return (
    <main style={{ padding: 20 }}>
      <h2>Attendance Report</h2>
      <div style={{ marginBottom: 12 }}>
        <label>
          Month:{' '}
          <select value={month} onChange={e => setMonth(e.target.value)}>
            {Array.from({ length: 12 }).map((_, i) => {
              const m = (i + 1).toString().padStart(2, '0');
              return <option key={m} value={m}>{m}</option>;
            })}
          </select>
        </label>
        <label style={{ marginLeft: 10 }}>
          Year:{' '}
          <input
            type="text"
            value={year}
            onChange={e => setYear(e.target.value)}
            style={{ width: 80 }}
          />
        </label>
        <button onClick={loadReport} disabled={loading} style={{ marginLeft: 10 }}>
          {loading ? 'Loading...' : 'Generate'}
        </button>
      </div>

      {data.length > 0 ? (
        <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Staff</th>
              <th>Date</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Minutes Late</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={idx}>
                <td>{row.staff_email}</td>
                <td>{row.day}</td>
                <td>{row.checkin_time}</td>
                <td>{row.checkout_time || '-'}</td>
                <td>{row.minutes_late}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No data.</p>
      )}
    </main>
  );
}