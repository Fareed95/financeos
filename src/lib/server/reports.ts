import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser } from "@/lib/server/ensure";
import { publicError } from "@/lib/utils";
import { subMoney } from "@/lib/money";

function assertDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Pick a valid ${label} date`);
  return value;
}

export const getReports = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { from: string; to: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      const from = assertDate(data.from, "from");
      const to = assertDate(data.to, "to");

      const [totals, byCategory, byProject, byAccount, daily, bounds, accounts, projects] = await Promise.all([
        sql<{ income: string; expense: string }>`
          select
            coalesce(sum(case when type = 'income' then amount else 0 end), 0)::text as income,
            coalesce(sum(case when type = 'expense' then amount when type = 'refund' then -amount else 0 end), 0)::text as expense
          from transactions
          where user_id = ${userId} and is_committed = true and affects_ledger = true
            and transaction_date >= ${from}::date and transaction_date <= ${to}::date
        `,
        sql<{ id: string | null; name: string; icon: string; amount: string }>`
          select t.category_id as id, coalesce(c.name, 'Uncategorized') as name,
                 coalesce(c.icon, 'circle') as icon,
                 coalesce(sum(t.amount), 0)::text as amount
          from transactions t
          left join categories c on c.id = t.category_id
          where t.user_id = ${userId} and t.type = 'expense' and t.is_committed = true and t.affects_ledger = true
            and t.transaction_date >= ${from}::date and t.transaction_date <= ${to}::date
          group by t.category_id, c.name, c.icon
          order by sum(t.amount) desc
        `,
        sql<{ id: string | null; name: string; amount: string }>`
          select t.project_id as id, coalesce(p.name, 'No project') as name,
                 coalesce(sum(t.amount), 0)::text as amount
          from transactions t
          left join projects p on p.id = t.project_id
          where t.user_id = ${userId} and t.type = 'expense' and t.is_committed = true and t.affects_ledger = true
            and t.transaction_date >= ${from}::date and t.transaction_date <= ${to}::date
          group by t.project_id, p.name
          order by sum(t.amount) desc
        `,
        sql<{ id: string; name: string; amount: string }>`
          select t.account_id as id, a.name,
                 coalesce(sum(t.amount), 0)::text as amount
          from transactions t
          join accounts a on a.id = t.account_id
          where t.user_id = ${userId} and t.type = 'expense' and t.is_committed = true and t.affects_ledger = true
            and t.transaction_date >= ${from}::date and t.transaction_date <= ${to}::date
          group by t.account_id, a.name
          order by sum(t.amount) desc
        `,
        sql<{ date: string; expense: string; income: string }>`
          select transaction_date::text as date,
                 coalesce(sum(case when type = 'expense' then amount when type = 'refund' then -amount else 0 end), 0)::text as expense,
                 coalesce(sum(case when type = 'income' then amount else 0 end), 0)::text as income
          from transactions
          where user_id = ${userId} and is_committed = true and affects_ledger = true
            and transaction_date >= ${from}::date and transaction_date <= ${to}::date
          group by transaction_date
          order by transaction_date asc
        `,
        sql<{ from: string | null; to: string | null; count: number }>`
          select min(transaction_date)::text as "from",
                 max(transaction_date)::text as "to",
                 count(*)::int as count
          from transactions
          where user_id = ${userId} and is_committed = true and affects_ledger = true
        `,
        sql<{ id: string; name: string; balance: string }>`
          select id, name, account_balance(id)::text as balance
          from accounts
          where user_id = ${userId} and is_active = true
          order by created_at asc
        `,
        sql<{ id: string; name: string; budget: string; spent: string }>`
          select p.id, p.name, p.budget::text as budget,
            coalesce((
              select sum(case when t.type = 'expense' then t.amount when t.type = 'refund' then -t.amount else 0 end)
              from transactions t
              where t.project_id = p.id and t.is_committed = true
                and (
                  (p.collaboration = 'personal' and t.user_id = p.user_id and t.visibility = 'personal')
                  or (p.collaboration = 'collaborative' and t.visibility = 'shared')
                )
            ), 0)::text as spent
          from projects p
          where p.status in ('planned', 'active', 'completed')
            and (
              p.user_id = ${userId}
              or exists (
                select 1 from project_members m
                where m.project_id = p.id and m.user_id = ${userId} and m.status = 'active'
              )
            )
          order by p.created_at desc
        `,
      ]);

      const income = totals[0]?.income ?? "0.00";
      const expense = totals[0]?.expense ?? "0.00";
      const span = bounds[0];

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
        bounds: {
          from: span?.from ? String(span.from).slice(0, 10) : null,
          to: span?.to ? String(span.to).slice(0, 10) : null,
          count: Number(span?.count ?? 0),
        },
        accounts: accounts.map((row) => ({ id: row.id, name: row.name, balance: row.balance })),
        projects: projects.map((row) => ({ id: row.id, name: row.name, budget: row.budget, spent: row.spent })),
      };
    } catch (err) {
      publicError(err, "Couldn't load reports.");
    }
  });
