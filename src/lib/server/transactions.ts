import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser, ownedAccount, ownedCategory, ownedProject } from "@/lib/server/ensure";
import { mapTxn, TXN_FROM, TXN_SELECT } from "@/lib/server/map";
import { assertNoSettledEdit, readMembers } from "@/lib/server/collab";
import { notifyProjectActivity } from "@/lib/server/notices";
import { parseMoney } from "@/lib/money";
import { allocateSplits, type SplitMethod } from "@/lib/split";
import { clearSplitLinks, planOpenParts, saveSplitLinks, type OpenPartInput, type ShareLink } from "@/lib/server/split-links";
import { publicError } from "@/lib/utils";
import type { Transaction, TxnFilters, TxnType } from "@/lib/types";

type SplitPlan =
  | { kind: "none" }
  | { kind: "personal" }
  | {
      kind: "group";
      visibility: "shared" | "private";
      method: SplitMethod;
      allocations: { userId: string; allocated: string; value: string }[];
    };

async function planVisibility(
  sql: Awaited<ReturnType<typeof ensureUser>>["sql"],
  userId: string,
  data: TxnInput,
  amount: string,
): Promise<SplitPlan> {
  if (data.type !== "expense" || !data.projectId || !data.visibility) return { kind: "none" };
  if (data.visibility === "personal") return { kind: "personal" };
  if (data.visibility !== "shared" && data.visibility !== "private") {
    throw new Error("Choose how to split this expense");
  }
  const group = await readMembers(sql, userId, data.projectId);
  if (group.collaboration !== "collaborative") {
    throw new Error("Invite someone before splitting this project");
  }
  const settled = await sql<{ id: string }>`
    select id from settlements where project_id = ${data.projectId} and status = 'completed' limit 1
  `;
  if (settled[0]) {
    throw new Error("This project already has a settlement. Add a new shared expense instead.");
  }
  const allowed = new Set(group.members.map((member) => member.userId));
  const ids = [...new Set(data.splitUserIds ?? [])].filter((memberId) => allowed.has(memberId));
  if (ids.length < 2) throw new Error("Pick at least two people to split with");
  const method = data.splitMethod ?? "equal";
  if (method !== "equal" && method !== "exact" && method !== "percentage") {
    throw new Error("Choose equal, amount, or percentage");
  }
  const allocations = allocateSplits(
    amount,
    method,
    ids.map((memberId) => ({
      userId: memberId,
      value: method === "equal" ? "1" : (data.splitValues?.[memberId] ?? "").trim() || "0",
    })),
  );
  return {
    kind: "group",
    visibility: data.visibility,
    method,
    allocations: allocations.map((row) => ({
      ...row,
      value: method === "equal" ? "1" : (data.splitValues?.[row.userId] ?? "").trim() || "0",
    })),
  };
}

async function applyVisibility(
  sql: Awaited<ReturnType<typeof ensureUser>>["sql"],
  userId: string,
  id: string,
  plan: SplitPlan,
) {
  if (plan.kind === "none") return;
  if (plan.kind === "personal") {
    await sql`
      update transactions set visibility = 'personal', paid_by_user_id = ${userId}, affects_ledger = true
      where id = ${id} and user_id = ${userId}
    `;
    await sql`delete from expense_splits where transaction_id = ${id}`;
    return;
  }
  await sql`
    update transactions set
      visibility = ${plan.visibility},
      paid_by_user_id = ${userId},
      affects_ledger = true
    where id = ${id} and user_id = ${userId}
  `;
  await sql`delete from expense_splits where transaction_id = ${id}`;
  for (const row of plan.allocations) {
    await sql`
      insert into expense_splits (id, transaction_id, user_id, split_method, share_value, allocated_amount)
      values (${crypto.randomUUID()}, ${id}, ${row.userId}, ${plan.method}, ${row.value}::numeric, ${row.allocated}::numeric)
    `;
  }
}

const SORTS: Record<NonNullable<TxnFilters["sort"]>, string> = {
  newest: "t.transaction_date desc, t.created_at desc",
  oldest: "t.transaction_date asc, t.created_at asc",
  highest: "t.amount desc, t.transaction_date desc",
  lowest: "t.amount asc, t.transaction_date desc",
};

export type TxnInput = {
  id?: string;
  accountId: string;
  categoryId?: string | null;
  projectId?: string | null;
  counterpartyAccountId?: string | null;
  type: TxnType;
  amount: string;
  transactionDate: string;
  transactionTime?: string | null;
  description?: string | null;
  notes?: string | null;
  isPrepaid?: boolean;
  isCommitted?: boolean;
  visibility?: "personal" | "shared" | "private";
  splitMethod?: SplitMethod;
  splitUserIds?: string[];
  splitValues?: Record<string, string>;
  splitEmails?: Record<string, string>;
  splitMode?: "off" | "group" | "open";
  openParts?: OpenPartInput[];
  origin?: string;
  receipt?: { fileName: string; mimeType: string; dataUrl: string } | null;
  removeReceipt?: boolean;
};

