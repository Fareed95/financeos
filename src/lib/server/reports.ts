import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser } from "@/lib/server/ensure";
import { publicError } from "@/lib/utils";
import { subMoney } from "@/lib/money";

export const getReports = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { from: string; to: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      const { from, to } = data;

      const [totals, byCategory, byProject, byAccount, daily, top] = await Promise.all([
        sql<{ income: string; expense: string }>`
          select
            coalesce(sum(case when type = 'income' then amount else 0 end), 0)::text as income,
            coalesce(sum(case when type = 'expense' then amount when type = 'refund' then -amount else 0 end), 0)::text as expense
          from transactions
          where user_id = ${userId} and is_committed = true
            and transaction_date >= ${from} and transaction_date <= ${to}
        `,
        sql<{ id: string | null; name: string; icon: string; amount: string }>`
          select t.category_id as id, coalesce(c.name, 'Uncategorized') as name,
                 coalesce(c.icon, 'circle') as icon,
                 coalesce(sum(t.amount), 0)::text as amount
          from transactions t
          left join categories c on c.id = t.category_id
          where t.user_id = ${userId} and t.type = 'expense' and t.is_committed = true
            and t.transaction_date >= ${from} and t.transaction_date <= ${to}
          group by t.category_id, c.name, c.icon
          order by sum(t.amount) desc
        `,
        sql<{ id: string | null; name: string; amount: string }>`
          select t.project_id as id, coalesce(p.name, 'No project') as name,
                 coalesce(sum(t.amount), 0)::text as amount
          from transactions t
          left join projects p on p.id = t.project_id
          where t.user_id = ${userId} and t.type = 'expense' and t.is_committed = true
            and t.transaction_date >= ${from} and t.transaction_date <= ${to}
          group by t.project_id, p.name
          order by sum(t.amount) desc
        `,
        sql<{ id: string; name: string; amount: string }>`
          select t.account_id as id, a.name,
                 coalesce(sum(t.amount), 0)::text as amount
          from transactions t
          join accounts a on a.id = t.account_id
          where t.user_id = ${userId} and t.type = 'expense' and t.is_committed = true
            and t.transaction_date >= ${from} and t.transaction_date <= ${to}
          group by t.account_id, a.name
          order by sum(t.amount) desc
        `,
        sql<{ date: string; expense: string; income: string }>`
          select transaction_date::text as date,
                 coalesce(sum(case when type = 'expense' then amount when type = 'refund' then -amount else 0 end), 0)::text as expense,
                 coalesce(sum(case when type = 'income' then amount else 0 end), 0)::text as income
          from transactions
          where user_id = ${userId} and is_committed = true
            and transaction_date >= ${from} and transaction_date <= ${to}
          group by transaction_date
          order by transaction_date asc
        `,
        sql<{ name: string; icon: string; amount: string }>`
          select coalesce(c.name, 'Uncategorized') as name, coalesce(c.icon, 'circle') as icon,
                 coalesce(sum(t.amount), 0)::text as amount
          from transactions t
          left join categories c on c.id = t.category_id
          where t.user_id = ${userId} and t.type = 'expense' and t.is_committed = true
            and t.transaction_date >= ${from} and t.transaction_date <= ${to}
          group by c.name, c.icon
          order by sum(t.amount) desc
          limit 6
        `,
      ]);

      const income = totals[0]?.income ?? "0.00";
      const expense = totals[0]?.expense ?? "0.00";

      return {
        from,
        to,
        income,
        expense,
        savings: subMoney(income, expense),
        byCategory: byCategory.map((r) => ({
          id: r.id,
          name: r.name,
          icon: r.icon,
          amount: r.amount,
        })),
        byProject: byProject.map((r) => ({ id: r.id, name: r.name, amount: r.amount })),
        byAccount: byAccount.map((r) => ({ id: r.id, name: r.name, amount: r.amount })),
        daily: daily.map((r) => ({
          date: String(r.date).slice(0, 10),
          expense: r.expense,
          income: r.income,
        })),
        top: top.map((r) => ({ name: r.name, icon: r.icon, amount: r.amount })),
      };
    } catch (err) {
      publicError(err, "Couldn't load reports.");
    }
  });
