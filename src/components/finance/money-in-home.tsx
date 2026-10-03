import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAppData } from "@/components/data-provider";
import { useQuickAdd } from "@/components/finance/quick-add";
import { Button } from "@/components/ui/button";
import { answerPayday, getIncomePlan } from "@/lib/server/income";
import { answerBill } from "@/lib/server/commitments";
import { notifyCutReminders } from "@/lib/bill-reminders";
import { formatMoney, isPositive, isZero } from "@/lib/money";
import { ordinal, type Advice } from "@/lib/month-plan";
import type { IncomePlan } from "@/lib/server/income";
import { cn } from "@/lib/utils";

export function adviceCopy(item: Advice, currency: string): { title: string; detail: string } {
  const money = (value: string) => formatMoney(value, currency);
  switch (item.id) {
    case "setup":
      return {
        title: "Add what lands each month",
        detail: "Salary, rent from a place you own, or any payout. On that date, home asks if it arrived.",
      };
    case "over":
      return {
        title: "This month is already past the money coming in",
        detail:
          item.bills && isPositive(item.bills)
            ? `${money(item.spent)} spent, and ${money(item.bills)} in EMIs or bills still to pay, against ${money(item.expected)} coming in.`
            : `${money(item.spent)} spent against ${money(item.expected)} expected. Hold shopping and eating out until the next payout.`,
      };
    case "pace":
      return {
        title: "This pace overshoots the month",
        detail: `You're averaging ${money(item.dailyNow)} a day. To finish inside ${money(item.expected)}, keep the rest near ${money(item.dailyTarget)} a day.`,
      };
    case "category":
      if (/travel|trip/i.test(item.name)) {
        return {
          title: `${item.name} is heavy this month`,
          detail: `${money(item.spent)} so far. If that's a trip, keep it on the project so the rest of the month stays clear.`,
        };
      }
      return {
        title: `Slow down ${item.name.toLowerCase()}`,
        detail: `${money(item.spent)} so far, past a calmer ${money(item.cap)} (${item.pct}% of money coming in). That's the first place to ease off.`,
      };
    case "focus":
      return {
        title: `${item.name} is where this month is going`,
        detail: `${money(item.spent)} of ${money(item.totalSpent)} spent. Trim that before cutting the small stuff.`,
      };
    case "allocate": {
      const due = item.bills && isPositive(item.bills) ? `${money(item.bills)} is still due on EMIs and fixed bills. ` : "";
      if (!isPositive(item.needs) && !isPositive(item.wants)) {
        return {
          title: "Leave the rest untouched",
          detail: `${due}${money(item.hold)} is what's left. Don't plan new wants on it.`,
        };
      }
      return {
        title: "Where the rest of the month should go",
        detail: `${due}Keep ${money(item.hold)} untouched. About ${money(item.needs)} for food, getting around and bills, and ${money(item.wants)} for everything else.`,
      };
    }
    case "daily":
      return {
        title: `About ${money(item.daily)} a day`,
        detail: `${item.daysLeft} days left, with ${money(item.left)} still inside the plan.`,
      };
  }
}

