import type { ReactNode } from "react";

export function BusinessPageHeader({
  title,
  context,
  aside,
}: {
  title: string;
  context?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {context && <p className="text-xs text-muted-foreground">{context}</p>}
        <h2 className="font-display text-[1.65rem] leading-tight tracking-tight">{title}</h2>
      </div>
      {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
    </div>
  );
}

export function BusinessSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function BusinessMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card/60 px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-lg font-medium tabular">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function BusinessEmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-4">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function BusinessListRow({
  title,
  meta,
  value,
  action,
}: {
  title: string;
  meta?: string;
  value?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      {value && <p className="shrink-0 text-sm tabular">{value}</p>}
      {action}
    </div>
  );
}

const BADGE: Record<string, string> = {
  paid: "text-income",
  overdue: "text-expense",
  partial: "text-foreground",
  draft: "text-muted-foreground",
  open: "text-muted-foreground",
  personal: "text-foreground",
};

export function BusinessStatusBadge({ tone, children }: { tone: keyof typeof BADGE | string; children: ReactNode }) {
  return <span className={`text-xs capitalize ${BADGE[tone] || "text-muted-foreground"}`}>{children}</span>;
}
