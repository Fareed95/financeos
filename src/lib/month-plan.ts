import { addMoney, cmpMoney, fromCents, isPositive, subMoney, toCents } from "./money.ts";

export const INCOME_KINDS = ["salary", "asset", "other"] as const;
export type IncomeKind = (typeof INCOME_KINDS)[number];

export type PlanSource = {
  id: string;
  name: string;
  kind: IncomeKind;
  amount: string;
  dayOfMonth: number;
  isActive: boolean;
  /** Null until the user answers for this calendar month. */
  checkin: "credited" | "snoozed" | "skipped" | null;
  snoozeUntil: string | null;
};

export type PlanBill = {
  id: string;
  name: string;
  amount: string;
  isActive: boolean;
  /** Paid means the cash already left, so it is inside spent and must not be reserved again. */
  checkin: "paid" | "snoozed" | "skipped" | null;
};

export type PlanCategory = { name: string; amount: string };

export type Advice =
  | { id: "setup"; tone: "act" }
  | { id: "over"; tone: "act"; spent: string; expected: string; bills?: string }
  | { id: "pace"; tone: "watch"; dailyNow: string; dailyTarget: string; expected: string }
  | {
      id: "category";
      tone: "watch";
      name: string;
      spent: string;
      cap: string;
      pct: number;
    }
  | { id: "focus"; tone: "watch"; name: string; spent: string; totalSpent: string }
  | { id: "allocate"; tone: "ok"; hold: string; needs: string; wants: string; bills?: string }
  | { id: "daily"; tone: "ok"; daily: string; daysLeft: number; left: string };

export type MonthPlan = {
  expected: string;
  received: string;
  spent: string;
  left: string;
  /** Active bills not yet marked paid. Already-paid bills sit inside spent. */
  reserved: string;
  over: boolean;
  daily: string;
  daysLeft: number;
  dayOfMonth: number;
  advice: Advice[];
};

const CAPS: { test: RegExp; pct: number }[] = [
  { test: /food|grocer|dining|restaurant/i, pct: 25 },
  { test: /transport|fuel|cab|uber/i, pct: 12 },
  { test: /travel|trip/i, pct: 15 },
  { test: /shop/i, pct: 8 },
  { test: /entertain|movie|subscription/i, pct: 6 },
];

