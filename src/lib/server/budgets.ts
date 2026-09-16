import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser, ownedCategory } from "@/lib/server/ensure";
import { mapBudget } from "@/lib/server/map";
import { parseMoney } from "@/lib/money";
import { publicError } from "@/lib/utils";
import type { Budget, BudgetPeriod } from "@/lib/types";

const PERIODS = new Set(["weekly", "monthly", "yearly", "custom"]);

export const listBudgets = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Budget[]> => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<Record<string, unknown>>`
        select b.id, b.name, b.amount::text as amount, b.period,
               b.start_date::text as start_date, b.end_date::text as end_date,
               b.category_id, c.name as category_name,
               coalesce((
                 select sum(t.amount)
                 from transactions t
                 where t.user_id = b.user_id
                   and t.type = 'expense'
                   and t.is_committed = true
                   and t.transaction_date >= b.start_date
                   and t.transaction_date <= b.end_date
                   and (b.category_id is null or t.category_id = b.category_id)
               ), 0)::text as spent
        from budgets b
        left join categories c on c.id = b.category_id
        where b.user_id = ${context.userId}
        order by b.start_date desc, b.created_at desc
      `;
      return rows.map(mapBudget);
    } catch (err) {
      publicError(err, "Couldn't load budgets.");
    }
  });

export const upsertBudget = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      id?: string;
      name: string;
      amount: string;
      period: BudgetPeriod;
      startDate: string;
      endDate: string;
      categoryId?: string | null;
    }) => data,
  )
  .handler(async ({ context, data }): Promise<Budget> => {
    try {
      const { sql } = await ensureUser(context.userId);
      const name = data.name.trim();
      if (!name) throw new Error("Give the budget a name");
      if (!PERIODS.has(data.period)) throw new Error("Choose a valid period");
      const amount = parseMoney(data.amount);
      if (data.categoryId) {
        const cat = await ownedCategory(sql, context.userId, data.categoryId);
        if (!cat) throw new Error("Category not found");
      }
      const id = data.id ?? crypto.randomUUID();
      if (data.id) {
        const existing = await sql<{ id: string }>`
          select id from budgets where id = ${id} and user_id = ${context.userId}
        `;
        if (!existing[0]) throw new Error("Budget not found");
        await sql`
          update budgets set
            name = ${name},
            amount = ${amount}::numeric,
            period = ${data.period},
            start_date = ${data.startDate}::date,
            end_date = ${data.endDate}::date,
            category_id = ${data.categoryId ?? null}
          where id = ${id} and user_id = ${context.userId}
        `;
      } else {
        await sql`
          insert into budgets (id, user_id, name, amount, period, start_date, end_date, category_id)
          values (${id}, ${context.userId}, ${name}, ${amount}::numeric, ${data.period},
                  ${data.startDate}::date, ${data.endDate}::date, ${data.categoryId ?? null})
        `;
      }
      const rows = await sql<Record<string, unknown>>`
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
        where b.id = ${id} and b.user_id = ${context.userId}
      `;
      if (!rows[0]) throw new Error("Could not save budget");
      return mapBudget(rows[0]);
    } catch (err) {
      publicError(err, "Couldn't save that budget.");
    }
  });

export const deleteBudget = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ id: string }>`
        delete from budgets where id = ${data.id} and user_id = ${context.userId} returning id
      `;
      if (!rows[0]) throw new Error("Budget not found");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't delete that budget.");
    }
  });
