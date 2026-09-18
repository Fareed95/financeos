import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Transaction } from "@/lib/types";
import { deleteProject, getProjectDetail } from "@/lib/server/projects";
import { useAppData } from "@/components/data-provider";
import { useQuickAdd } from "@/components/finance/quick-add";
import { BudgetBar } from "@/components/finance/budget-bar";
import { TxnRow } from "@/components/finance/txn-row";
import { TxnEditSheet } from "@/components/finance/txn-edit-sheet";
import { CategoryIcon } from "@/components/finance/icons";
import { DailyBars } from "@/components/finance/daily-bars";
import { EmptyState } from "@/components/finance/empty-state";
import { Button } from "@/components/ui/button";
import { ProjectSheet } from "@/routes/_app/projects/index";
import { formatLongDate, todayISO } from "@/lib/utils";
import { formatMoney, isNegative, isZero, percentUsed } from "@/lib/money";
import { DEFAULT_CATEGORIES, QUICK_TRIP_CATEGORIES } from "@/lib/constants";
import { ArrowLeft, ArrowLeftRight } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const CATEGORY_ICON = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.name, c.icon]));

export const Route = createFileRoute("/_app/projects/$id")({ component: ProjectDetail });

function ProjectDetail() {
  const { id } = Route.useParams();
  const { currency, refresh } = useAppData();
  const { openAdd } = useQuickAdd();
  const navigate = useNavigate();
  const today = todayISO();
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const [txn, setTxn] = useState<Transaction | null>(null);

  const q = useQuery({
    queryKey: ["project", id, today],
    queryFn: () => getProjectDetail({ data: { id, today } }),
  });

  if (q.isPending) {
    return <p className="pt-8 text-sm text-muted-foreground">Loading project…</p>;
  }
  if (q.error || !q.data) {
    return <p className="pt-8 text-sm text-expense">Couldn't load this project.</p>;
  }

  const { project, insights, transactions } = q.data;
  const isTrip = project.projectType === "trip";
  const remainingNegative = isNegative(insights.remaining);
  const catTotal = insights.totalCost;

  return (
    <div className="space-y-6 pt-4 pb-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowLeft className="size-3.5" /> Projects
          </Link>
          <h1 className="mt-2 font-display text-3xl tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground capitalize">
            {project.projectType}
            {project.startDate && project.endDate
              ? ` · ${formatLongDate(project.startDate)} – ${formatLongDate(project.endDate)}`
              : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
          Edit
        </Button>
      </div>

      {isTrip ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label="Budget" value={formatMoney(insights.budget, currency)} />
          <Metric label="Total cost" value={formatMoney(insights.totalCost, currency)} />
          <Metric label="Prepaid" value={formatMoney(insights.prepaid, currency)} />
          <Metric label="During trip" value={formatMoney(insights.duringTrip, currency)} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Budget" value={formatMoney(project.budget, currency)} />
          <Metric label="Spent" value={formatMoney(project.totalCost, currency)} />
        </div>
      )}

      <section className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium">Remaining</p>
          <p className={`font-display text-2xl tabular ${remainingNegative ? "text-expense" : ""}`}>
            {formatMoney(insights.remaining, currency)}
          </p>
        </div>
        <BudgetBar
          className="mt-3"
          spent={insights.totalCost}
          amount={insights.budget}
          percent={percentUsed(insights.totalCost, insights.budget)}
          currency={currency}
        />
        {!isZero(insights.contributions) && (
          <p className="mt-3 text-sm text-muted-foreground">
            {formatMoney(insights.contributions, currency)} contributed · net cost{" "}
            {formatMoney(insights.netCost, currency)}
          </p>
        )}
      </section>

      {!isZero(insights.contributions) && (
        <section className="grid grid-cols-2 gap-2">
          <Metric label="Contributed" value={formatMoney(insights.contributions, currency)} />
          <Metric label="Net cost" value={formatMoney(insights.netCost, currency)} />
        </section>
      )}

      {isTrip && (
        <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label="Today" value={formatMoney(insights.todaySpend, currency)} />
          <Metric label="Avg / day" value={formatMoney(insights.averageDaily, currency)} />
          <Metric label="Days left" value={String(insights.remainingDays)} />
          <Metric
            label="Daily limit"
            value={formatMoney(insights.recommendedDaily, currency)}
            hint={insights.overDaily ? "Today is above the suggested pace." : undefined}
          />
        </section>
      )}

      {isTrip && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Quick add</h2>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TRIP_CATEGORIES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() =>
                  openAdd({
                    type: "expense",
                    categoryName: name,
                    projectId: project.id,
                  })
                }
                className="inline-flex h-11 items-center gap-2 rounded-full bg-secondary px-3.5 text-sm font-medium"
              >
                <CategoryIcon name={CATEGORY_ICON[name] ?? "ellipsis"} className="size-3.5 text-muted-foreground" />
                {name === "Accommodation" ? "Hotel" : name}
              </button>
            ))}
          </div>
        </section>
      )}

      {insights.categoryBreakdown.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">By category</h2>
          <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
            {insights.categoryBreakdown.map((c) => {
              const pct = percentUsed(c.amount, catTotal);
              return (
                <div key={c.name} className="py-2">
                  <div className="flex items-center gap-3">
                    <CategoryIcon name={c.icon} className="size-4 text-muted-foreground" />
                    <p className="flex-1 text-sm">{c.name}</p>
                    <p className="tabular text-sm">{formatMoney(c.amount, currency)}</p>
                  </div>
                  <div className="mt-1.5 ml-7 h-1 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-foreground/40" style={{ width: `${Math.max(pct, 4)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {insights.daily.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Daily spending</h2>
          <DailyBars days={insights.daily} currency={currency} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Transactions</h2>
        {transactions.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="Nothing on this project yet"
            body="Add a cost and it will show here and in your personal ledger."
            action="Add expense"
            onAction={() => openAdd({ projectId: project.id, type: "expense" })}
          />
        ) : (
          <div className="rounded-xl bg-card px-3 py-1 shadow-[var(--elev-shadow)]">
            {transactions.map((t) => (
              <TxnRow key={t.id} txn={t} currency={currency} onClick={() => setTxn(t)} />
            ))}
          </div>
        )}
      </section>

      <Button variant="ghost" className="text-expense" onClick={() => setRemove(true)}>
        Delete project
      </Button>

      <TxnEditSheet txn={txn} onClose={() => setTxn(null)} />

      <ProjectSheet
        open={edit}
        onOpenChange={setEdit}
        initial={project}
        onSaved={async () => {
          setEdit(false);
          await q.refetch();
          await refresh();
        }}
      />

      <AlertDialog open={remove} onOpenChange={setRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Transactions stay in your ledger, unlinked from this project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await deleteProject({ data: { id: project.id } });
                  await refresh();
                  toast.success("Project deleted");
                  void navigate({ to: "/projects" });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Couldn't delete");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-display text-xl tracking-tight tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-warn">{hint}</p>}
    </div>
  );
}
