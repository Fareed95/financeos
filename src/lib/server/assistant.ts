import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser, ownedAccount, ownedCategory } from "@/lib/server/ensure";
import { mapAccount, mapBudget, mapProject, mapTxn, PROJECT_FROM, PROJECT_SELECT, TXN_FROM, TXN_SELECT } from "@/lib/server/map";
import {
  applyViewerProjectSpend,
  assertNoSettledEdit,
  issueInvite,
  readGroupBalances,
  readMembers,
  writeSettlement,
  writeSplitExpense,
} from "@/lib/server/collab";
import { addMoney, cmpMoney, parseMoney, subMoney } from "@/lib/money";
import { matchMember } from "@/lib/member-match";
import { addDaysISO, publicError } from "@/lib/utils";
import type { Sql } from "@/lib/db";
import type { AccountType, BudgetPeriod, ProjectStatus, ProjectType, TxnType } from "@/lib/types";
import type { SplitMethod } from "@/lib/split";

export type AssistantAction = { tool: string; summary: string; ok: boolean };
export type AssistantChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions: AssistantAction[] | null;
  createdAt: string;
};

const MODEL = "grok-4.5";
const MAX_ROUNDS = 6;
const HISTORY_LIMIT = 16;

function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function monthBounds(date = todayIST()) {
  const [y, m] = date.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { start, end };
}

type ChatMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_overview",
      description: "Current balances, this month's income/spend, accounts, categories, projects, budgets, and recent transactions. Call first if the snapshot feels stale.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_transactions",
      description: "Search or filter transactions. Use for questions like 'food last week' or 'Bangalore spend'.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string" },
          type: { type: "string", enum: ["expense", "income", "transfer", "refund"] },
          account: { type: "string", description: "Account id or name" },
          category: { type: "string", description: "Category id or name" },
          project: { type: "string", description: "Project id or name" },
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
          limit: { type: "integer" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_transaction",
      description: "Record an expense, income, transfer, or refund on your own books. A project tag here is personal spend: it counts on your budget and creates no debt. For a split between people, use add_split_expense.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expense", "income", "transfer", "refund"] },
          amount: { type: "string", description: "Positive amount, e.g. 250 or 250.50" },
          account: { type: "string", description: "Account id or name (UPI, HDFC Bank, Cash…)" },
          category: { type: "string", description: "Category id or name (Food, Travel…)" },
          project: { type: "string", description: "Project/trip id or name" },
          to_account: { type: "string", description: "Destination account for transfers" },
          date: { type: "string", description: "YYYY-MM-DD; default today IST" },
          description: {
            type: "string",
            description:
              "Short English ledger title, 2–6 words. Translate Hindi/Hinglish. Example: 'bus ke jaate time' → 'Bus to Bangalore' or 'Bus fare'. Never store Hinglish or Devanagari.",
          },
          notes: {
            type: "string",
            description: "Optional extra detail in English only. Keep the chat reply in the user's language instead.",
          },
          prepaid: { type: "boolean", description: "True for flights/hotels paid before a trip" },
        },
        required: ["type", "amount", "account"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_transaction",
      description: "Edit an existing transaction by id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["expense", "income", "transfer", "refund"] },
          amount: { type: "string" },
          account: { type: "string" },
          category: { type: "string" },
          project: { type: "string" },
          to_account: { type: "string" },
          date: { type: "string" },
          description: { type: "string", description: "Short English ledger title. Translate Hindi/Hinglish." },
          notes: { type: "string", description: "English only." },
          prepaid: { type: "boolean" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_transaction",
      description: "Delete a transaction by id. Confirm with the user if they did not clearly ask to delete.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_account",
      description: "Create a money account (bank, UPI, cash, card, wallet).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["bank", "cash", "upi", "credit_card", "wallet", "other"] },
          opening_balance: { type: "string" },
        },
        required: ["name", "type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project",
      description: "Create a trip or other project with an optional budget and dates.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["trip", "wedding", "hackathon", "business", "personal", "other"] },
          budget: { type: "string" },
          start_date: { type: "string" },
          end_date: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["planned", "active", "completed", "archived"] },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_project",
      description: "Update a project/trip by id or name.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          name: { type: "string" },
          budget: { type: "string" },
          start_date: { type: "string" },
          end_date: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["planned", "active", "completed", "archived"] },
        },
        required: ["project"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project",
      description: "Trip/project dashboard: budget, prepaid vs during, remaining, daily pace.",
      parameters: {
        type: "object",
        properties: { project: { type: "string" } },
        required: ["project"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_budget",
      description: "Create a spending budget for a period, optionally limited to one category.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "string" },
          period: { type: "string", enum: ["weekly", "monthly", "yearly", "custom"] },
          category: { type: "string" },
          start_date: { type: "string" },
          end_date: { type: "string" },
        },
        required: ["name", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_category",
      description: "Create an expense or income category.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["expense", "income"] },
          icon: { type: "string" },
        },
        required: ["name", "type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reports",
      description: "Income vs expense totals and category/project breakdown for a date range.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_split",
      description:
        "Who owes whom on a project, plus members and your spend. Use for 'kaun kitna owe karta hai', balances, or before settling.",
      parameters: {
        type: "object",
        properties: { project: { type: "string", description: "Project id or name" } },
        required: ["project"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_split_expense",
      description:
        "Split a project expense. shared = the group, private = only the named people, personal = only you (no debt). Do not use add_transaction for a split.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          amount: { type: "string" },
          account: { type: "string", description: "Account that paid, if you paid. Still required as the ledger account." },
          category: { type: "string" },
          description: { type: "string", description: "Short English title. Translate Hindi." },
          date: { type: "string", description: "YYYY-MM-DD. Default today IST." },
          visibility: { type: "string", enum: ["shared", "personal", "private"] },
          paid_by: { type: "string", description: "Member name, or me. Default me." },
          method: { type: "string", enum: ["equal", "exact", "percentage", "shares"] },
          participants: {
            type: "array",
            description: "People in the split. Omit to include every member. value is the exact amount, percent, or shares.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                value: { type: "string" },
              },
              required: ["name"],
              additionalProperties: false,
            },
          },
        },
        required: ["project", "amount", "account", "description"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "settle_project",
      description:
        "Record a real payment that clears a shared debt. Omit amount to settle the full suggested payment. Never invent a larger amount. Does not clear private debts.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          from: { type: "string", description: "Who paid. Name or me. Omit to use the suggested payment." },
          to: { type: "string", description: "Who received the money." },
          amount: { type: "string" },
          method: { type: "string", enum: ["upi", "cash", "bank", "other"] },
          note: { type: "string", description: "Short English note." },
        },
        required: ["project"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "invite_to_project",
      description:
        "Create a 14-day invite link and turn the project into a shared one. Only the owner. Use when they want to split with someone who is not a member yet.",
      parameters: {
        type: "object",
        properties: { project: { type: "string" } },
        required: ["project"],
        additionalProperties: false,
      },
    },
  },
] as const;

