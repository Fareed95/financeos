import type { DraftLine } from "@/lib/ledger";

export const BIZ_ROLES = ["owner", "admin", "accountant", "member", "viewer"] as const;
export type BizRole = (typeof BIZ_ROLES)[number];

export const BIZ_PERMISSIONS = [
  "view_finance",
  "create_records",
  "view_reports",
  "view_equity",
  "manage_equity",
  "manage_team",
  "manage_api_keys",
  "manage_settings",
  "delete_business",
  "view_vendors",
  "manage_vendors",
  "view_bills",
  "manage_bills",
  "pay_bills",
  "view_budgets",
  "manage_budgets",
  "view_assets",
  "manage_assets",
  "view_loans",
  "manage_loans",
  "view_reimbursements",
  "record_personal_business_expense",
  "manage_reimbursements",
] as const;
export type BizPermission = (typeof BIZ_PERMISSIONS)[number];

const GRANTS: Record<BizPermission, readonly BizRole[]> = {
  view_finance: ["owner", "admin", "accountant", "member", "viewer"],
  create_records: ["owner", "admin", "accountant", "member"],
  view_reports: ["owner", "admin", "accountant", "member", "viewer"],
  view_equity: ["owner", "admin"],
  manage_equity: ["owner"],
  manage_team: ["owner", "admin"],
  manage_api_keys: ["owner"],
  manage_settings: ["owner", "admin"],
  delete_business: ["owner"],
  view_vendors: ["owner", "admin", "accountant", "member", "viewer"],
  manage_vendors: ["owner", "admin", "accountant", "member"],
  view_bills: ["owner", "admin", "accountant", "member", "viewer"],
  manage_bills: ["owner", "admin", "accountant", "member"],
  pay_bills: ["owner", "admin", "accountant"],
  view_budgets: ["owner", "admin", "accountant", "member", "viewer"],
  manage_budgets: ["owner", "admin", "accountant"],
  view_assets: ["owner", "admin", "accountant", "member", "viewer"],
  manage_assets: ["owner", "admin", "accountant"],
  view_loans: ["owner", "admin", "accountant", "member", "viewer"],
  manage_loans: ["owner", "admin", "accountant"],
  view_reimbursements: ["owner", "admin", "accountant", "member", "viewer"],
  record_personal_business_expense: ["owner", "admin", "accountant", "member"],
  manage_reimbursements: ["owner", "admin", "accountant"],
};

export function can(role: string, permission: BizPermission) {
  return (GRANTS[permission] as readonly string[]).includes(role);
}

export function assertCan(role: string, permission: BizPermission) {
  if (!can(role, permission)) throw new Error("You don't have access to do that.");
}

const INVITE_ROLES = ["admin", "accountant", "member", "viewer"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export function assertInviteRole(role: string): InviteRole {
  if (!(INVITE_ROLES as readonly string[]).includes(role)) throw new Error("Choose a role. Ownership can't be invited.");
  return role as InviteRole;
}

export type InviteView = "open" | "expired" | "revoked" | "used";

export function inviteState(input: { revokedAt: string | null; acceptedAt: string | null; expiresAt: string; now: number }): InviteView {
  if (input.revokedAt) return "revoked";
  if (input.acceptedAt) return "used";
  if (Date.parse(input.expiresAt) <= input.now) return "expired";
  return "open";
}

/** Only the first open claim wins. A second accept, even concurrent, sees used. */
export function claimInvite(state: InviteView) {
  if (state !== "open") throw new Error(state === "expired" ? "This invite has expired" : state === "revoked" ? "This invite was revoked" : "This invite was already used");
  return "claimed" as const;
}

export function periodRange(today: string, period: string) {
  const [yearText, monthText, dayText] = today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (period === "last_month") {
    const m = month === 1 ? 12 : month - 1;
    const y = month === 1 ? year - 1 : year;
    return { from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)), label: "Last month" };
  }
  if (period === "quarter") {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const endMonth = startMonth + 2;
    return { from: iso(year, startMonth, 1), to: iso(year, endMonth, lastDay(year, endMonth)), label: "This quarter" };
  }
  if (period === "year") {
    const startYear = month >= 4 ? year : year - 1;
    return { from: iso(startYear, 4, 1), to: iso(startYear + 1, 3, 31), label: "This financial year" };
  }
  if (period === "custom") return { from: today, to: today, label: "Custom" };
  return { from: iso(year, month, 1), to: iso(year, month, Math.max(day, lastDay(year, month))), label: "This month" };
}

function line(code: string, debit: bigint, credit: bigint, into: DraftLine[]) {
  if (debit > 0n || credit > 0n) into.push({ code, debit, credit });
}

const PLACE: Record<string, string> = { bank: "1010", cash: "1000", other: "1020" };
const ORIGIN: Record<string, string> = { founder: "3000", existing: "3200", loan: "2300", other: "3100" };

/** Starting money is never revenue. The credit account follows where the money came from. */
export function planStartingMoney(input: { amount: bigint; place: string; origin: string }): DraftLine[] {
  if (input.amount <= 0n) throw new Error("Amount must be greater than zero");
  const debit = PLACE[input.place];
  const credit = ORIGIN[input.origin];
  if (!debit || !credit) throw new Error("Choose where the money is and where it came from");
  return [
    { code: debit, debit: input.amount, credit: 0n },
    { code: credit, debit: 0n, credit: input.amount },
  ];
}

export function assertOpeningAllowed(alreadyPosted: boolean) {
  if (alreadyPosted) throw new Error("Starting balance is already recorded. Add more money as a new contribution.");
}

/** Existing-business opening. The plug is shown, not invented in silence. Null owner capital means the plug is owner capital. */
export function planExistingOpening(input: {
  bank: bigint;
  cash: bigint;
  receivable: bigint;
  payable: bigint;
  loan: bigint;
  assets: bigint;
  ownerCapital: bigint | null;
}) {
  const debits =
    input.bank + input.cash + input.receivable + input.assets;
  const statedCapital = input.ownerCapital ?? 0n;
  const credits = input.payable + input.loan + statedCapital;
  const plug = debits - credits;
  const lines: DraftLine[] = [];
  line("1010", input.bank, 0n, lines);
  line("1000", input.cash, 0n, lines);
  line("1100", input.receivable, 0n, lines);
  line("1400", input.assets, 0n, lines);
  line("2000", 0n, input.payable, lines);
  line("2300", 0n, input.loan, lines);
  if (input.ownerCapital === null) {
    if (plug > 0n) line("3000", 0n, plug, lines);
    else if (plug < 0n) line("3200", -plug, 0n, lines);
  } else {
    line("3000", 0n, statedCapital, lines);
    if (plug > 0n) line("3200", 0n, plug, lines);
    else if (plug < 0n) line("3200", -plug, 0n, lines);
  }
  return { lines, plug, plugIsOwnerCapital: input.ownerCapital === null && plug > 0n };
}
