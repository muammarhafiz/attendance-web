// src/app/salary/page.tsx
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function SalaryHome() {
  return (
    <main style={wrap}>
      <h1 style={{ marginBottom: 8 }}>Salary</h1>
      <p style={{ color: "#6b7280", marginBottom: 16 }}>
        Payroll tools inside the attendance app. Choose a section:
      </p>

      <div style={grid}>
        <Link href="/salary/employees" style={card}>
          <div style={cardTitle}>Employees</div>
          <div style={cardBody}>
            View staff from the attendance database and edit base salary / payroll settings.
          </div>
        </Link>

        <Link href="/salary/payroll" style={card}>
          <div style={cardTitle}>Payroll</div>
          <div style={cardBody}>
            Run monthly payroll and view contributions (EPF, SOCSO, EIS).
          </div>
        </Link>
      </div>
    </main>
  );
}

const wrap: React.CSSProperties = {
  maxWidth: 960,
  margin: "0 auto",
  padding: 16,
};

const grid: React.CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
};

const card: React.CSSProperties = {
  display: "block",
  padding: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  textDecoration: "none",
  color: "#111827",
  background: "#fff",
};

const cardTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 8,
};

const cardBody: React.CSSProperties = {
  fontSize: 14,
  color: "#4b5563",
};