async function resolveByName(
  sql: Sql,
  table: "accounts" | "categories" | "projects",
  userId: string,
  idOrName: string,
) {
  const key = idOrName.trim();
  if (!key) return null;
  const byId = await sql.query<{ id: string; name: string }>(
    `select id, name from ${table} where user_id = $1 and id = $2 limit 1`,
    [userId, key],
  );
  if (byId[0]) return byId[0];
  const exact = await sql.query<{ id: string; name: string }>(
    `select id, name from ${table} where user_id = $1 and lower(name) = lower($2) limit 2`,
    [userId, key],
  );
  if (exact.length === 1) return exact[0];
  const fuzzy = await sql.query<{ id: string; name: string }>(
    `select id, name from ${table} where user_id = $1 and name ilike $2 limit 5`,
    [userId, `%${key}%`],
  );
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) {
    throw new Error(`Multiple ${table} match "${key}": ${fuzzy.map((r) => r.name).join(", ")}. Ask which one.`);
  }
  throw new Error(`No ${table.slice(0, -1)} named "${key}". Create it first or pick from the snapshot.`);
}

async function resolveAccessibleProject(sql: Sql, userId: string, idOrName: string) {
  const key = idOrName.trim();
  if (!key) throw new Error("Which project?");
  const rows = await sql.query<{ id: string; name: string }>(
    `select p.id, p.name from projects p
     where (
       p.user_id = $1 or exists (
         select 1 from project_members m
         where m.project_id = p.id and m.user_id = $1 and m.status = 'active'
       )
     )
     and (p.id = $2 or lower(p.name) = lower($2))
     limit 2`,
    [userId, key],
  );
  if (rows.length === 1) return rows[0]!;
  if (rows.length > 1) throw new Error(`Multiple projects match "${key}". Ask which one.`);
  const fuzzy = await sql.query<{ id: string; name: string }>(
    `select p.id, p.name from projects p
     where (
       p.user_id = $1 or exists (
         select 1 from project_members m
         where m.project_id = p.id and m.user_id = $1 and m.status = 'active'
       )
     )
     and p.name ilike $2
     limit 5`,
    [userId, `%${key}%`],
  );
  if (fuzzy.length === 1) return fuzzy[0]!;
  if (fuzzy.length > 1) {
    throw new Error(`Multiple projects match "${key}": ${fuzzy.map((row) => row.name).join(", ")}. Ask which one.`);
  }
  throw new Error(`No project named "${key}".`);
}

function parseParticipants(raw: unknown): { name: string; value: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return { name: item.trim(), value: "1" };
      if (!item || typeof item !== "object") return { name: "", value: "1" };
      const rec = item as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      const value =
        typeof rec.value === "string" || typeof rec.value === "number" ? String(rec.value).trim() : "1";
      return { name, value: value || "1" };
    })
    .filter((part) => part.name);
}

