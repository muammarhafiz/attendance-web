import React from 'react';

type Props = {
  children: React.ReactNode;
  color?: 'gray' | 'blue' | 'green' | 'yellow' | 'red';
  className?: string;
};

const palette: Record<
  NonNullable<Props['color']>,
  { bg: string; fg: string; border: string }
> = {
  gray:   { bg: '#f3f4f6', fg: '#111827', border: '#e5e7eb' }, // neutral
  blue:   { bg: '#eff6ff', fg: '#1e3a8a', border: '#bfdbfe' }, // info
  green:  { bg: '#ecfdf5', fg: '#065f46', border: '#bbf7d0' }, // success
  yellow: { bg: '#fffbeb', fg: '#92400e', border: '#fde68a' }, // warning
  red:    { bg: '#fef2f2', fg: '#991b1b', border: '#fecaca' }, // danger
};

export default function Badge({
  children,
  color = 'gray',
  className,
}: Props) {
  const c = palette[color] ?? palette.gray;
  const style: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 12,
    lineHeight: '18px',
    border: `1px solid ${c.border}`,
    background: c.bg,
    color: c.fg,
    whiteSpace: 'nowrap',
  };

  // We keep className passthrough so you can still add custom classes if needed.
  return (
    <span style={style} className={className}>
      {children}
    </span>
  );
}