export function paydayISO(year: number, month: number, dayOfMonth: number): string {
  const last = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(dayOfMonth, 1), last);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysLeftInMonth(today: string): number {
  const [y, m, d] = today.split("-").map(Number);
  if (!y || !m || !d) return 1;
  const last = new Date(y, m, 0).getDate();
  return Math.max(1, last - d + 1);
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function pctOf(amount: string, pct: number): string {
  return fromCents((toCents(amount) * BigInt(pct)) / 100n);
}

function perDay(amount: string, days: number): string {
  if (days <= 0 || !isPositive(amount)) return "0.00";
  return fromCents(toCents(amount) / BigInt(days));
}

export function shouldAskDue(
  today: string,
  item: { isActive: boolean; dayOfMonth: number; checkin: string | null; snoozeUntil: string | null },
): boolean {
  if (!item.isActive) return false;
  if (item.checkin === "credited" || item.checkin === "paid" || item.checkin === "skipped") return false;
  const [y, m] = today.split("-").map(Number);
  if (!y || !m) return false;
  const due = paydayISO(y, m, item.dayOfMonth);
  if (today < due) return false;
  if (item.checkin === "snoozed" && item.snoozeUntil && item.snoozeUntil > today) return false;
  return true;
}

export function shouldAskPayday(today: string, source: PlanSource): boolean {
  return shouldAskDue(today, source);
}

export function buildMonthPlan(input: {
  today: string;
  sources: PlanSource[];
  categories: PlanCategory[];
  bills?: PlanBill[];
  spent: string;
  received: string;
}): MonthPlan {
  const active = input.sources.filter((s) => s.isActive && s.checkin !== "skipped");
  const expected = active.reduce((sum, s) => addMoney(sum, s.amount), "0.00");
  const spent = input.spent;
  const billList = input.bills ?? [];
  const committed = billList
    .filter((bill) => bill.isActive && bill.checkin !== "skipped")
    .reduce((sum, bill) => addMoney(sum, bill.amount), "0.00");
  const reserved = billList
    .filter((bill) => bill.isActive && bill.checkin !== "skipped" && bill.checkin !== "paid")
    .reduce((sum, bill) => addMoney(sum, bill.amount), "0.00");
  const leftRaw = subMoney(subMoney(expected, spent), reserved);
  const over = isPositive(expected) && !isPositive(leftRaw) && leftRaw !== "0.00";
  const left = isPositive(leftRaw) ? leftRaw : "0.00";
  const daysLeft = daysLeftInMonth(input.today);
  const dayOfMonth = Number(input.today.slice(8, 10)) || 1;
  const holdBaseRaw = subMoney(expected, committed);
  const holdBase = isPositive(holdBaseRaw) ? holdBaseRaw : "0.00";
  const holdTarget = isPositive(holdBase) ? pctOf(holdBase, 20) : "0.00";
  const hold = !isPositive(left) ? "0.00" : cmpMoney(left, holdTarget) < 0 ? left : holdTarget;
  const room = subMoney(left, hold);
  const spendable = isPositive(room) ? room : "0.00";
  const daily = perDay(spendable, daysLeft);

  const advice: Advice[] = [];
  if (input.sources.filter((s) => s.isActive).length === 0) {
    advice.push({ id: "setup", tone: "act" });
  } else {
    if (over) advice.push({ id: "over", tone: "act", spent, expected, bills: reserved });

    const [y, m] = input.today.split("-").map(Number);
    const daysInMonth = y && m ? new Date(y, m, 0).getDate() : 30;
    if (!over && dayOfMonth >= 5 && isPositive(expected) && isPositive(spent)) {
      const projected = fromCents((toCents(spent) * BigInt(daysInMonth)) / BigInt(dayOfMonth));
      if (cmpMoney(projected, expected) > 0) {
        advice.push({
          id: "pace",
          tone: "watch",
          dailyNow: perDay(spent, dayOfMonth),
          dailyTarget: daily,
          expected,
        });
      }
    }

    if (isPositive(expected)) {
      const hot = input.categories
        .map((cat) => {
          const rule = CAPS.find((c) => c.test.test(cat.name));
          if (!rule || !isPositive(cat.amount)) return null;
          const cap = pctOf(expected, rule.pct);
          if (cmpMoney(cat.amount, cap) <= 0) return null;
          const pct = Number((toCents(cat.amount) * 100n) / toCents(expected));
          return { name: cat.name, spent: cat.amount, cap, pct };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .sort((a, b) => b.pct - a.pct);
      if (hot[0]) advice.push({ id: "category", tone: "watch", ...hot[0] });
      else if (
        isPositive(spent) &&
        (dayOfMonth >= 10 || cmpMoney(spent, pctOf(expected, 15)) >= 0)
      ) {
        const top = [...input.categories].sort((a, b) => cmpMoney(b.amount, a.amount))[0];
        if (top && cmpMoney(top.amount, pctOf(spent, 40)) > 0) {
          advice.push({ id: "focus", tone: "watch", name: top.name, spent: top.amount, totalSpent: spent });
        }
      }
    }

    if (!over && isPositive(left)) {
      advice.push({
        id: "allocate",
        tone: "ok",
        hold,
        needs: pctOf(spendable, 60),
        wants: subMoney(spendable, pctOf(spendable, 60)),
        bills: reserved,
      });
    }

    if (advice.length === 0) {
      advice.push({ id: "daily", tone: "ok", daily, daysLeft, left });
    }
  }

  return {
    expected,
    received: input.received,
    spent,
    left,
    reserved,
    over,
    daily,
    daysLeft,
    dayOfMonth,
    advice: advice.slice(0, 3),
  };
}
