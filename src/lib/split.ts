import { fromCents, parseMoney, toCents } from "./money.ts";

export type SplitMethod = "equal" | "exact" | "percentage" | "shares";

export type SplitInput = { userId: string; value: string };

export type Allocation = { userId: string; allocated: string };

export type NetBalance = { userId: string; cents: bigint };

export type SettlementTransfer = { fromUserId: string; toUserId: string; amount: string };

function assertPositiveTotal(total: string): bigint {
  const cents = toCents(parseMoney(total));
  if (cents <= 0n) throw new Error("Amount must be greater than zero");
  return cents;
}

function finish(parts: SplitInput[], cents: bigint[]): Allocation[] {
  return parts.map((p, i) => ({ userId: p.userId, allocated: fromCents(cents[i] ?? 0n) }));
}

/** Give leftover cents to the earliest indexes so the sum matches exactly. */
function distribute(total: bigint, weights: bigint[]): bigint[] {
  const sumW = weights.reduce((s, w) => s + w, 0n);
  if (sumW <= 0n) throw new Error("Split weights must be greater than zero");
  const base = weights.map((w) => (total * w) / sumW);
  let used = base.reduce((s, n) => s + n, 0n);
  let i = 0;
  while (used < total) {
    const idx = i % base.length;
    base[idx] = (base[idx] ?? 0n) + 1n;
    used += 1n;
    i += 1;
  }
  while (used > total) {
    const idx = i % base.length;
    if ((base[idx] ?? 0n) > 0n) {
      base[idx] = (base[idx] ?? 0n) - 1n;
      used -= 1n;
    }
    i += 1;
    if (i > base.length * 3) break;
  }
  return base;
}

export function allocateSplits(total: string, method: SplitMethod, parts: SplitInput[]): Allocation[] {
  if (parts.length === 0) throw new Error("Pick at least one person");
  const ids = new Set<string>();
  for (const p of parts) {
    if (!p.userId) throw new Error("Each split needs a person");
    if (ids.has(p.userId)) throw new Error("Duplicate person in the split");
    ids.add(p.userId);
  }
  const cents = assertPositiveTotal(total);

  if (method === "equal") {
    return finish(parts, distribute(cents, parts.map(() => 1n)));
  }

  if (method === "exact") {
    const amounts = parts.map((p) => toCents(parseMoney(p.value || "0")));
    if (amounts.some((n) => n < 0n)) throw new Error("Amounts can't be negative");
    const sum = amounts.reduce((s, n) => s + n, 0n);
    if (sum !== cents) throw new Error("Exact amounts must add up to the total");
    return finish(parts, amounts);
  }

  if (method === "percentage") {
    const bps = parts.map((p) => {
      const n = Number(p.value);
      if (!Number.isFinite(n) || n < 0) throw new Error("Percentages can't be negative");
      return BigInt(Math.round(n * 100));
    });
    const sum = bps.reduce((s, n) => s + n, 0n);
    if (sum !== 10000n) throw new Error("Percentages must add up to 100");
    return finish(parts, distribute(cents, bps));
  }

  const shares = parts.map((p) => {
    const n = BigInt(String(p.value || "0").split(".")[0] || "0");
    if (n < 0n) throw new Error("Shares can't be negative");
    return n;
  });
  if (shares.every((n) => n === 0n)) throw new Error("Add at least one share");
  return finish(parts, distribute(cents, shares));
}

export function applyExpense(
  nets: Map<string, bigint>,
  paidBy: string,
  allocations: Allocation[],
): void {
  const paid = allocations.reduce((s, a) => s + toCents(a.allocated), 0n);
  nets.set(paidBy, (nets.get(paidBy) ?? 0n) + paid);
  for (const a of allocations) {
    nets.set(a.userId, (nets.get(a.userId) ?? 0n) - toCents(a.allocated));
  }
}

export function applySettlement(
  nets: Map<string, bigint>,
  fromUserId: string,
  toUserId: string,
  amount: string,
): void {
  const cents = toCents(parseMoney(amount));
  nets.set(fromUserId, (nets.get(fromUserId) ?? 0n) + cents);
  nets.set(toUserId, (nets.get(toUserId) ?? 0n) - cents);
}

/** Debtors pay creditors. Nets are preserved. Deterministic by user id. */
export function simplifyDebts(nets: NetBalance[]): SettlementTransfer[] {
  const debtors = nets
    .filter((n) => n.cents < 0n)
    .map((n) => ({ userId: n.userId, cents: -n.cents }))
    .sort((a, b) => (a.cents === b.cents ? a.userId.localeCompare(b.userId) : a.cents > b.cents ? -1 : 1));
  const creditors = nets
    .filter((n) => n.cents > 0n)
    .map((n) => ({ userId: n.userId, cents: n.cents }))
    .sort((a, b) => (a.cents === b.cents ? a.userId.localeCompare(b.userId) : a.cents > b.cents ? -1 : 1));

  const out: SettlementTransfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    if (!d || !c) break;
    const pay = d.cents < c.cents ? d.cents : c.cents;
    if (pay > 0n) {
      out.push({ fromUserId: d.userId, toUserId: c.userId, amount: fromCents(pay) });
    }
    d.cents -= pay;
    c.cents -= pay;
    if (d.cents === 0n) i += 1;
    if (c.cents === 0n) j += 1;
  }
  return out;
}

export type SpendSummary = {
  groupSpend: string;
  personalSpend: string;
  yourShare: string;
  youPaid: string;
  mySpend: string;
};

function allocatedTo(rows: Allocation[], userId: string): bigint {
  return rows.reduce((sum, row) => (row.userId === userId ? sum + toCents(row.allocated) : sum), 0n);
}

/**
 * Group spend is the full shared bills.
 * My spend is personal expenses plus my allocated slice of shared and private bills.
 * Private bills are not part of groupSpend.
 */
export function summarizeSpend(input: {
  viewerId: string;
  shared: { paidBy: string; amount: string; allocations: Allocation[] }[];
  personal: { userId: string; amount: string }[];
  privateOnes: { paidBy: string; amount: string; allocations: Allocation[] }[];
}): SpendSummary {
  let group = 0n;
  let yourShare = 0n;
  let youPaid = 0n;
  for (const expense of input.shared) {
    const cents = toCents(parseMoney(expense.amount));
    group += cents;
    if (expense.paidBy === input.viewerId) youPaid += cents;
    yourShare += allocatedTo(expense.allocations, input.viewerId);
  }
  let personal = 0n;
  for (const expense of input.personal) {
    if (expense.userId === input.viewerId) personal += toCents(parseMoney(expense.amount));
  }
  let privateShare = 0n;
  for (const expense of input.privateOnes) {
    privateShare += allocatedTo(expense.allocations, input.viewerId);
  }
  return {
    groupSpend: fromCents(group),
    personalSpend: fromCents(personal),
    yourShare: fromCents(yourShare),
    youPaid: fromCents(youPaid),
    mySpend: fromCents(personal + yourShare + privateShare),
  };
}
