import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAppData } from "@/components/data-provider";
import { adviceCopy } from "@/components/finance/money-in-home";
import { CommitmentsPanel } from "@/components/finance/commitments-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import { ordinal, type IncomeKind } from "@/lib/month-plan";
import { deleteIncomeSource, getIncomePlan, saveIncomeSource, setIncomeActive } from "@/lib/server/income";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/income")({ component: IncomePage });

const KINDS: { id: IncomeKind; label: string }[] = [
  { id: "salary", label: "Salary" },
  { id: "asset", label: "Asset" },
  { id: "other", label: "Other" },
];

function IncomePage() {
  const { currency, today, refresh, data } = useAppData();
  const accounts = data?.accounts.filter((a) => a.isActive) ?? [];
  const plan = useQuery({
    queryKey: ["income-plan", today],
    queryFn: () => getIncomePlan({ data: { today } }),
  });
  const [name, setName] = useState("Salary");
  const [kind, setKind] = useState<IncomeKind>("salary");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("1");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedAccount = accountId || accounts[0]?.id || "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedAccount) {
      toast.error("Add an account first, then say where this lands");
      return;
    }
    setBusy(true);
    try {
      await saveIncomeSource({
        data: {
          id: editing ?? undefined,
          name,
          kind,
          amount,
          dayOfMonth: Number(day),
          accountId: selectedAccount,
        },
      });
      toast.success(editing ? "Income updated" : "Income saved");
      setEditing(null);
      setAmount("");
      setName(kind === "salary" ? "Salary" : "");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  async function run(label: string, task: () => Promise<unknown>) {
    try {
      await task();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't ${label}`);
    }
  }

  const snapshot = plan.data;
  const hash = useRouterState({ select: (s) => s.location.hash });

  useEffect(() => {
    const id = hash.replace(/^#/, "");
    if (!id) return;
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [hash, snapshot]);

  return (
    <div className="space-y-8 pt-4">
      <header>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Every month</p>
        <h1 className="mt-1 font-display text-4xl tracking-tight">Monthly</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          What lands, what must leave, and what you own. Cash questions show up on home. Depreciation stays on paper.
        </p>
      </header>

      {snapshot && snapshot.sources.some((s) => s.isActive) && (
        <section className="grid grid-cols-3 gap-2">
          <Stat label="Expected" value={formatMoney(snapshot.expected, currency)} />
          <Stat label="Received" value={formatMoney(snapshot.received, currency)} tone="text-income" />
          <Stat label="Spent" value={formatMoney(snapshot.spent, currency)} tone="text-expense" />
        </section>
      )}

      {snapshot && snapshot.advice.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">This month</h2>
          {snapshot.advice.map((item) => {
            const copy = adviceCopy(item, currency);
            return (
              <div key={item.id} className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
                <p className="text-sm font-medium">{copy.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{copy.detail}</p>
              </div>
            );
          })}
        </section>
      )}

      <section id="income" className="scroll-mt-24 space-y-3">
        {snapshot && snapshot.sources.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium">Your payouts</h2>
            {snapshot.sources.map((source) => (
              <div key={source.id} className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className={cn("font-medium", !source.isActive && "text-muted-foreground")}>{source.name}</p>
                  <p className="tabular text-sm">{formatMoney(source.amount, currency)}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {source.kind === "salary" ? "Salary" : source.kind === "asset" ? "Asset" : "Other"} · {ordinal(source.dayOfMonth)} · {source.accountName}
                  {!source.isActive ? " · Paused" : source.checkin === "credited" ? " · Credited" : source.checkin === "skipped" ? " · Skipped" : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      setEditing(source.id);
                      setName(source.name);
                      setKind(source.kind);
                      setAmount(source.amount.replace(/\.00$/, ""));
                      setDay(String(source.dayOfMonth));
                      setAccountId(source.accountId);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => void run("update", () => setIncomeActive({ data: { id: source.id, isActive: !source.isActive } }))}
                  >
                    {source.isActive ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      if (!window.confirm(`Remove ${source.name}? Past income entries stay.`)) return;
                      void run("remove", () => deleteIncomeSource({ data: { id: source.id } }));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <h2 className="text-sm font-medium">{editing ? "Edit income" : "Add income"}</h2>
        {accounts.length === 0 ? (
          <p className="rounded-xl bg-card p-4 text-sm text-muted-foreground shadow-[var(--elev-shadow)]">
            Add an account first, so we know where the money lands.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
            <div className="grid grid-cols-3 gap-2">
              {KINDS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setKind(item.id);
                    if (!editing && (name === "Salary" || name === "Flat rent" || name === "")) {
                      setName(item.id === "salary" ? "Salary" : item.id === "asset" ? "Flat rent" : "");
                    }
                  }}
                  className={cn(
                    "h-11 rounded-md text-sm font-medium",
                    kind === item.id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="income-name">Name</Label>
              <Input id="income-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Salary" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="income-amount">Amount</Label>
                <Input
                  id="income-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="0"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="income-day">Arrives on</Label>
                <Input
                  id="income-day"
                  inputMode="numeric"
                  value={day}
                  onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  placeholder="1"
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              Home asks from the {ordinal(Math.min(31, Math.max(1, Number(day) || 1)))} whether it was credited. Short months use the last day.
            </p>
            <div className="grid gap-1.5">
              <Label>Lands in</Label>
              <Select value={selectedAccount} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {editing ? "Save changes" : "Save income"}
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditing(null);
                    setAmount("");
                    setName("Salary");
                    setKind("salary");
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
      </section>

      {snapshot && (
        <CommitmentsPanel
          accounts={accounts}
          bills={snapshot.bills}
          assets={snapshot.assets}
          bookValue={snapshot.bookValue}
          paperDrop={snapshot.paperDrop}
          currency={currency}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 truncate font-display text-lg tracking-tight tabular", tone)}>{value}</p>
    </div>
  );
}
