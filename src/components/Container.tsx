import React from 'react';

type Props = {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};

export default function Container({ children, style, className }: Props) {
  return (
    <div
      className={className}
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '16px',
        width: '100%',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
    </div>
  );
}