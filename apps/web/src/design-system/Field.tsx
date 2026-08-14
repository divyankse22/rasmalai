import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const CONTROL =
  'w-full min-h-11 rounded-soft border border-line bg-cream px-4 text-ink ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry';

function Wrapper({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-display text-sm font-semibold text-ink">{label}</span>
      {children}
      {error && (
        <span className="text-sm text-berry" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function TextField({ label, error, className = '', ...props }: TextFieldProps) {
  return (
    <Wrapper label={label} {...(error ? { error } : {})}>
      <input className={`${CONTROL} ${className}`} aria-invalid={error ? true : undefined} {...props} />
    </Wrapper>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: readonly { value: string; label: string }[];
}

export function SelectField({ label, error, options, className = '', ...props }: SelectFieldProps) {
  return (
    <Wrapper label={label} {...(error ? { error } : {})}>
      <select className={`${CONTROL} ${className}`} aria-invalid={error ? true : undefined} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Wrapper>
  );
}
