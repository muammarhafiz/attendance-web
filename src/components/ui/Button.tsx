'use client';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  children: ReactNode;
};

export default function Button({ variant='primary', size='md', className, children, ...rest }: Props) {
  const base = 'inline-flex items-center justify-center rounded-md font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2';
  const sizes = {
    sm: 'h-9 px-3 text-sm',
    md: 'h-10 px-4 text-sm'
  };
  const variants = {
    primary: 'bg-accent text-white hover:opacity-90 focus:ring-accent',
    secondary: 'bg-ink/5 text-ink hover:bg-ink/10 focus:ring-line',
    ghost: 'bg-transparent text-ink-2 hover:bg-ink/5 focus:ring-line',
    danger: 'bg-bad text-white hover:opacity-90 focus:ring-bad',
  };
  return (
    <button className={clsx(base, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}