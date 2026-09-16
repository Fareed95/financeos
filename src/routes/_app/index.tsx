import { createFileRoute, Link } from "@tanstack/react-router";
import { useAppData } from "@/components/data-provider";
import { BudgetBar } from "@/components/finance/budget-bar";
import { EmptyState } from "@/components/finance/empty-state";
import { TxnRow } from "@/components/finance/txn-row";
import { TxnEditSheet } from "@/components/finance/txn-edit-sheet";
import { InstallAppCard } from "@/components/install-app";
import { useQuickAdd } from "@/components/finance/quick-add";
import { formatMoney, isNegative, percentUsed } from "@/lib/money";
import { monthLabel } from "@/lib/utils";
import { ArrowLeftRight, FolderKanban } from "lucide-react";
import { useState } from "react";
import type { Transaction } from "@/lib/types";

export const Route = createFileRoute("/_app/")({ component: Home });

function Home() {
  const { data, currency, from } = useAppData();
  const { openAdd } = useQuickAdd();
  const [edit, setEdit] = useState<Transaction | null>(null);
  if (!data) return null;

  const { stats, projects, budgets, recent, accounts } = data;
  const activeProjects = projects.filter((p) => p.status === "active" || p.status === "planned");
  const monthBudget = budgets.find((b) => !b.categoryId && b.startDate <= from && b.endDate >= from) ?? budgets[0];
  const netNegative = isNegative(stats.netWorth);

  return (
    <div className="space-y-8 pt-4">
      <header className="fos-enter">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{monthLabel(from)}</p>
        <p className="mt-2 font-display text-5xl tracking-tight tabular">
          {formatMoney(stats.netWorth, currency)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {netNegative ? "Net position" : "Total balance"}
          {accounts.filter((a) => a.isActive).length
            ? ` · ${accounts.filter((a) => a.isActive).length} accounts`
            : ""}
        </p>
      </header>

      <InstallAppCard className="fos-enter fos-enter-delay-1" dismissible />

      <section className="fos-enter fos-enter-delay-1 grid grid-cols-3 gap-2">
        <Stat label="Income" value={formatMoney(stats.income, currency)} tone="text-income" />
        <Stat label="Expenses" value={formatMoney(stats.expense, currency)} tone="text-expense" />
        <Stat label="Savings" value={formatMoney(stats.savings, currency)} />
      </section>

      {monthBudget && (
        <section className="fos-enter fos-enter-delay-2 rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">{monthBudget.name}</h2>
            <Link to="/budgets" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              Budgets
            </Link>
          </div>
          <BudgetBar
            spent={monthBudget.spent}
            amount={monthBudget.amount}
            percent={monthBudget.percent}
            currency={currency}
          />
        </section>
      )}

      <section className="fos-enter fos-enter-delay-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Active projects</h2>
          <Link to="/projects" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            All
          </Link>
        </div>
        {activeProjects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            body="Create a trip or any project to track spending beside your personal books."
            action="Create your first project"
            onAction={() => {
              window.location.href = "/projects";
            }}
          />
        ) : (
          <div className="grid gap-2">
            {activeProjects.slice(0, 4).map((p) => (
              <Link
                key={p.id}
                to="/projects/$id"
                params={{ id: p.id }}
                className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)] transition-colors hover:bg-secondary"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{p.projectType}</p>
                </div>
                <BudgetBar
                  className="mt-3"
                  spent={p.totalCost}
                  amount={p.budget}
                  percent={percentUsed(p.totalCost, p.budget)}
                  currency={currency}
                />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent</h2>
          <Link to="/transactions" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            All
          </Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No transactions yet"
            body="Record your first expense — amount, category, done."
            action="Add your first expense"
            onAction={() => openAdd()}
          />
        ) : (
          <div className="rounded-xl bg-card px-3 py-1 shadow-[var(--elev-shadow)]">
            {recent.map((t) => (
              <TxnRow key={t.id} txn={t} currency={currency} onClick={() => setEdit(t)} />
            ))}
          </div>
        )}
      </section>

      <TxnEditSheet txn={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1 truncate font-display text-lg tracking-tight tabular ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
