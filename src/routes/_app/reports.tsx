import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getReports } from "@/lib/server/reports";
import { useAppData } from "@/components/data-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatMoney, isZero } from "@/lib/money";
import { formatLongDate } from "@/lib/utils";
import { CategoryIcon } from "@/components/finance/icons";
import { EmptyState } from "@/components/finance/empty-state";
import { PieChart as PieIcon } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from "recharts";

export const Route = createFileRoute("/_app/reports")({ component: ReportsPage });

function ReportsPage() {
  const { from: defaultFrom, to: defaultTo, currency } = useAppData();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const q = useQuery({
    queryKey: ["reports", from, to],
    queryFn: () => getReports({ data: { from, to } }),
  });
  const r = q.data;
  const quiet = !!r && isZero(r.income) && isZero(r.expense) && r.daily.length === 0;
  const hasLedger = !!r && (r.bounds.count > 0 || r.accounts.length > 0 || r.projects.length > 0);
  const outside =
    !!r &&
    quiet &&
    r.bounds.count > 0 &&
    r.bounds.from &&
    r.bounds.to &&
    (r.bounds.from < from || r.bounds.to > to);

  return (
    <div className="space-y-6 pt-4">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">From your own ledger — never placeholder numbers.</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="r-from">From</Label>
          <Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="r-to">To</Label>
          <Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {q.isPending && <p className="text-sm text-muted-foreground">Loading your ledger…</p>}

      {q.isError && (
        <p className="text-sm text-expense">{q.error instanceof Error ? q.error.message : "Couldn't load reports."}</p>
      )}

      {r && !hasLedger && quiet && (
        <EmptyState
          icon={PieIcon}
          title="Nothing to report yet"
          body="Add a few transactions and this view fills itself."
        />
      )}

      {r && hasLedger && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Income" value={formatMoney(r.income, currency)} tone="text-income" />
            <Metric label="Expenses" value={formatMoney(r.expense, currency)} tone="text-expense" />
            <Metric label="Savings" value={formatMoney(r.savings, currency)} />
          </div>

          {quiet && (
            <div className="rounded-xl bg-card p-4 text-sm shadow-[var(--elev-shadow)]">
              <p>Nothing posted between these dates. Balances and projects below are still yours.</p>
              {outside && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setFrom(r.bounds.from!);
                    setTo(r.bounds.to!);
                  }}
                >
                  Show {formatLongDate(r.bounds.from!)} – {formatLongDate(r.bounds.to!)}
                </Button>
              )}
            </div>
          )}

          {r.daily.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium">Income vs expense</h2>
              <div className="h-48 rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={r.daily.map((d) => ({ ...d, exp: Number(d.expense), inc: Number(d.income) }))}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => String(v).slice(8)} />
                    <Tooltip
                      content={({ payload }) => {
                        const row = payload?.[0]?.payload as { date: string; expense: string; income: string } | undefined;
                        if (!row) return null;
                        return (
                          <div className="rounded-md bg-popover px-2 py-1 text-xs shadow-[var(--elev-shadow)]">
                            <p>{row.date}</p>
                            <p>In {formatMoney(row.income, currency)}</p>
                            <p>Out {formatMoney(row.expense, currency)}</p>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="inc" stroke="var(--income)" fill="var(--income)" fillOpacity={0.15} />
                    <Area type="monotone" dataKey="exp" stroke="var(--expense)" fill="var(--expense)" fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {r.byCategory.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium">Top categories</h2>
              <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
                {r.byCategory.map((c) => (
                  <div key={c.name} className="flex items-center gap-3 py-2">
                    <CategoryIcon name={c.icon} className="size-4 text-muted-foreground" />
                    <p className="flex-1 text-sm">{c.name}</p>
                    <p className="tabular text-sm">{formatMoney(c.amount, currency)}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {r.byProject.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium">Spent in this range</h2>
              <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
                {r.byProject.map((p) => (
                  <div key={p.name} className="flex items-center justify-between py-2 text-sm">
                    <span>{p.name}</span>
                    <span className="tabular">{formatMoney(p.amount, currency)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {r.projects.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium">Projects</h2>
              <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
                {r.projects.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 tabular">
                      {formatMoney(p.spent, currency)}
                      {!isZero(p.budget) ? ` / ${formatMoney(p.budget, currency)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {r.accounts.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium">Balances</h2>
              <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
                {r.accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{a.name}</span>
                    <span className="tabular">{formatMoney(a.balance, currency)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {r.byAccount.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium">Spent from</h2>
              <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
                {r.byAccount.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{a.name}</span>
                    <span className="tabular">{formatMoney(a.amount, currency)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1 truncate font-display text-lg tabular ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
