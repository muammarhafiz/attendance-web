export default function PageShell({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink/5">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}