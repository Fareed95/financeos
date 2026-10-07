import { planExistingOpening } from "./biz-access.ts";
import { gstOn } from "./gst.ts";
import { assertBalanced, type DraftLine } from "./ledger.ts";
import { fromCents } from "./money.ts";

/**
 * Cash-flow policy (existing engine, not changed here):
 * A journal that touches a loan or equity account classifies its whole cash
 * movement as financing. Interest on a loan payment is still an expense on
 * the P&L. Asset purchases classify as investing. Everything else with cash
 * is operating. Input GST is an asset, not an operating expense.
 */

export function planOpenBill(input: {
  expenseCode: string;
  taxable: bigint;
  rate: number;
  sellerState: string | null;
  placeOfSupply: string | null;
}): { lines: DraftLine[]; cgst: bigint; sgst: bigint; igst: bigint; total: bigint } {
  const gst = gstOn(input.taxable, input.rate, input.sellerState, input.placeOfSupply);
  if (input.rate > 0 && gst.treatment === "incomplete") {
    throw new Error("Add the business state and the place of supply before posting GST. It is not guessed.");
  }
  const lines: DraftLine[] = [];
  if (gst.taxable > 0n) lines.push({ code: input.expenseCode, debit: gst.taxable, credit: 0n });
  if (gst.cgst > 0n) lines.push({ code: "1210", debit: gst.cgst, credit: 0n });
  if (gst.sgst > 0n) lines.push({ code: "1220", debit: gst.sgst, credit: 0n });
  if (gst.igst > 0n) lines.push({ code: "1230", debit: gst.igst, credit: 0n });
  lines.push({ code: "2000", debit: 0n, credit: gst.total });
  assertBalanced(lines);
  return { lines, cgst: gst.cgst, sgst: gst.sgst, igst: gst.igst, total: gst.total };
}

export function assertCanPay(open: bigint, amount: bigint) {
  if (amount <= 0n) throw new Error("Enter an amount");
  if (amount > open) throw new Error("Payment is more than the amount still due");
}

export function planBillPayment(amount: bigint, account = "1010"): DraftLine[] {
  const lines = [
    { code: "2000", debit: amount, credit: 0n },
    { code: account, debit: 0n, credit: amount },
  ];
  assertBalanced(lines);
  return lines;
}

export function billStatus(total: bigint, paid: bigint, due: string, today: string) {
  if (paid >= total && total > 0n) return "paid" as const;
  if (paid > 0n) return "partially_paid" as const;
  if (due < today) return "overdue" as const;
  return "open" as const;
}

export function planLoanReceipt(amount: bigint, account = "1010"): DraftLine[] {
  if (amount <= 0n) throw new Error("Enter the amount received");
  const lines = [
    { code: account, debit: amount, credit: 0n },
    { code: "2300", debit: 0n, credit: amount },
  ];
  assertBalanced(lines);
  return lines;
}

export function planLoanPayment(principal: bigint, interest: bigint, account = "1010"): DraftLine[] {
  if (principal < 0n || interest < 0n || principal + interest <= 0n) throw new Error("Enter the principal and interest");
  const lines: DraftLine[] = [];
  if (principal > 0n) lines.push({ code: "2300", debit: principal, credit: 0n });
  if (interest > 0n) lines.push({ code: "5800", debit: interest, credit: 0n });
  lines.push({ code: account, debit: 0n, credit: principal + interest });
  assertBalanced(lines);
  return lines;
}

export function planAssetPurchase(cost: bigint, paid: boolean, account = "1010"): DraftLine[] {
  if (cost <= 0n) throw new Error("Enter the purchase cost");
  const lines = [
    { code: "1420", debit: cost, credit: 0n },
    { code: paid ? account : "2000", debit: 0n, credit: cost },
  ];
  assertBalanced(lines);
  return lines;
}

export function depreciationAmount(cost: bigint, residual: bigint, lifeMonths: number, alreadyPosted: number) {
  if (lifeMonths < 1) throw new Error("Useful life must be at least one month");
  if (residual < 0n || residual > cost) throw new Error("Residual value can't exceed cost");
  if (alreadyPosted >= lifeMonths) return 0n;
  const depreciable = cost - residual;
  const monthly = depreciable / BigInt(lifeMonths);
  if (alreadyPosted === lifeMonths - 1) return depreciable - monthly * BigInt(alreadyPosted);
  return monthly;
}

export function planDepreciation(amount: bigint): DraftLine[] {
  if (amount <= 0n) throw new Error("Nothing to depreciate");
  const lines = [
    { code: "5700", debit: amount, credit: 0n },
    { code: "1410", debit: 0n, credit: amount },
  ];
  assertBalanced(lines);
  return lines;
}

export function planFullOpening(input: {
  cash: bigint;
  bank: bigint;
  receivable: bigint;
  payable: bigint;
  loan: bigint;
  assets: bigint;
}) {
  return planExistingOpening({ ...input, ownerCapital: null });
}

export function agingBucket(due: string, today: string) {
  if (due >= today) return "current" as const;
  const dueDate = Date.parse(`${due}T00:00:00Z`);
  const todayDate = Date.parse(`${today}T00:00:00Z`);
  const days = Math.round((todayDate - dueDate) / 86_400_000);
  if (days <= 30) return "1-30" as const;
  if (days <= 60) return "31-60" as const;
  if (days <= 90) return "61-90" as const;
  return "90+" as const;
}

export function budgetVariance(budget: bigint, actual: bigint) {
  return { remaining: budget - actual, over: actual > budget, variance: actual - budget };
}