function safeOrigin(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

const PROJECT_ACCESS = `
  p.user_id = $1 or exists (
    select 1 from project_members m
    where m.project_id = p.id and m.user_id = $1 and m.status = 'active'
  )
`;

async function loadOverview(sql: Sql, userId: string) {
  const today = todayIST();
  const { start, end } = monthBounds(today);
  const [accounts, categories, projects, budgets, recent, stats] = await Promise.all([
    sql<Record<string, unknown>>`
      select id, name, type, opening_balance::text as opening_balance,
             account_balance(id)::text as current_balance, currency, is_active, is_demo
      from accounts where user_id = ${userId}
      order by is_active desc, created_at asc
    `,
    sql<{ id: string; name: string; type: string }>`
      select id, name, type from categories where user_id = ${userId} and is_active = true
      order by type, name
    `,
    sql.query<Record<string, unknown>>(
      `select ${PROJECT_SELECT} ${PROJECT_FROM}
       where (${PROJECT_ACCESS})
         and p.status in ('planned','active','completed')
       order by case p.status when 'active' then 0 when 'planned' then 1 else 2 end, p.created_at desc`,
      [userId],
    ),
    sql<Record<string, unknown>>`
      select b.id, b.name, b.amount::text as amount, b.period,
             b.start_date::text as start_date, b.end_date::text as end_date,
             b.category_id, c.name as category_name,
             coalesce((
               select sum(t.amount) from transactions t
               where t.user_id = b.user_id and t.type = 'expense' and t.is_committed = true
                 and t.transaction_date >= b.start_date and t.transaction_date <= b.end_date
                 and (b.category_id is null or t.category_id = b.category_id)
             ), 0)::text as spent
      from budgets b
      left join categories c on c.id = b.category_id
      where b.user_id = ${userId}
      order by b.start_date desc
    `,
    sql.query<Record<string, unknown>>(
      `select ${TXN_SELECT} ${TXN_FROM}
       where t.user_id = $1
       order by t.transaction_date desc, t.created_at desc
       limit 8`,
      [userId],
    ),
    sql<{ income: string; expense: string }>`
      select
        coalesce(sum(case when type = 'income' then amount else 0 end), 0)::text as income,
        coalesce(sum(case when type = 'expense' then amount when type = 'refund' then -amount else 0 end), 0)::text as expense
      from transactions
      where user_id = ${userId} and is_committed = true
        and transaction_date >= ${start} and transaction_date <= ${end}
    `,
  ]);
  const mappedAccounts = accounts.map(mapAccount);
  const netWorth = mappedAccounts
    .filter((a) => a.isActive)
    .reduce((sum, a) => addMoney(sum, a.currentBalance), "0.00");

  const mappedProjects = await applyViewerProjectSpend(sql, userId, projects.map(mapProject));
  const projectCards = await Promise.all(
    mappedProjects.map(async (project) => {
      const spent = project.collaboration === "collaborative" ? project.viewerSpend : project.totalCost;
      const card: Record<string, unknown> = {
        id: project.id,
        name: project.name,
        type: project.projectType,
        status: project.status,
        collaboration: project.collaboration,
        budget: project.budget,
        spent,
        contributions: project.contributions,
        netCost: project.netCost,
        remaining: project.remaining,
        start: project.startDate,
        end: project.endDate,
      };
      if (project.collaboration !== "collaborative") return card;
      try {
        const [group, balances] = await Promise.all([
          readMembers(sql, userId, project.id),
          readGroupBalances(sql, userId, project.id),
        ]);
        card.members = group.members.map((member) => member.name);
        card.you = balances.you;
        card.payments = balances.payments.map((payment) => ({
          from: payment.fromName,
          to: payment.toName,
          amount: payment.amount,
        }));
      } catch {
        card.members = [];
      }
      return card;
    }),
  );

  return {
    today,
    month: { from: start, to: end, income: stats[0]?.income ?? "0.00", expense: stats[0]?.expense ?? "0.00" },
    netWorth,
    accounts: mappedAccounts.map((a) => ({
      id: a.id, name: a.name, type: a.type, balance: a.currentBalance, active: a.isActive,
    })),
    categories,
    projects: projectCards,
    budgets: budgets.map(mapBudget).map((b) => ({
      id: b.id, name: b.name, amount: b.amount, spent: b.spent, remaining: b.remaining,
      period: b.period, category: b.categoryName,
    })),
    recent: recent.map(mapTxn).map((t) => ({
      id: t.id, type: t.type, amount: t.amount, date: t.transactionDate,
      description: t.description, account: t.accountName, category: t.categoryName, project: t.projectName,
    })),
  };
}

async function runTool(
  sql: Sql,
  userId: string,
  name: string,
  rawArgs: Record<string, unknown>,
  origin = "",
): Promise<{ result: unknown; summary: string; mutated: boolean }> {
  const str = (k: string) => {
    const v = rawArgs[k];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  };
  const bool = (k: string) => rawArgs[k] === true;

  if (name === "get_overview") {
    const overview = await loadOverview(sql, userId);
    return { result: overview, summary: "Looked up the ledger", mutated: false };
  }

  if (name === "list_transactions") {
    const clauses = ["t.user_id = $1"];
    const params: unknown[] = [userId];
    const add = (value: unknown, frag: string) => {
      params.push(value);
      clauses.push(frag.replace("?", `$${params.length}`));
    };
    if (str("from")) add(str("from"), "t.transaction_date >= ?");
    if (str("to")) add(str("to"), "t.transaction_date <= ?");
    if (str("type")) add(str("type"), "t.type = ?");
    if (str("account")) {
      const acc = await resolveByName(sql, "accounts", userId, str("account"));
      if (acc) add(acc.id, "t.account_id = ?");
    }
    if (str("category")) {
      const cat = await resolveByName(sql, "categories", userId, str("category"));
      if (cat) add(cat.id, "t.category_id = ?");
    }
    if (str("project")) {
      const proj = await resolveAccessibleProject(sql, userId, str("project"));
      clauses[0] = `(
        t.visibility = 'shared'
        or (t.visibility = 'personal' and t.user_id = $1)
        or (
          t.visibility = 'private'
          and (
            t.user_id = $1
            or t.paid_by_user_id = $1
            or exists (
              select 1 from expense_splits es
              where es.transaction_id = t.id and es.user_id = $1
            )
          )
        )
      )`;
      add(proj.id, "t.project_id = ?");
    }
    if (str("search")) {
      const q = `%${str("search")}%`;
      params.push(q, q);
      clauses.push(`(t.description ilike $${params.length - 1} or t.notes ilike $${params.length})`);
    }
    const limit = Math.min(Math.max(Number(rawArgs.limit) || 20, 1), 50);
    params.push(limit);
    const rows = await sql.query<Record<string, unknown>>(
      `select ${TXN_SELECT} ${TXN_FROM}
       where ${clauses.join(" and ")}
       order by t.transaction_date desc, t.created_at desc
       limit $${params.length}`,
      params,
    );
    const items = rows.map(mapTxn).map((t) => ({
      id: t.id, type: t.type, amount: t.amount, date: t.transactionDate,
      description: t.description, account: t.accountName, category: t.categoryName,
      project: t.projectName, visibility: t.visibility, paidBy: t.paidByName,
    }));
    return { result: { count: items.length, items }, summary: `Found ${items.length} transactions`, mutated: false };
  }

  if (name === "add_transaction" || name === "update_transaction") {
    const isUpdate = name === "update_transaction";
    const id = isUpdate ? str("id") : crypto.randomUUID();
    if (isUpdate && !id) throw new Error("Need a transaction id to edit");
    let existing: Awaited<ReturnType<typeof mapTxn>> | null = null;
    if (isUpdate) {
      const rows = await sql.query<Record<string, unknown>>(
        `select ${TXN_SELECT} ${TXN_FROM} where t.id = $1 and t.user_id = $2`,
        [id, userId],
      );
      if (!rows[0]) throw new Error("Transaction not found");
      existing = mapTxn(rows[0]);
    }
    if (isUpdate) {
      if ((existing?.visibility ?? "personal") !== "personal") {
        throw new Error("Shared and private splits can't be edited. Add a new expense instead.");
      }
      await assertNoSettledEdit(sql, id);
    }
    const type = (str("type") || existing?.type || "expense") as TxnType;
    if (!["expense", "income", "transfer", "refund"].includes(type)) throw new Error("Invalid transaction type");
    const amount = parseMoney(str("amount") || existing?.amount || "");
    if (amount === "0.00" || amount.startsWith("-")) throw new Error("Amount must be greater than zero");
    const accountRef = str("account") || existing?.accountId || "";
    const acc = await resolveByName(sql, "accounts", userId, accountRef);
    if (!acc) throw new Error("Choose an account");
    if (!(await ownedAccount(sql, userId, acc.id))) throw new Error("Account not found");
    let categoryId: string | null = existing?.categoryId ?? null;
    if (str("category")) {
      const cat = await resolveByName(sql, "categories", userId, str("category"));
      if (cat) {
        if (!(await ownedCategory(sql, userId, cat.id))) throw new Error("Category not found");
        categoryId = cat.id;
      }
    }
    let projectId: string | null = existing?.projectId ?? null;
    if (Object.hasOwn(rawArgs, "project")) {
      if (!str("project")) projectId = null;
      else {
        const proj = await resolveAccessibleProject(sql, userId, str("project"));
        projectId = proj.id;
      }
    }
    let counterparty: string | null = existing?.counterpartyAccountId ?? null;
    if (type === "transfer") {
      const destRef = str("to_account") || existing?.counterpartyAccountId || "";
      const dest = await resolveByName(sql, "accounts", userId, destRef);
      if (!dest) throw new Error("Transfer needs a destination account");
      if (dest.id === acc.id) throw new Error("Transfer needs two different accounts");
      counterparty = dest.id;
    } else {
      counterparty = null;
    }
    const date = str("date") || existing?.transactionDate || todayIST();
    const description = Object.hasOwn(rawArgs, "description")
      ? str("description") || null
      : existing?.description ?? null;
    const notes = Object.hasOwn(rawArgs, "notes") ? str("notes") || null : existing?.notes ?? null;
    const prepaid = Object.hasOwn(rawArgs, "prepaid") ? bool("prepaid") : existing?.isPrepaid ?? false;

    if (isUpdate) {
      await sql`
        update transactions set
          account_id = ${acc.id}, category_id = ${categoryId}, project_id = ${projectId},
          counterparty_account_id = ${counterparty}, type = ${type}, amount = ${amount}::numeric,
          transaction_date = ${date}::date, description = ${description}, notes = ${notes},
          is_prepaid = ${prepaid}, updated_at = now()
        where id = ${id} and user_id = ${userId}
      `;
    } else {
      await sql`
        insert into transactions (
          id, user_id, account_id, category_id, project_id, counterparty_account_id,
          type, amount, transaction_date, description, notes, is_prepaid, is_committed
        ) values (
          ${id}, ${userId}, ${acc.id}, ${categoryId}, ${projectId}, ${counterparty},
          ${type}, ${amount}::numeric, ${date}::date, ${description}, ${notes}, ${prepaid}, true
        )
      `;
    }
    const verb = isUpdate ? "Updated" : "Added";
    const label = description || type;
    return {
      result: { id, type, amount, account: acc.name, date, description },
      summary: `${verb} ${type} ₹${amount} · ${label}`,
      mutated: true,
    };
  }

  if (name === "delete_transaction") {
    const id = str("id");
    const existing = await sql<{ id: string }>`
      select id from transactions where id = ${id} and user_id = ${userId}
    `;
    if (!existing[0]) throw new Error("Transaction not found");
    await assertNoSettledEdit(sql, id);
    const rows = await sql<{ id: string }>`
      delete from transactions where id = ${id} and user_id = ${userId} returning id
    `;
    if (!rows[0]) throw new Error("Transaction not found");
    return { result: { ok: true, id }, summary: "Deleted that transaction", mutated: true };
  }

  if (name === "create_account") {
    const accName = str("name");
    const type = (str("type") || "other") as AccountType;
    if (!accName) throw new Error("Give the account a name");
    const opening = parseMoney(str("opening_balance") || "0");
    const id = crypto.randomUUID();
    await sql`
      insert into accounts (id, user_id, name, type, opening_balance, currency)
      values (${id}, ${userId}, ${accName}, ${type}, ${opening}::numeric, 'INR')
    `;
    return { result: { id, name: accName, type, opening }, summary: `Opened ${accName}`, mutated: true };
  }

  if (name === "create_project") {
    const projName = str("name");
    if (!projName) throw new Error("Give the project a name");
    const type = (str("type") || "trip") as ProjectType;
    const status = (str("status") || "active") as ProjectStatus;
    const budget = parseMoney(str("budget") || "0");
    const id = crypto.randomUUID();
    await sql`
      insert into projects (id, user_id, name, description, project_type, start_date, end_date, budget, status, icon)
      values (
        ${id}, ${userId}, ${projName}, ${str("description") || null}, ${type},
        ${str("start_date") || null}, ${str("end_date") || null}, ${budget}::numeric, ${status}, 'folder'
      )
    `;
    return { result: { id, name: projName, type, budget }, summary: `Created project ${projName}`, mutated: true };
  }

  if (name === "update_project") {
    const proj = await resolveByName(sql, "projects", userId, str("project"));
    if (!proj) throw new Error("Project not found");
    const currentRows = await sql.query<Record<string, unknown>>(
      `select ${PROJECT_SELECT} ${PROJECT_FROM} where p.id = $1 and p.user_id = $2`,
      [proj.id, userId],
    );
    const current = currentRows[0] ? mapProject(currentRows[0]) : null;
    if (!current) throw new Error("Project not found");
    const nextName = str("name") || current.name;
    const nextBudget = str("budget") ? parseMoney(str("budget")) : current.budget;
    const nextStatus = (str("status") || current.status) as ProjectStatus;
    const nextStart = Object.hasOwn(rawArgs, "start_date") ? str("start_date") || null : current.startDate;
    const nextEnd = Object.hasOwn(rawArgs, "end_date") ? str("end_date") || null : current.endDate;
    const nextDesc = Object.hasOwn(rawArgs, "description") ? str("description") || null : current.description;
    await sql`
      update projects set
        name = ${nextName}, budget = ${nextBudget}::numeric, status = ${nextStatus},
        start_date = ${nextStart}, end_date = ${nextEnd}, description = ${nextDesc}, updated_at = now()
      where id = ${proj.id} and user_id = ${userId}
    `;
    return { result: { id: proj.id, name: nextName }, summary: `Updated ${nextName}`, mutated: true };
  }

  if (name === "get_project") {
    const proj = await resolveAccessibleProject(sql, userId, str("project"));
    const rows = await sql.query<Record<string, unknown>>(
      `select ${PROJECT_SELECT} ${PROJECT_FROM}
       where p.id = $2 and (${PROJECT_ACCESS})`,
      [userId, proj.id],
    );
    if (!rows[0]) throw new Error("Project not found");
    const [project] = await applyViewerProjectSpend(sql, userId, [mapProject(rows[0])]);
    if (!project) throw new Error("Project not found");
    const spent = project.collaboration === "collaborative" ? project.viewerSpend : project.totalCost;
    const result: Record<string, unknown> = {
      id: project.id,
      name: project.name,
      type: project.projectType,
      status: project.status,
      collaboration: project.collaboration,
      dates: { start: project.startDate, end: project.endDate },
      budget: project.budget,
      total: spent,
      contributions: project.contributions,
      netCost: project.netCost,
      prepaid: project.prepaid,
      during: project.duringTrip,
      remaining: project.remaining,
      txnCount: project.txnCount,
    };
    if (project.collaboration === "collaborative") {
      const [group, balances] = await Promise.all([
        readMembers(sql, userId, project.id),
        readGroupBalances(sql, userId, project.id),
      ]);
      result.members = group.members.map((member) => ({ name: member.name, role: member.role }));
      result.you = balances.you;
      result.payments = balances.payments.map((payment) => ({
        from: payment.fromName,
        to: payment.toName,
        amount: payment.amount,
      }));
      result.privatePayments = balances.privatePayments.map((payment) => ({
        from: payment.fromName,
        to: payment.toName,
        amount: payment.amount,
      }));
    }
    return {
      result,
      summary: `Checked ${project.name}`,
      mutated: false,
    };
  }

  if (name === "create_budget") {
    const bName = str("name");
    if (!bName) throw new Error("Give the budget a name");
    const amount = parseMoney(str("amount"));
    const period = (str("period") || "monthly") as BudgetPeriod;
    let start = str("start_date");
    let end = str("end_date");
    if (!start || !end) {
      if (period === "weekly") {
        start = start || todayIST();
        end = end || addDaysISO(start, 6);
      } else if (period === "yearly") {
        const y = todayIST().slice(0, 4);
        start = start || `${y}-01-01`;
        end = end || `${y}-12-31`;
      } else {
        const bounds = monthBounds();
        start = start || bounds.start;
        end = end || bounds.end;
      }
    }
    let categoryId: string | null = null;
    if (str("category")) {
      const cat = await resolveByName(sql, "categories", userId, str("category"));
      if (cat) categoryId = cat.id;
    }
    const id = crypto.randomUUID();
    await sql`
      insert into budgets (id, user_id, name, amount, period, start_date, end_date, category_id)
      values (${id}, ${userId}, ${bName}, ${amount}::numeric, ${period}, ${start}::date, ${end}::date, ${categoryId})
    `;
    return { result: { id, name: bName, amount, period, start, end }, summary: `Set budget ${bName} ₹${amount}`, mutated: true };
  }

  if (name === "create_category") {
    const cName = str("name");
    const type = str("type") === "income" ? "income" : "expense";
    if (!cName) throw new Error("Give the category a name");
    const id = crypto.randomUUID();
    await sql`
      insert into categories (id, user_id, name, icon, type, is_active, is_default)
      values (${id}, ${userId}, ${cName}, ${str("icon") || "circle"}, ${type}, true, false)
    `;
    return { result: { id, name: cName, type }, summary: `Added category ${cName}`, mutated: true };
  }

  if (name === "get_reports") {
    const { start, end } = monthBounds();
    const from = str("from") || start;
    const to = str("to") || end;
    const [totals, byCategory] = await Promise.all([
      sql<{ income: string; expense: string }>`
        select
          coalesce(sum(case when type = 'income' then amount else 0 end), 0)::text as income,
          coalesce(sum(case when type = 'expense' then amount when type = 'refund' then -amount else 0 end), 0)::text as expense
        from transactions
        where user_id = ${userId} and is_committed = true
          and transaction_date >= ${from} and transaction_date <= ${to}
      `,
      sql<{ name: string; amount: string }>`
        select coalesce(c.name, 'Uncategorized') as name, coalesce(sum(t.amount), 0)::text as amount
        from transactions t
        left join categories c on c.id = t.category_id
        where t.user_id = ${userId} and t.type = 'expense' and t.is_committed = true
          and t.transaction_date >= ${from} and t.transaction_date <= ${to}
        group by c.name
        order by sum(t.amount) desc
        limit 8
      `,
    ]);
    const income = totals[0]?.income ?? "0.00";
    const expense = totals[0]?.expense ?? "0.00";
    return {
      result: { from, to, income, expense, savings: subMoney(income, expense), byCategory },
      summary: `Reports ${from} → ${to}`,
      mutated: false,
    };
  }

  if (name === "get_split" || name === "add_split_expense" || name === "settle_project" || name === "invite_to_project") {
    const project = await resolveAccessibleProject(sql, userId, str("project"));
    if (name === "invite_to_project") {
      const invite = await issueInvite(sql, userId, project.id);
      const url = origin ? `${origin}${invite.path}` : invite.path;
      return {
        result: { project: project.name, url, path: invite.path, expiresInDays: 14 },
        summary: `Invite link for ${project.name}`,
        mutated: true,
      };
    }
    if (name === "get_split") {
      const [group, balances] = await Promise.all([
        readMembers(sql, userId, project.id),
        readGroupBalances(sql, userId, project.id),
      ]);
      return {
        result: {
          project: group.projectName,
          collaboration: group.collaboration,
          yourRole: group.role,
          you: balances.you,
          youMeaning: "Positive means you are owed. Negative means you owe. Zero means settled.",
          members: group.members.map((member) => ({ name: member.name, role: member.role })),
          payments: balances.payments.map((payment) => ({
            from: payment.fromName,
            to: payment.toName,
            amount: payment.amount,
          })),
          privatePayments: balances.privatePayments.map((payment) => ({
            from: payment.fromName,
            to: payment.toName,
            amount: payment.amount,
          })),
          spend: balances.spend,
        },
        summary: `Split on ${group.projectName}`,
        mutated: false,
      };
    }
    if (name === "add_split_expense") {
      const visibility = (str("visibility") || "shared") as "shared" | "personal" | "private";
      if (!["shared", "personal", "private"].includes(visibility)) throw new Error("Visibility must be shared, personal, or private");
      const method = (str("method") || "equal") as SplitMethod;
      if (!["equal", "exact", "percentage", "shares"].includes(method)) throw new Error("Split method must be equal, exact, percentage, or shares");
      const acc = await resolveByName(sql, "accounts", userId, str("account"));
      if (!acc) throw new Error("Choose an account");
      let categoryId: string | null = null;
      if (str("category")) {
        const cat = await resolveByName(sql, "categories", userId, str("category"));
        if (cat) categoryId = cat.id;
      }
      const group = await readMembers(sql, userId, project.id);
      const paidBy = matchMember(group.members, str("paid_by") || "me", userId);
      const requested = parseParticipants(rawArgs.participants);
      const chosen = visibility === "personal"
        ? []
        : (requested.length > 0 ? requested : group.members.map((member) => ({ name: member.name, value: "1" }))).map((part) => {
            const member = matchMember(group.members, part.name, userId);
            return { userId: member.userId, value: part.value || "1", name: member.name };
          });
      if (visibility !== "personal" && chosen.length === 0) throw new Error("Pick who shares this expense");
      const saved = await writeSplitExpense(sql, userId, {
        projectId: project.id,
        accountId: acc.id,
        categoryId,
        amount: str("amount"),
        description: str("description"),
        transactionDate: str("date") || todayIST(),
        visibility,
        paidByUserId: paidBy.userId,
        method,
        parts: chosen.map((part) => ({ userId: part.userId, value: part.value })),
      });
      const nameOf = new Map(group.members.map((member) => [member.userId, member.name]));
      const balances = await readGroupBalances(sql, userId, project.id);
      return {
        result: {
          id: saved.id,
          visibility,
          paidBy: paidBy.name,
          splits: saved.allocations.map((row) => ({ name: nameOf.get(row.userId) || "Member", amount: row.allocated })),
          payments: balances.payments.map((payment) => ({
            from: payment.fromName,
            to: payment.toName,
            amount: payment.amount,
          })),
        },
        summary: `Split ${str("description") || "expense"} ₹${parseMoney(str("amount"))} on ${project.name}`,
        mutated: true,
      };
    }
    const [group, balances] = await Promise.all([
      readMembers(sql, userId, project.id),
      readGroupBalances(sql, userId, project.id),
    ]);
    let payment = balances.payments.find((row) => row.fromUserId === userId || row.toUserId === userId) ?? balances.payments[0];
    if (str("from") || str("to")) {
      const from = matchMember(group.members, str("from") || "me", userId);
      const to = matchMember(group.members, str("to") || "me", userId);
      const found = balances.payments.find((row) => row.fromUserId === from.userId && row.toUserId === to.userId);
      if (!found) {
        const priv = balances.privatePayments.find((row) => row.fromUserId === from.userId && row.toUserId === to.userId);
        if (priv) throw new Error(`${priv.fromName} owes ${priv.toName} ₹${priv.amount} privately. A group settlement does not clear that.`);
        throw new Error(`${from.name} does not owe ${to.name} on this project.`);
      }
      payment = found;
    }
    if (!payment) {
      if (balances.privatePayments.length > 0) {
        throw new Error("Only a private debt is open. Group settle does not clear it.");
      }
      throw new Error("Nothing to settle on this project.");
    }
    const amount = str("amount") ? parseMoney(str("amount")) : payment.amount;
    if (cmpMoney(amount, payment.amount) > 0) {
      throw new Error(`That's more than the ₹${payment.amount} owed. Settle ${payment.amount} or less.`);
    }
    const method = (str("method") || "upi") as "upi" | "cash" | "bank" | "other";
    if (!["upi", "cash", "bank", "other"].includes(method)) throw new Error("Payment method must be upi, cash, bank, or other");
    await writeSettlement(sql, userId, {
      projectId: project.id,
      fromUserId: payment.fromUserId,
      toUserId: payment.toUserId,
      amount,
      paymentMethod: method,
      note: str("note") || null,
    });
    const after = await readGroupBalances(sql, userId, project.id);
    return {
      result: {
        from: payment.fromName,
        to: payment.toName,
        amount,
        method,
        remainingPayments: after.payments.map((row) => ({ from: row.fromName, to: row.toName, amount: row.amount })),
      },
      summary: `${payment.fromName} paid ${payment.toName} ₹${amount}`,
      mutated: true,
    };
  }

  throw new Error(`Unknown tool ${name}`);
}

function buildSystemPrompt(overview: Awaited<ReturnType<typeof loadOverview>>, name: string | null) {
  return `You are Kharcha, a calm personal finance operator for ${name || "this person"}.
You speak like a sharp, low-key friend. Understand Hindi, Hinglish, and English. Reply in the language they used — chat is for them.
Today is ${overview.today} (Asia/Kolkata). Default currency INR. Amounts are strings with 2 decimals — never invent floating-point math.

LEDGER LANGUAGE (strict): every field you write to the books is clean, short English.
- transaction description: 2–6 word English title. Translate. Proper nouns stay (HDFC, UPI, Bangalore, Taj).
- notes, new account names, new category names, new project names: English unless the user gave a proper noun they want kept.
- Never store Hinglish, romanized Hindi, or Devanagari in the ledger.
Examples:
  "bus ke jaate time ka 1890" → description "Bus fare", or "Bus to Bangalore" if the trip is Bangalore.
  "aaj 250 coffee UPI pe" → description "Coffee".
  "5k HDFC se UPI" → transfer, no Hinglish description.

You can actually change their books with tools. When they ask to add/log/record spend, income, transfers, accounts, trips, budgets, splits, invites, or settlements — call the tool. Don't describe how to click the UI.
On a personal project, remaining = budget − expenses + income tagged to that project. Never raise the budget because someone paid them back.
On a collaborative project, remaining and spent in the snapshot are YOUR spend (personal expenses plus your share), not the whole group. you > 0 means you are owed. you < 0 means you owe.

SPLITTING
- Your own project expense, with no one else sharing it: add_transaction. It reduces your remaining and creates no debt.
- A cost split with other members: add_split_expense. Default visibility shared and method equal. Use exact, percentage, or shares only when they gave numbers. paid_by is me if they paid.
- private is only the named people and stays out of the group balance.
- Participants must already be members, matched from the snapshot. If the other person is not a member, invite_to_project and give them the url. Do not invent people. Do not split with only yourself.
- get_split answers who pays whom. When they ask to settle, call settle_project in the same turn. If they name more than the debt, omit amount so only the owed payment is recorded, then say you recorded that and not the extra. Never only promise to settle. Private debts are not cleared by settle_project.
- After a split or settlement, trust the tool result. Do not invent a different share.
If an account/category/project is unambiguous from the snapshot (e.g. only one UPI), use it. If two could match, ask one short question instead of guessing.
For deletes, only act when they clearly asked.
Dates without a year are this year. "Aaj" / "today" = ${overview.today}. "Kal" is tomorrow unless they mean yesterday from context.

Keep replies short. After a write, confirm what landed: amount, account, category/project, date — you may confirm in their language even though the ledger title is English. Offer one useful follow-up, not a lecture.
Plain text only — no markdown, no bullet asterisks. Use short line breaks if you list things.

Current ledger snapshot:
${JSON.stringify(overview)}`;
}

async function grokChat(messages: ChatMsg[], apiKey: string) {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 1400,
    }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI error ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
  };
  return body.choices?.[0]?.message ?? { content: "" };
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapRow(row: {
  id: string;
  role: string;
  content: string;
  actions: unknown;
  created_at: string;
}): AssistantChatMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    actions: Array.isArray(row.actions) ? (row.actions as AssistantAction[]) : null,
    createdAt: row.created_at,
  };
}

