import { formatMoney } from "@/lib/money";
import { formatShortDate } from "@/lib/utils";
import type { DailySpend } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DailyBars({
  days,
  currency,
}: {
  days: DailySpend[];
  currency: string;
}) {
  const max = Math.max(...days.map((d) => Number(d.expense)), 1);
  const crowded = days.length > 10;

  return (
    <div className="overflow-x-auto rounded-xl bg-card px-3 pt-4 pb-3 shadow-[var(--elev-shadow)]">
      <div
        className="flex h-36 items-end gap-1.5"
        style={{ minWidth: days.length > 8 ? days.length * 28 : undefined }}
      >
        {days.map((d) => {
          const value = Number(d.expense);
          const pct = value > 0 ? Math.max(10, (value / max) * 100) : 0;
          return (
            <div
              key={d.date}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
              style={{ maxWidth: crowded ? 22 : 40 }}
              title={`${formatShortDate(d.date)} · ${formatMoney(d.expense, currency)}`}
            >
              {!crowded && value > 0 && (
                <span className="text-[10px] leading-none tabular text-muted-foreground">
                  {compactRupee(value)}
                </span>
              )}
              <div className="flex h-24 w-full items-end justify-center">
                <div
                  className={cn(
                    "w-full max-w-7 rounded-sm",
                    value > 0 ? "bg-expense/80" : "bg-secondary",
                  )}
                  style={{ height: value > 0 ? `${pct}%` : 3 }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div
        className="mt-2 flex gap-1.5"
        style={{ minWidth: days.length > 8 ? days.length * 28 : undefined }}
      >
        {days.map((d) => (
          <span
            key={d.date}
            className="min-w-0 flex-1 truncate text-center text-[10px] tabular text-muted-foreground"
            style={{ maxWidth: crowded ? 22 : 40 }}
          >
            {d.date.slice(8)}
          </span>
        ))}
      </div>
    </div>
  );
}

function compactRupee(n: number) {
  if (n >= 100000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}
