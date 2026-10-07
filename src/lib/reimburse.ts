import { assertBalanced, type DraftLine } from "./ledger.ts";

/** Control account for money the business owes back to people who paid expenses themselves. */
export const REIMBURSE_CODE = "2500";

export const CASH_PLACES = {
  bank: "1010",
  cash: "1000",
  petty: "1020",
} as const;

export type CashPlace = keyof typeof CASH_PLACES;
export type SpendSource = "business" | "personal" | "unpaid";

export function cashCode(place: string) {
  const code = CASH_PLACES[place as CashPlace];
  if (!code) throw new Error("Choose bank, cash, or petty cash");
  return code;
}

/**
 * A business expense. Company cash moves only when the business account pays.
 * A personal payment credits the team-member liability, not revenue, equity, or a split.
 * Not paid yet credits accounts payable.
 */
export function planSpend(input: { expenseCode: string; amount: bigint; source: SpendSource; place?: string }): DraftLine[] {
  if (input.amount <= 0n) throw new Error("Amount must be greater than zero");
  if (!/^\d{4}$/.test(input.expenseCode) || input.expenseCode === REIMBURSE_CODE) {
    throw new Error("Choose an expense account");
  }
  let credit = "2000";
  if (input.source === "business") credit = cashCode(input.place || "bank");
  else if (input.source === "personal") credit = REIMBURSE_CODE;
  else if (input.source !== "unpaid") throw new Error("Choose how this was paid");
  const lines: DraftLine[] = [
    { code: input.expenseCode, debit: input.amount, credit: 0n },
    { code: credit, debit: 0n, credit: input.amount },
  ];
  assertBalanced(lines);
  return lines;
}

/** Returns money already spent for the business. Does not post the expense again. */
export function planReimbursement(amount: bigint, place: string): DraftLine[] {
  if (amount <= 0n) throw new Error("Enter an amount");
  const lines: DraftLine[] = [
    { code: REIMBURSE_CODE, debit: amount, credit: 0n },
    { code: cashCode(place), debit: 0n, credit: amount },
  ];
  assertBalanced(lines);
  return lines;
}

export function planCashTransfer(amount: bigint, from: string, to: string): DraftLine[] {
  if (amount <= 0n) throw new Error("Enter an amount");
  const debit = cashCode(to);
  const credit = cashCode(from);
  if (debit === credit) throw new Error("Choose two different accounts");
  const lines: DraftLine[] = [
    { code: debit, debit: amount, credit: 0n },
    { code: credit, debit: 0n, credit: amount },
  ];
  assertBalanced(lines);
  return lines;
}

export type OpenSlice = { id: string; open: bigint };

/** Oldest first. Refuses to pay more than what is still owed. Does not change the expense amount. */
export function allocateReimbursement(expenses: OpenSlice[], pay: bigint) {
  if (pay <= 0n) throw new Error("Enter an amount");
  let left = pay;
  const lines: { id: string; take: bigint }[] = [];
  for (const expense of expenses) {
    if (left === 0n) break;
    if (expense.open <= 0n) continue;
    const take = expense.open < left ? expense.open : left;
    lines.push({ id: expense.id, take });
    left -= take;
  }
  if (left !== 0n) throw new Error("That is more than this person is still owed");
  return lines;
}

export function stillDue(open: bigint, pay: bigint) {
  if (pay <= 0n || pay > open) throw new Error("That is more than this person is still owed");
  return open - pay;
}

/** Cash after vendor bills and team reimbursements. Not a legal "free cash" figure. */
export function cashCommitments(cash: bigint, vendors: bigint, team: bigint) {
  return { cash, vendors, team, after: cash - vendors - team };
}

/**
 * Models the database lock: the first payment that still fits is applied.
 * A second attempt for the same outstanding amount does not pay twice.
 */
export function onePaymentWins(outstanding: bigint, attempts: bigint[]) {
  let left = outstanding;
  const applied: bigint[] = [];
  for (const attempt of attempts) {
    if (attempt <= 0n || attempt > left) {
      applied.push(0n);
      continue;
    }
    left -= attempt;
    applied.push(attempt);
  }
  return { applied, left };
}

export function assertCanRecordFor(roleCanManage: boolean, actorId: string, payerId: string) {
  if (actorId === payerId) return;
  if (!roleCanManage) throw new Error("You can record only what you paid yourself");
}
