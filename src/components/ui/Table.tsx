export function Table({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <div className={`overflow-x-auto rounded-lg border border-gray-200 ${className}`}>
    <table className="min-w-full divide-y divide-gray-200 text-sm">{children}</table>
  </div>;
}
export function THead({ children }: {children: React.ReactNode}) {
  return <thead className="bg-gray-50">{children}</thead>;
}
export function TH({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <th className={`px-3 py-2 text-left font-semibold text-gray-700 ${className}`}>{children}</th>;
}
export function TBody({ children }: {children: React.ReactNode}) {
  return <tbody className="divide-y divide-gray-200 bg-white">{children}</tbody>;
}
export function TR({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <tr className={className}>{children}</tr>;
}
export function TD({ children, className='' }: {children: React.ReactNode; className?: string}) {
  return <td className={`px-3 py-2 align-middle text-gray-900 ${className}`}>{children}</td>;
}