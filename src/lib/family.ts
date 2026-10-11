/** Household math. Contributions are not ownership and are not personal salary. */

export type FamilyEvent =
  | { kind: "contribution"; person: string; amount: bigint; intoAccount: boolean }
  | { kind: "expense"; amount: bigint; paidFrom: "family" | "personal"; reimburse: boolean; person: string; category?: string }
  | { kind: "payback"; person: string; amount: bigint }
  | { kind: "goal"; amount: bigint };

export function applyHousehold(startCash: bigint, events: FamilyEvent[]) {
  let cash = startCash;
  let added = 0n;
  let spent = 0n;
  let saved = 0n;
  const due = new Map<string, bigint>();
  const byCategory = new Map<string, bigint>();
  const byPerson = new Map<string, bigint>();
  for (const event of events) {
    if (event.kind === "contribution") {
      added += event.amount;
      byPerson.set(event.person, (byPerson.get(event.person) ?? 0n) + event.amount);
      if (event.intoAccount) cash += event.amount;
      continue;
    }
    if (event.kind === "goal") {
      if (event.amount > cash) throw new Error("Family money is short");
      cash -= event.amount;
      saved += event.amount;
      continue;
    }
    if (event.kind === "payback") {
      const open = due.get(event.person) ?? 0n;
      if (event.amount > open) throw new Error("Nothing left to return");
      if (event.amount > cash) throw new Error("Family money is short");
      due.set(event.person, open - event.amount);
      cash -= event.amount;
      continue;
    }
    spent += event.amount;
    const category = event.category || "Other";
    byCategory.set(category, (byCategory.get(category) ?? 0n) + event.amount);
    if (event.paidFrom === "family") {
      if (event.amount > cash) throw new Error("Family money is short");
      cash -= event.amount;
    } else if (event.reimburse) {
      due.set(event.person, (due.get(event.person) ?? 0n) + event.amount);
    }
  }
  return { cash, added, spent, saved, due, byCategory, byPerson };
}

/** Personal salary stays personal. Only an explicit contribution enters the household. */
export function splitPersonalAndFamily(input: { salary: bigint; contribution: bigint }) {
  if (input.contribution > input.salary) throw new Error("Contribution is larger than the money set aside");
  return {
    personalIncome: input.salary,
    personalKept: input.salary - input.contribution,
    familySeesSalary: false,
    familyAdded: input.contribution,
  };
}

/** Moving money between Personal and Family does not create income or an expense. */
export function planPersonalToFamily(amount: bigint) {
  if (amount <= 0n) throw new Error("Enter an amount");
  return {
    personal: { direction: "out" as const, amount, countsAsExpense: false, countsAsIncome: false },
    family: { direction: "in" as const, amount, countsAsNewWealth: false },
    combinedChange: 0n,
  };
}

export function goalProgress(saved: bigint, target: bigint) {
  if (target <= 0n) return 0;
  const pct = Number((saved * 10000n) / target) / 100;
  return Math.min(100, Math.round(pct));
}

export function familyNetWorth(input: { cash: bigint; goals?: bigint; investments: bigint; liabilities: bigint; hasValuation: boolean }) {
  if (!input.hasValuation) return null;
  return input.cash + (input.goals ?? 0n) + input.investments - input.liabilities;
}
