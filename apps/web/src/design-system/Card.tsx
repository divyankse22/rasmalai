import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className = '', ...props }: CardProps) {
  return (
    <div
      className={[
        'rounded-card border border-line bg-shell p-6 shadow-soft',
        className,
      ].join(' ')}
      {...props}
    />
  );
}