async function assertTxnRefs(
  sql: Awaited<ReturnType<typeof ensureUser>>["sql"],
  userId: string,
  data: TxnInput,
) {
  const acc = await ownedAccount(sql, userId, data.accountId);
  if (!acc) throw new Error("Choose a valid account");
  if (data.categoryId) {
    const cat = await ownedCategory(sql, userId, data.categoryId);
    if (!cat) throw new Error("Choose a valid category");
  }
  if (data.projectId) {
    const proj = await ownedProject(sql, userId, data.projectId);
    if (!proj) throw new Error("Choose a valid project");
  }
  if (data.type === "transfer") {
    if (!data.counterpartyAccountId) throw new Error("Choose a destination account");
    if (data.counterpartyAccountId === data.accountId) {
      throw new Error("Transfer needs two different accounts");
    }
    const dest = await ownedAccount(sql, userId, data.counterpartyAccountId);
    if (!dest) throw new Error("Choose a valid destination account");
  }
}

async function fetchTxn(
  sql: Awaited<ReturnType<typeof ensureUser>>["sql"],
  userId: string,
  id: string,
): Promise<Transaction | null> {
  const rows = await sql.query<Record<string, unknown>>(
    `select ${TXN_SELECT} ${TXN_FROM} where t.id = $1 and t.user_id = $2`,
    [id, userId],
  );
  return rows[0] ? mapTxn(rows[0]) : null;
}

export const listTransactions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: TxnFilters) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      const limit = Math.min(Math.max(data.limit ?? 40, 1), 100);
      const offset = Math.max(data.offset ?? 0, 0);
      const sort = SORTS[data.sort ?? "newest"];
      const clauses: string[] = ["t.user_id = $1"];
      const params: unknown[] = [userId];
      const add = (value: unknown, sqlFrag: string) => {
        params.push(value);
        clauses.push(sqlFrag.replace("?", `$${params.length}`));
      };
      if (data.from) add(data.from, "t.transaction_date >= ?::date");
      if (data.to) add(data.to, "t.transaction_date <= ?::date");
      if (data.categoryId) add(data.categoryId, "t.category_id = ?");
      if (data.accountId) add(data.accountId, "t.account_id = ?");
      if (data.projectId) add(data.projectId, "t.project_id = ?");
      if (data.type) add(data.type, "t.type = ?");
      if (data.search?.trim()) {
        const q = `%${data.search.trim()}%`;
        params.push(q, q);
        clauses.push(`(t.description ilike $${params.length - 1} or t.notes ilike $${params.length})`);
      }
      const where = clauses.join(" and ");
      const countRows = await sql.query<{ n: number }>(
        `select count(*)::int as n from transactions t where ${where}`,
        params,
      );
      params.push(limit, offset);
      const rows = await sql.query<Record<string, unknown>>(
        `select ${TXN_SELECT} ${TXN_FROM}
         where ${where}
         order by ${sort}
         limit $${params.length - 1} offset $${params.length}`,
        params,
      );
      return {
        items: rows.map(mapTxn),
        total: countRows[0]?.n ?? 0,
        limit,
        offset,
      };
    } catch (err) {
      publicError(err, "Couldn't load transactions.");
    }
  });

export const getTransaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const txn = await fetchTxn(sql, context.userId, data.id);
      if (!txn) throw new Error("Transaction not found");
      const attachments = await sql<{
        id: string;
        file_name: string;
        mime_type: string;
        data_url: string | null;
      }>`
        select id, file_name, mime_type, data_url
        from attachments
        where transaction_id = ${data.id} and user_id = ${context.userId}
      `;
      return {
        transaction: txn,
        attachments: attachments.map((a) => ({
          id: a.id,
          transactionId: data.id,
          fileName: a.file_name,
          mimeType: a.mime_type,
          dataUrl: a.data_url,
        })),
      };
    } catch (err) {
      publicError(err, "Couldn't load that transaction.");
    }
  });

