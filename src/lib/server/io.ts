import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser } from "@/lib/server/ensure";
import { parseMoney } from "@/lib/money";
import { publicError } from "@/lib/utils";
import type { TxnType } from "@/lib/types";

export const exportData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { format: "csv" | "json" }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, profile } = await ensureUser(context.userId);
      const userId = context.userId;
      const txns = await sql<Record<string, unknown>>`
        select t.transaction_date::text as date, t.transaction_time as time, t.type,
               t.amount::text as amount, t.description, t.notes,
               a.name as account, c.name as category, p.name as project,
               t.is_prepaid, t.is_committed
        from transactions t
        join accounts a on a.id = t.account_id
        left join categories c on c.id = t.category_id
        left join projects p on p.id = t.project_id
        where t.user_id = ${userId}
        order by t.transaction_date desc, t.created_at desc
      `;

      if (data.format === "csv") {
        const header = "Date,Time,Type,Amount,Account,Category,Project,Description,Notes,Prepaid,Committed";
        const escape = (v: unknown) => {
          const s = v == null ? "" : String(v);
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const lines = txns.map((t) =>
          [
            String(t.date).slice(0, 10),
            t.time ?? "",
            t.type,
            t.amount,
            t.account,
            t.category ?? "",
            t.project ?? "",
            t.description ?? "",
            t.notes ?? "",
            t.is_prepaid ? "yes" : "no",
            t.is_committed ? "yes" : "no",
          ]
            .map(escape)
            .join(","),
        );
        return { filename: "financeos-transactions.csv", mime: "text/csv", content: [header, ...lines].join("\n") };
      }

      const [accounts, categories, projects, budgets] = await Promise.all([
        sql`select name, type, opening_balance::text as opening_balance, currency, is_active from accounts where user_id = ${userId}`,
        sql`select name, icon, type, is_active from categories where user_id = ${userId}`,
        sql`select name, description, project_type, start_date::text, end_date::text, budget::text, status from projects where user_id = ${userId}`,
        sql`select name, amount::text, period, start_date::text, end_date::text from budgets where user_id = ${userId}`,
      ]);

      const payload = {
        exportedAt: new Date().toISOString(),
        profile: { fullName: profile.fullName, currency: profile.currency },
        accounts,
        categories,
        projects,
        budgets,
        transactions: txns,
      };
      return {
        filename: "financeos-backup.json",
        mime: "application/json",
        content: JSON.stringify(payload, null, 2),
      };
    } catch (err) {
      publicError(err, "Couldn't export your data.");
    }
  });

export type ImportRow = {
  date: string;
  amount: string;
  type?: TxnType;
  description?: string;
  accountName?: string;
  categoryName?: string;
  projectName?: string;
};

export const importTransactions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { rows: ImportRow[] }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      if (!data.rows.length) throw new Error("No rows to import");
      if (data.rows.length > 2000) throw new Error("Import is limited to 2,000 rows");

      const accounts = await sql<{ id: string; name: string }>`
        select id, name from accounts where user_id = ${userId}
      `;
      const categories = await sql<{ id: string; name: string }>`
        select id, name from categories where user_id = ${userId}
      `;
      const projects = await sql<{ id: string; name: string }>`
        select id, name from projects where user_id = ${userId}
      `;

      const find = (list: { id: string; name: string }[], name?: string) => {
        if (!name?.trim()) return null;
        const n = name.trim().toLowerCase();
        return list.find((x) => x.name.toLowerCase() === n)?.id ?? null;
      };

      let inserted = 0;
      const errors: string[] = [];

      for (let i = 0; i < data.rows.length; i += 1) {
        const row = data.rows[i]!;
        try {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
            throw new Error("invalid date");
          }
          const amount = parseMoney(row.amount);
          if (amount === "0.00" || amount.startsWith("-")) throw new Error("invalid amount");
          const type: TxnType = row.type && ["expense", "income", "transfer", "refund"].includes(row.type)
            ? row.type
            : "expense";
          const accountId = find(accounts, row.accountName) ?? accounts[0]?.id;
          if (!accountId) throw new Error("no account");
          await sql`
            insert into transactions (
              id, user_id, account_id, category_id, project_id, type, amount,
              transaction_date, description, is_committed
            ) values (
              ${crypto.randomUUID()}, ${userId}, ${accountId},
              ${find(categories, row.categoryName)}, ${find(projects, row.projectName)},
              ${type}, ${amount}::numeric, ${row.date}::date, ${row.description ?? null}, true
            )
          `;
          inserted += 1;
        } catch (err) {
          errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : "invalid"}`);
          if (errors.length > 25) break;
        }
      }

      return { inserted, skipped: data.rows.length - inserted, errors };
    } catch (err) {
      publicError(err, "Couldn't import those transactions.");
    }
  });
