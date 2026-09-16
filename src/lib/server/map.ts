import type {
  Account,
  AccountType,
  Budget,
  BudgetPeriod,
  Category,
  CategoryType,
  Profile,
  Project,
  ProjectStatus,
  ProjectType,
  Transaction,
  TxnType,
} from "@/lib/types";
import { percentUsed, subMoney } from "@/lib/money";

export function asBool(v: unknown): boolean {
  return v === true || v === "t" || v === "true";
}

export function asStr(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

export function asNumStr(v: unknown): string {
  if (v == null || v === "") return "0.00";
  const s = String(v);
  if (s.includes(".")) {
    const [w, f = ""] = s.split(".");
    return `${w}.${(f + "00").slice(0, 2)}`;
  }
  return `${s}.00`;
}

export function asNullStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

export function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: asStr(row.id),
    fullName: asNullStr(row.full_name),
    avatarUrl: asNullStr(row.avatar_url),
    currency: asStr(row.currency) || "INR",
    theme: asStr(row.theme) || "system",
    onboardingCompleted: asBool(row.onboarding_completed),
  };
}

export function mapAccount(row: Record<string, unknown>): Account {
  return {
    id: asStr(row.id),
    name: asStr(row.name),
    type: asStr(row.type) as AccountType,
    openingBalance: asNumStr(row.opening_balance),
    currentBalance: asNumStr(row.current_balance ?? row.opening_balance),
    currency: asStr(row.currency) || "INR",
    isActive: asBool(row.is_active),
    isDemo: asBool(row.is_demo),
  };
}

export function mapCategory(row: Record<string, unknown>): Category {
  return {
    id: asStr(row.id),
    name: asStr(row.name),
    icon: asStr(row.icon) || "circle",
    type: asStr(row.type) as CategoryType,
    isActive: asBool(row.is_active),
    isDefault: asBool(row.is_default),
  };
}

export function mapProject(row: Record<string, unknown>): Project {
  const budget = asNumStr(row.budget);
  const totalCost = asNumStr(row.total_cost);
  return {
    id: asStr(row.id),
    name: asStr(row.name),
    description: asNullStr(row.description),
    projectType: asStr(row.project_type) as ProjectType,
    startDate: asNullStr(row.start_date),
    endDate: asNullStr(row.end_date),
    budget,
    status: asStr(row.status) as ProjectStatus,
    icon: asStr(row.icon) || "folder",
    isDemo: asBool(row.is_demo),
    totalCost,
    prepaid: asNumStr(row.prepaid),
    duringTrip: asNumStr(row.during_trip),
    remaining: subMoney(budget, totalCost),
    txnCount: Number(row.txn_count ?? 0),
  };
}

export const TXN_SELECT = `
  t.id,
  t.account_id,
  a.name as account_name,
  t.category_id,
  c.name as category_name,
  c.icon as category_icon,
  t.project_id,
  p.name as project_name,
  t.counterparty_account_id,
  ca.name as counterparty_account_name,
  t.type,
  t.amount::text as amount,
  t.transaction_date::text as transaction_date,
  t.transaction_time,
  t.description,
  t.notes,
  t.is_prepaid,
  t.is_committed,
  t.is_demo,
  exists(select 1 from attachments att where att.transaction_id = t.id) as has_receipt,
  t.created_at::text as created_at
`;

export const TXN_FROM = `
  from transactions t
  join accounts a on a.id = t.account_id
  left join categories c on c.id = t.category_id
  left join projects p on p.id = t.project_id
  left join accounts ca on ca.id = t.counterparty_account_id
`;

export function mapTxn(row: Record<string, unknown>): Transaction {
  return {
    id: asStr(row.id),
    accountId: asStr(row.account_id),
    accountName: asStr(row.account_name),
    categoryId: asNullStr(row.category_id),
    categoryName: asNullStr(row.category_name),
    categoryIcon: asNullStr(row.category_icon),
    projectId: asNullStr(row.project_id),
    projectName: asNullStr(row.project_name),
    counterpartyAccountId: asNullStr(row.counterparty_account_id),
    counterpartyAccountName: asNullStr(row.counterparty_account_name),
    type: asStr(row.type) as TxnType,
    amount: asNumStr(row.amount),
    transactionDate: asStr(row.transaction_date).slice(0, 10),
    transactionTime: asNullStr(row.transaction_time),
    description: asNullStr(row.description),
    notes: asNullStr(row.notes),
    isPrepaid: asBool(row.is_prepaid),
    isCommitted: asBool(row.is_committed),
    isDemo: asBool(row.is_demo),
    hasReceipt: asBool(row.has_receipt),
    createdAt: asStr(row.created_at),
  };
}

export function mapBudget(row: Record<string, unknown>): Budget {
  const amount = asNumStr(row.amount);
  const spent = asNumStr(row.spent);
  return {
    id: asStr(row.id),
    name: asStr(row.name),
    amount,
    period: asStr(row.period) as BudgetPeriod,
    startDate: asStr(row.start_date).slice(0, 10),
    endDate: asStr(row.end_date).slice(0, 10),
    categoryId: asNullStr(row.category_id),
    categoryName: asNullStr(row.category_name),
    spent,
    remaining: subMoney(amount, spent),
    percent: percentUsed(spent, amount),
  };
}

export const PROJECT_SELECT = `
  p.id, p.name, p.description, p.project_type,
  p.start_date::text as start_date, p.end_date::text as end_date,
  p.budget::text as budget, p.status, p.icon, p.is_demo,
  coalesce(s.total_cost, 0)::text as total_cost,
  coalesce(s.prepaid, 0)::text as prepaid,
  coalesce(s.during_trip, 0)::text as during_trip,
  coalesce(s.txn_count, 0)::int as txn_count
`;

export const PROJECT_FROM = `
  from projects p
  left join lateral (
    select
      coalesce(sum(case when t.type = 'expense' then t.amount when t.type = 'refund' then -t.amount else 0 end), 0) as total_cost,
      coalesce(sum(case when t.type = 'expense' and t.is_prepaid then t.amount else 0 end), 0) as prepaid,
      coalesce(sum(case
        when t.type = 'expense' and not t.is_prepaid
          and (p.start_date is null or t.transaction_date >= p.start_date)
          and (p.end_date is null or t.transaction_date <= p.end_date)
        then t.amount else 0 end), 0) as during_trip,
      count(*) filter (where t.type in ('expense', 'refund')) as txn_count
    from transactions t
    where t.project_id = p.id and t.user_id = p.user_id and t.is_committed = true
  ) s on true
`;