export const listAssistantMessages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AssistantChatMessage[]> => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{
        id: string;
        role: string;
        content: string;
        actions: unknown;
        created_at: string;
      }>`
        select id, role, content, actions, created_at::text as created_at
        from assistant_messages
        where user_id = ${context.userId}
        order by created_at asc
        limit 80
      `;
      return rows.map(mapRow);
    } catch (err) {
      publicError(err, "Couldn't load chat.");
    }
  });

export const clearAssistantHistory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await sql`delete from assistant_messages where user_id = ${context.userId}`;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't clear chat.");
    }
  });

export const sendAssistantMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { message: string; origin?: string }) => data)
  .handler(async ({ context, data }): Promise<{
    message: AssistantChatMessage;
    mutated: boolean;
  }> => {
    try {
      const apiKey = process.env.XAI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error("AI isn't available in this environment yet.");
      }
      const text = data.message.trim();
      if (!text) throw new Error("Say something first.");
      if (text.length > 4000) throw new Error("That's too long — shorten it a bit.");

      const { sql, profile } = await ensureUser(context.userId);
      const userId = context.userId;
      const userMsgId = crypto.randomUUID();
      await sql`
        insert into assistant_messages (id, user_id, role, content)
        values (${userMsgId}, ${userId}, 'user', ${text})
      `;

      const history = await sql<{ role: string; content: string }>`
        select role, content from assistant_messages
        where user_id = ${userId}
        order by created_at desc
        limit ${HISTORY_LIMIT}
      `;
      const chronological = [...history].reverse();

      const overview = await loadOverview(sql, userId);
      const messages: ChatMsg[] = [
        { role: "system", content: buildSystemPrompt(overview, profile.fullName) },
        ...chronological.map((m) => ({
          role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
          content: m.content,
        })),
      ];

      const actions: AssistantAction[] = [];
      let mutated = false;
      let reply = "";

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const msg = await grokChat(messages, apiKey);
        const calls = msg.tool_calls ?? [];
        if (calls.length === 0) {
          reply = (msg.content ?? "").trim();
          break;
        }
        messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
        for (const call of calls) {
          const fn = call.function?.name ?? "";
          const args = parseArgs(call.function?.arguments ?? "");
          try {
            const out = await runTool(sql, userId, fn, args, safeOrigin(data.origin ?? ""));
            mutated = mutated || out.mutated;
            actions.push({ tool: fn, summary: out.summary, ok: true });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(out.result),
            });
          } catch (err) {
            const error = err instanceof Error ? err.message : "Tool failed";
            actions.push({ tool: fn, summary: error, ok: false });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error }),
            });
          }
        }
      }

      if (!reply) {
        reply = mutated
          ? "Done — that's on the ledger now."
          : "I couldn't finish that. Try again in a simpler sentence.";
      }

      const assistantId = crypto.randomUUID();
      const actionsJson = actions.length ? JSON.stringify(actions) : null;
      await sql`
        insert into assistant_messages (id, user_id, role, content, actions)
        values (${assistantId}, ${userId}, 'assistant', ${reply}, ${actionsJson}::jsonb)
      `;
      const saved = await sql<{
        id: string;
        role: string;
        content: string;
        actions: unknown;
        created_at: string;
      }>`
        select id, role, content, actions, created_at::text as created_at
        from assistant_messages where id = ${assistantId}
      `;
      return { message: mapRow(saved[0]!), mutated };
    } catch (err) {
      publicError(err, "Couldn't talk to the assistant.");
    }
  });
