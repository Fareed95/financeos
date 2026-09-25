import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser, ownedAccount, ownedCategory, ownedProject } from "@/lib/server/ensure";
import { mapTxn, TXN_FROM, TXN_SELECT } from "@/lib/server/map";
import { assertNoSettledEdit } from "@/lib/server/collab";
import { parseMoney } from "@/lib/money";
import { publicError } from "@/lib/utils";
import type { Transaction, TxnFilters, TxnType } from "@/lib/types";

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
      const clauses: string[] = ["t.user_id = $1", "t.affects_ledger = true"];
      const params: unknown[] = [userId];
      const add = (value: unknown, sqlFrag: string) => {
        params.push(value);
        clauses.push(sqlFrag.replace("?", `$${params.length}`));
      };
      if (data.from) add(data.from, "t.transaction_date >= ?");
      if (data.to) add(data.to, "t.transaction_date <= ?");
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
      return txn;
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
