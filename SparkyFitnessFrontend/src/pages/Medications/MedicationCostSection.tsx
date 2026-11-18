import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const CARD = 'rounded-lg border bg-card p-4 text-card-foreground shadow-sm';

/** Pitstop-style section: a small heading above a single bordered card. */
export function CostSection({
  title,
  children,
  className,
  cardClassName,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  cardClassName?: string;
}) {
  return (
    <section className={cn('min-w-0', className)}>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className={cn(CARD, 'space-y-3', cardClassName)}>{children}</div>
    </section>
  );
}

/** A headline figure with a label above and a note below. */
export function CostStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className={CARD}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-xl font-semibold tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