export function MoneyInHome() {
  const { currency, today, refresh } = useAppData();
  const { openAdd } = useQuickAdd();
  const [busy, setBusy] = useState<string | null>(null);
  const plan = useQuery({
    queryKey: ["income-plan", today],
    queryFn: () => getIncomePlan({ data: { today } }),
  });

  useEffect(() => {
    const prompts = plan.data?.billPrompts ?? [];
    if (prompts.length === 0) return;
    void notifyCutReminders(
      prompts.map((prompt) => ({
        id: prompt.billId,
        title: prompt.name,
        body: `Was ${formatMoney(prompt.amount, currency)} deducted from ${prompt.accountName}?`,
      })),
      today,
    );
  }, [plan.data, today, currency]);

  if (plan.isError || !plan.data) {
    return <MonthShortcuts />;
  }
  const data = plan.data;
  const lead = data.advice[0];
  const loggedToday = isPositive(data.todaySpent);
  const hasPlan = data.sources.some((s) => s.isActive) || data.bills.some((b) => b.isActive);

  async function answerBillDue(billId: string, action: "paid" | "not_yet" | "skip") {
    setBusy(billId + action);
    try {
      await answerBill({ data: { billId, action, today } });
      if (action === "paid") toast.success("Marked as deducted");
      else if (action === "skip") toast.message("Skipped for this month");
      else toast.message("We'll ask again tomorrow");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update");
    } finally {
      setBusy(null);
    }
  }

  async function answer(sourceId: string, action: "credited" | "not_yet" | "skip") {
    setBusy(sourceId + action);
    try {
      await answerPayday({ data: { sourceId, action, today } });
      if (action === "credited") toast.success("Added to this month's income");
      else if (action === "skip") toast.message("Skipped for this month");
      else toast.message("We'll ask again tomorrow");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <MonthShortcuts />
      <ActiveMonth data={data} currency={currency} />
      {data.billPrompts.map((prompt) => (
        <section key={prompt.billId} className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {prompt.kind === "emi" ? "EMI" : prompt.kind === "rent" ? "Rent" : prompt.kind === "subscription" ? "Subscription" : "Bill"} · cuts the {ordinal(prompt.dayOfMonth)}
          </p>
          <p className="mt-1 font-display text-3xl tracking-tight tabular">{formatMoney(prompt.amount, currency)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {prompt.name} — was this deducted from {prompt.accountName}?
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button type="button" disabled={busy !== null} onClick={() => void answerBillDue(prompt.billId, "paid")}>
              Deducted
            </Button>
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void answerBillDue(prompt.billId, "not_yet")}>
              Not yet
            </Button>
          </div>
          <button
            type="button"
            className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:underline"
            disabled={busy !== null}
            onClick={() => void answerBillDue(prompt.billId, "skip")}
          >
            Skip this month
          </button>
        </section>
      ))}

      {data.prompts.map((prompt) => (
        <section key={prompt.sourceId} className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {prompt.kind === "salary" ? "Salary" : prompt.kind === "asset" ? "Payout" : "Money in"} · {ordinal(prompt.dayOfMonth)}
          </p>
          <p className="mt-1 font-display text-3xl tracking-tight tabular">{formatMoney(prompt.amount, currency)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {prompt.name} — did it land in {prompt.accountName}?
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => void answer(prompt.sourceId, "credited")}
            >
              Credited
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void answer(prompt.sourceId, "not_yet")}
            >
              Not yet
            </Button>
          </div>
          <button
            type="button"
            className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:underline"
            disabled={busy !== null}
            onClick={() => void answer(prompt.sourceId, "skip")}
          >
            Skip this month
          </button>
        </section>
      ))}

      <section className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
        {hasPlan ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs tracking-wide text-muted-foreground uppercase">
                  {data.over ? "Over the plan" : data.prompts.length ? "After this lands, per day" : "Okay to spend today"}
                </p>
                <p className={cn("mt-1 font-display text-3xl tracking-tight tabular", data.over && "text-expense")}>
                  {data.over ? formatMoney(data.spent, currency) : formatMoney(data.daily, currency)}
                </p>
              </div>
              <Link to="/income" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                Monthly
              </Link>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.over
                ? `${formatMoney(data.expected, currency)} was the month's income.`
                : isPositive(data.reserved)
                  ? `${data.daysLeft} days left · ${formatMoney(data.left, currency)} left after ${formatMoney(data.reserved, currency)} still to pay.`
                  : `${data.daysLeft} days left · ${formatMoney(data.left, currency)} still in the plan.`}
              {loggedToday ? ` Spent today ${formatMoney(data.todaySpent, currency)}.` : ""}
            </p>
            {lead && lead.id !== "daily" && (
              <p className="mt-3 text-sm">
                <span className="font-medium">{adviceCopy(lead, currency).title}. </span>
                <span className="text-muted-foreground">{adviceCopy(lead, currency).detail}</span>
              </p>
            )}
            {!loggedToday && !isZero(data.expected) && (
              <Button type="button" variant="secondary" className="mt-4" onClick={() => openAdd()}>
                Log today's spend
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="text-sm font-medium">Set what comes in and what must go out</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Salary, rent you receive, EMI, or a bill. On that date, this screen asks if it happened.
            </p>
            <Button asChild className="mt-4">
              <Link to="/income">Set up monthly</Link>
            </Button>
          </>
        )}
      </section>
    </div>
  );
}

function MonthShortcuts() {
  const items = [
    { hash: "income", label: "Salary" },
    { hash: "bills", label: "EMI & bills" },
    { hash: "assets", label: "What I own" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <Link
          key={item.hash}
          to="/income"
          hash={item.hash}
          className="rounded-xl bg-card px-2 py-3 text-center text-sm font-medium shadow-[var(--elev-shadow)]"
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function kindLabel(kind: string) {
  if (kind === "salary") return "Salary";
  if (kind === "asset") return "Payout";
  if (kind === "emi") return "EMI";
  if (kind === "rent") return "Rent";
  if (kind === "subscription") return "Subscription";
  if (kind === "bill") return "Bill";
  if (kind === "vehicle") return "Vehicle";
  if (kind === "property") return "Property";
  if (kind === "gadget") return "Gadget";
  return "Other";
}

function ActiveMonth({ data, currency }: { data: IncomePlan; currency: string }) {
  const rows = [
    ...data.sources.map((source) => ({
      id: source.id,
      hash: "income",
      name: source.name,
      amount: formatMoney(source.amount, currency),
      meta: `${kindLabel(source.kind)} · lands the ${ordinal(source.dayOfMonth)}`,
      state: !source.isActive ? "Paused" : source.checkin === "credited" ? "Credited" : source.checkin === "skipped" ? "Skipped" : "Waiting",
      quiet: !source.isActive,
    })),
    ...data.bills.map((bill) => ({
      id: bill.id,
      hash: "bills",
      name: bill.name,
      amount: formatMoney(bill.amount, currency),
      meta: `${kindLabel(bill.kind)} · cuts the ${ordinal(bill.dayOfMonth)}`,
      state: !bill.isActive ? "Paused" : bill.checkin === "paid" ? "Deducted" : bill.checkin === "skipped" ? "Skipped" : "Waiting",
      quiet: !bill.isActive,
    })),
    ...data.assets.map((asset) => ({
      id: asset.id,
      hash: "assets",
      name: asset.name,
      amount: formatMoney(asset.bookValue, currency),
      meta: `${kindLabel(asset.kind)} · worth now`,
      state: !asset.isActive ? "Sold" : asset.finished ? "Written down" : "Active",
      quiet: !asset.isActive,
    })),
  ];
  if (rows.length === 0) return null;
  return (
    <section className="rounded-xl bg-card shadow-[var(--elev-shadow)]">
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Already set</p>
        <Link to="/income" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          Edit
        </Link>
      </div>
      <ul className="mt-1">
        {rows.map((row) => (
          <li key={row.id} className="border-t border-white/10 first:border-t-0">
            <Link to="/income" hash={row.hash} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className={cn("block truncate text-sm font-medium", row.quiet && "text-muted-foreground")}>{row.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {row.meta} · {row.state}
                </span>
              </span>
              <span className="shrink-0 text-sm tabular">{row.amount}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
