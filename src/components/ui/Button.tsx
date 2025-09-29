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
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-400',
    ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 focus:ring-gray-300',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  };
  return (
    <button className={clsx(base, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}