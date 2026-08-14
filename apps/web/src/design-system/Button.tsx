import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'soft' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-berry text-shell active:bg-berry-deep shadow-soft',
  soft: 'bg-blush text-ink active:bg-lilac',
  ghost: 'bg-transparent text-muted active:bg-blush',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

/**
 * Every interactive control in Rasmalai goes through here.
 *
 * `min-h-11` keeps the tap target at 44px and the styling reacts to `:active` rather than `:hover`,
 * because `docs/06_UX_AND_STATE_FLOWS.md` forbids hover-only interaction on a phone-first product.
 */
export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-pill px-6',
        'font-display text-base font-semibold',
        'transition-transform duration-quick ease-bounce active:scale-95',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        VARIANTS[variant],
        className,
      ].join(' ')}
      {...props}
    />
  );
}
