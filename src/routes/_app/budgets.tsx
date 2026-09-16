import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAppData } from "@/components/data-provider";
import { BudgetBar } from "@/components/finance/budget-bar";
import { EmptyState } from "@/components/finance/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { deleteBudget, upsertBudget } from "@/lib/server/budgets";
import { formatMoney } from "@/lib/money";
import { endOfMonthISO, startOfMonthISO } from "@/lib/utils";
import type { Budget, BudgetPeriod } from "@/lib/types";
import { Wallet } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/budgets")({ component: BudgetsPage });

function BudgetsPage() {
  const { data, currency, refresh } = useAppData();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  if (!data) return null;

  return (
    <div className="space-y-5 pt-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Budgets</h1>
          <p className="text-sm text-muted-foreground">Monthly, category, or a custom window.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>New</Button>
      </header>

      {data.budgets.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No budgets yet"
          body="Set your monthly budget to see spending against a plan."
          action="Set your monthly budget"
          onAction={() => setOpen(true)}
        />
      ) : (
        <div className="grid gap-2">
          {data.budgets.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setEditing(b);
                setOpen(true);
              }}
              className="rounded-xl bg-card p-4 text-left shadow-[var(--elev-shadow)]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{b.name}</p>
                <p className="text-xs text-muted-foreground">
                  {b.categoryName ? b.categoryName : "Overall"} · {b.period}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Remaining {formatMoney(b.remaining, currency)}
              </p>
              <BudgetBar className="mt-3" spent={b.spent} amount={b.amount} percent={b.percent} currency={currency} />
            </button>
          ))}
        </div>
      )}

      <BudgetSheet
        open={open}
        onOpenChange={setOpen}
        initial={editing}
        categories={data.categories}
        onSaved={async () => {
          setOpen(false);
          await refresh();
        }}
        onDelete={async (id) => {
          await deleteBudget({ data: { id } });
          setOpen(false);
          await refresh();
          toast.success("Budget removed");
        }}
      />
    </div>
  );
}

function BudgetSheet({
  open,
  onOpenChange,
  initial,
  categories,
  onSaved,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: Budget | null;
  categories: { id: string; name: string }[];
  onSaved: () => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<BudgetPeriod>("monthly");
  const [startDate, setStartDate] = useState(startOfMonthISO());
  const [endDate, setEndDate] = useState(endOfMonthISO());
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (v) {
          setName(initial?.name ?? "");
          setAmount(initial?.amount.replace(/\.00$/, "") ?? "");
          setPeriod(initial?.period ?? "monthly");
          setStartDate(initial?.startDate ?? startOfMonthISO());
          setEndDate(initial?.endDate ?? endOfMonthISO());
          setCategoryId(initial?.categoryId ?? "");
        }
      }}
    >
      <SheetContent side="bottom" className="overflow-y-auto pb-8">
        <SheetHeader>
          <SheetTitle>{initial ? "Edit budget" : "New budget"}</SheetTitle>
        </SheetHeader>
        <form
          className="grid gap-4 px-5 pb-6"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await upsertBudget({
                data: {
                  id: initial?.id,
                  name,
                  amount,
                  period,
                  startDate,
                  endDate,
                  categoryId: categoryId || null,
                },
              });
              toast.success("Budget saved");
              onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't save");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="b-name">Name</Label>
            <Input id="b-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="September budget" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="b-amt">Amount</Label>
            <Input id="b-amt" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as BudgetPeriod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="b-start">Start</Label>
              <Input id="b-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-end">End</Label>
              <Input id="b-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Select value={categoryId || "all"} onValueChange={(v) => setCategoryId(v === "all" ? "" : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Overall</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {initial && (
            <Button type="button" variant="ghost" className="text-expense" onClick={() => void onDelete(initial.id)}>
              Delete budget
            </Button>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