export function budgetStanding(budget: bigint, actual: bigint) {
  const variance = budgetVariance(budget, actual);
  if (budget <= 0n) return { ...variance, percent: 0, status: actual > 0n ? ("over" as const) : ("on_track" as const) };
  const percent = Number((actual * 10000n) / budget) / 100;
  const status = actual > budget ? ("over" as const) : percent >= 80 ? ("near_limit" as const) : ("on_track" as const);
  return { ...variance, percent, status };
}

export function nextRecurringDate(from: string, frequency: "weekly" | "monthly" | "quarterly" | "yearly") {
  const [y, m, d] = from.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else if (frequency === "quarterly") date.setUTCMonth(date.getUTCMonth() + 3);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

export function runwayFrom(cash: bigint, monthlyOperating: bigint[]) {
  if (monthlyOperating.length === 0) return { burn: null as string | null, months: null as string | null, note: "Not enough data yet." };
  const average = monthlyOperating.reduce((sum, value) => sum + value, 0n) / BigInt(monthlyOperating.length);
  if (average >= 0n) {
    return {
      burn: null,
      months: null,
      note: "Your recent operating cash flow is not negative, so runway is not currently estimated.",
    };
  }
  const burn = -average;
  const tenths = (cash * 10n) / burn;
  return {
    burn: fromCents(burn),
    months: `${tenths / 10n}.${tenths % 10n}`,
    note: "Estimated runway is cash divided by the average monthly operating cash outflow over the months provided. It is not a forecast.",
  };
}

export type ChangePart = { label: string; impact: bigint };

export function whyProfitChanged(
  previous: { revenue: bigint; expenses: { name: string; amount: bigint }[]; profit: bigint },
  current: { revenue: bigint; expenses: { name: string; amount: bigint }[]; profit: bigint },
): { explained: boolean; delta: bigint; parts: ChangePart[] } {
  const parts: ChangePart[] = [];
  const revenue = current.revenue - previous.revenue;
  if (revenue !== 0n) parts.push({ label: revenue < 0n ? "Revenue decreased" : "Revenue increased", impact: revenue });
  const names = new Set([...previous.expenses.map((row) => row.name), ...current.expenses.map((row) => row.name)]);
  for (const name of names) {
    const before = previous.expenses.find((row) => row.name === name)?.amount ?? 0n;
    const after = current.expenses.find((row) => row.name === name)?.amount ?? 0n;
    const delta = after - before;
    if (delta === 0n) continue;
    parts.push({ label: delta > 0n ? `${name} increased` : `${name} decreased`, impact: -delta });
  }
  const delta = current.profit - previous.profit;
  const explained = parts.reduce((sum, part) => sum + part.impact, 0n) === delta;
  return { explained, delta, parts };
}

export function previousWindow(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  const prevEnd = new Date(start - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { from: iso(prevStart), to: iso(prevEnd) };
}

export function recentMonthRanges(today: string, count: number) {
  const [yearText, monthText] = today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const ranges: { from: string; to: string }[] = [];
  for (let i = count; i >= 1; i -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - i, 1));
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const mm = String(m + 1).padStart(2, "0");
    ranges.push({ from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` });
  }
  return ranges;
}

export function webhookRetryDelayMs(attempt: number) {
  const steps = [60_000, 300_000, 1_800_000, 7_200_000];
  if (attempt >= steps.length) return null;
  return steps[attempt] ?? null;
}

/** Expected schedule only. It never posts a journal. */
export function expectedLoanSchedule(input: { principal: bigint; annualRatePercent: number; termMonths: number }) {
  if (input.principal <= 0n || input.termMonths < 1 || input.termMonths > 360) throw new Error("Enter a principal and a term");
  const rows: { month: number; payment: bigint; principal: bigint; interest: bigint; balance: bigint }[] = [];
  let balance = input.principal;
  if (input.annualRatePercent <= 0) {
    const base = input.principal / BigInt(input.termMonths);
    for (let month = 1; month <= input.termMonths; month += 1) {
      const principal = month === input.termMonths ? balance : base;
      balance -= principal;
      rows.push({ month, payment: principal, principal, interest: 0n, balance });
    }
    return rows;
  }
  const monthlyRate = input.annualRatePercent / 12 / 100;
  const factor = (1 + monthlyRate) ** input.termMonths;
  const payment = BigInt(Math.round(Number(input.principal) * ((monthlyRate * factor) / (factor - 1))));
  for (let month = 1; month <= input.termMonths; month += 1) {
    const interest = BigInt(Math.round(Number(balance) * monthlyRate));
    const principal = month === input.termMonths ? balance : payment - interest;
    if (principal < 0n) throw new Error("This rate and term do not produce a valid schedule");
    balance -= principal;
    rows.push({ month, payment: principal + interest, principal, interest, balance: balance < 0n ? 0n : balance });
  }
  return rows;
}

export const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
const MAX_ATTACHMENT_BYTES = 1_500_000;

export function assertAttachment(mime: string, bytes: number) {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(mime)) throw new Error("Upload a PDF, JPG, or PNG");
  if (bytes <= 0 || bytes > MAX_ATTACHMENT_BYTES) throw new Error("That file must be under 1.5 MB");
}

export function depreciationCap(cost: bigint, residual: bigint, accumulated: bigint) {
  const depreciable = cost - (residual < 0n ? 0n : residual > cost ? cost : residual);
  return { ok: accumulated >= 0n && accumulated <= depreciable, cap: depreciable };
}
