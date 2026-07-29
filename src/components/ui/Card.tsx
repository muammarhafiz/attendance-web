export function Card({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <div className={`rounded-lg border border-line bg-card shadow-sm ${className}`}>{children}</div>;
}
export function CardHeader({ title, subtitle }: {title: string; subtitle?: string}) {
  return (
    <div className="border-b border-line px-4 py-3">
      <h3 className="text-base font-semibold leading-6 text-ink">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
    </div>
  );
}
export function CardBody({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
export function CardFooter({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <div className={`border-t border-line p-3 ${className}`}>{children}</div>;
}