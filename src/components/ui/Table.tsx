export function Table({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <div className={`overflow-x-auto rounded-lg border border-line ${className}`}>
    <table className="min-w-full divide-y divide-line text-sm">{children}</table>
  </div>;
}
export function THead({ children }: {children: React.ReactNode}) {
  return <thead className="bg-ink/5">{children}</thead>;
}
export function TH({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <th className={`px-3 py-2 text-left font-semibold text-ink-2 ${className}`}>{children}</th>;
}
export function TBody({ children }: {children: React.ReactNode}) {
  return <tbody className="divide-y divide-line bg-card">{children}</tbody>;
}
export function TR({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <tr className={className}>{children}</tr>;
}
export function TD({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <td className={`px-3 py-2 align-middle text-ink ${className}`}>{children}</td>;
}