export const upsertTransaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: TxnInput) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      await assertTxnRefs(sql, userId, data);
      const amount = parseMoney(data.amount);
      if (amount.startsWith("-") || amount === "0.00") throw new Error("Amount must be greater than zero");
      const mode = data.type === "expense" ? data.splitMode : undefined;
      let openParts = null as ReturnType<typeof planOpenParts> | null;
      if (mode === "open") {
        openParts = planOpenParts(amount, data.splitMethod ?? "equal", userId, data.openParts ?? []);
      }
      if (mode === "group") {
        for (const value of Object.values(data.splitEmails ?? {})) {
          const email = value.trim();
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email");
        }
      }
      const splitPlan =
        mode === "group"
          ? await planVisibility(sql, userId, { ...data, visibility: data.visibility ?? "shared" }, amount)
          : mode === "open" || mode === "off"
            ? data.projectId
              ? ({ kind: "personal" } as const)
              : ({ kind: "none" } as const)
            : await planVisibility(sql, userId, data, amount);
      const id = data.id ?? crypto.randomUUID();
      const counterparty = data.type === "transfer" ? data.counterpartyAccountId ?? null : null;

      if (data.id) {
        const existing = await sql<{ id: string }>`
          select id from transactions where id = ${data.id} and user_id = ${userId}
        `;
        if (!existing[0]) throw new Error("Transaction not found");
        await assertNoSettledEdit(sql, data.id);
        await sql`
          update transactions set
            account_id = ${data.accountId},
            category_id = ${data.categoryId ?? null},
            project_id = ${data.projectId ?? null},
            counterparty_account_id = ${counterparty},
            type = ${data.type},
            amount = ${amount}::numeric,
            transaction_date = ${data.transactionDate}::date,
            transaction_time = ${data.transactionTime ?? null},
            description = ${data.description ?? null},
            notes = ${data.notes ?? null},
            is_prepaid = ${data.isPrepaid ?? false},
            is_committed = ${data.isCommitted ?? true},
            updated_at = now()
          where id = ${id} and user_id = ${userId}
        `;
      } else {
        await sql`
          insert into transactions (
            id, user_id, account_id, category_id, project_id, counterparty_account_id,
            type, amount, transaction_date, transaction_time, description, notes,
            is_prepaid, is_committed
          ) values (
            ${id}, ${userId}, ${data.accountId}, ${data.categoryId ?? null},
            ${data.projectId ?? null}, ${counterparty}, ${data.type},
            ${amount}::numeric, ${data.transactionDate}::date, ${data.transactionTime ?? null},
            ${data.description ?? null}, ${data.notes ?? null},
            ${data.isPrepaid ?? false}, ${data.isCommitted ?? true}
          )
        `;
      }

      if (data.removeReceipt) {
        await sql`delete from attachments where transaction_id = ${id} and user_id = ${userId}`;
      }
      if (data.receipt?.dataUrl) {
        if (data.receipt.dataUrl.length > 900_000) {
          throw new Error("Receipt is too large. Use a smaller image.");
        }
        await sql`delete from attachments where transaction_id = ${id} and user_id = ${userId}`;
        await sql`
          insert into attachments (id, user_id, transaction_id, storage_path, file_name, mime_type, data_url)
          values (
            ${crypto.randomUUID()}, ${userId}, ${id}, ${`receipts/${userId}/${id}`},
            ${data.receipt.fileName}, ${data.receipt.mimeType}, ${data.receipt.dataUrl}
          )
        `;
      }

      const txn = await fetchTxn(sql, userId, id);
      if (!txn) throw new Error("Could not save transaction");
      await applyVisibility(sql, userId, id, splitPlan);

      let shareLinks: ShareLink[] = [];
      if (data.type !== "expense") {
        await clearSplitLinks(sql, id, userId);
      } else if (mode === "off") {
        await clearSplitLinks(sql, id, userId);
      } else if (mode === "open" && openParts) {
        await sql`
          update transactions set visibility = 'personal', paid_by_user_id = ${userId}, affects_ledger = true
          where id = ${id} and user_id = ${userId}
        `;
        shareLinks = await saveSplitLinks(
          sql,
          userId,
          id,
          data.splitMethod ?? "equal",
          openParts,
          data.origin,
          data.description ?? null,
        );
      } else if (mode === "group" && splitPlan.kind === "group") {
        const names = new Map<string, string>();
        if (data.projectId) {
          const group = await readMembers(sql, userId, data.projectId);
          for (const member of group.members) names.set(member.userId, member.name);
        }
        shareLinks = await saveSplitLinks(
          sql,
          userId,
          id,
          splitPlan.method,
          splitPlan.allocations.map((row) => ({
            userId: row.userId,
            name: row.userId === userId ? "You" : names.get(row.userId) || "Member",
            email: data.splitEmails?.[row.userId]?.trim() || null,
            value: row.value,
            allocated: row.allocated,
            status: "accepted" as const,
          })),
          data.origin,
          data.description ?? null,
        );
      }

      if (!data.id && data.projectId && (data.isCommitted ?? true) && (data.type === "expense" || data.type === "income")) {
        await notifyProjectActivity(sql, {
          projectId: data.projectId,
          actorId: userId,
          kind: data.type === "income" ? "income" : "expense",
          amount,
          description: data.description,
        });
      }

      const saved = await fetchTxn(sql, userId, id);
      return { ...(saved ?? txn), shareLinks };
    } catch (err) {
      publicError(err, "Couldn't save that transaction.");
    }
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await assertNoSettledEdit(sql, data.id);
      const rows = await sql<{ id: string }>`
        delete from transactions
        where id = ${data.id} and user_id = ${context.userId}
        returning id
      `;
      if (!rows[0]) throw new Error("Transaction not found");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't delete that transaction.");
    }
  });

export const getReceipt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { transactionId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ data_url: string; file_name: string; mime_type: string }>`
        select data_url, file_name, mime_type
        from attachments
        where transaction_id = ${data.transactionId} and user_id = ${context.userId}
        limit 1
      `;
      const row = rows[0];
      if (!row?.data_url) return null;
      return { dataUrl: row.data_url, fileName: row.file_name, mimeType: row.mime_type };
    } catch (err) {
      publicError(err, "Couldn't load the receipt.");
    }
  });
