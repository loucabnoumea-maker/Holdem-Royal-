import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl bg-black/35 p-1 ring-1 ring-brass-400/15">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`font-ui flex-1 rounded-lg px-2 py-2 text-[15px] font-semibold transition ${
            value === o.value ? 'btn-brass shadow-md' : 'text-ivory/55 hover:text-ivory'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  format = (v: number) => String(v),
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        className="h-10 w-10 rounded-full bg-white/[0.07] text-xl font-bold text-brass-200 ring-1 ring-brass-400/25 disabled:opacity-30"
        aria-label="Diminuer"
      >
        −
      </button>
      <div className="font-ui min-w-16 text-center text-xl font-bold tabular-nums text-brass-200">{format(value)}</div>
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        className="h-10 w-10 rounded-full bg-white/[0.07] text-xl font-bold text-brass-200 ring-1 ring-brass-400/25 disabled:opacity-30"
        aria-label="Augmenter"
      >
        +
      </button>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-ui text-[15px] font-semibold text-ivory/85">{label}</span>
        {hint && <span className="text-xs text-ivory/40">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`panel rounded-3xl p-5 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`btn-lacquer btn-brass px-5 py-3.5 text-lg disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`btn-lacquer btn-raise px-5 py-3.5 text-lg disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl bg-black/40 px-4 py-3 text-base font-semibold text-ivory outline-none ring-1 ring-brass-400/20 placeholder:text-ivory/30 focus:ring-2 focus:ring-brass-400 ${props.className ?? ''}`}
    />
  );
}

export function PageShell({ children, onBack, title }: { children: ReactNode; onBack?: () => void; title?: string }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      {(onBack || title) && (
        <div className="mb-5 flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="font-ui rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[15px] font-semibold text-ivory/80 ring-1 ring-brass-400/20 hover:text-ivory">
              Retour
            </button>
          )}
          {title && <h1 className="font-display text-3xl font-bold text-brass-200">{title}</h1>}
        </div>
      )}
      {children}
    </div>
  );
}
