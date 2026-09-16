import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser } from "@/lib/server/ensure";
import { mapAccount, mapBudget, mapCategory, mapProject, mapTxn, PROJECT_FROM, PROJECT_SELECT, TXN_FROM, TXN_SELECT } from "@/lib/server/map";
import { addMoney, subMoney } from "@/lib/money";
import { publicError } from "@/lib/utils";
import type { Account, Bootstrap, Budget, Category, MonthStats, Profile, Project, Transaction } from "@/lib/types";

export const getBootstrap = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { from: string; to: string; displayName?: string | null }) => data)
  .handler(async ({ context, data }): Promise<Bootstrap> => {
    try {
      const { sql, profile } = await ensureUser(context.userId, data.displayName);
      const userId = context.userId;
      const { from, to } = data;

      const [accountRows, categoryRows, projectRows, budgetRows, recentRows, statRows, netRows] =
        await Promise.all([
          sql<Record<string, unknown>>`
            select id, name, type, opening_balance::text as opening_balance,
                   account_balance(id)::text as current_balance,
                   currency, is_active, is_demo
            from accounts
            where user_id = ${userId}
            order by is_active desc, created_at asc
          `,
          sql<Record<string, unknown>>`
            select id, name, icon, type, is_active, is_default
            from categories
            where user_id = ${userId}
            order by type asc, name asc
          `,
          sql.query<Record<string, unknown>>(
            `select ${PROJECT_SELECT} ${PROJECT_FROM}
             where p.user_id = $1
             order by case p.status when 'active' then 0 when 'planned' then 1 when 'completed' then 2 else 3 end, p.created_at desc`,
            [userId],
          ),
          sql<Record<string, unknown>>`
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
            where user_id = ${userId}
              and is_committed = true
              and transaction_date >= ${from}
              and transaction_date <= ${to}
          `,
          sql<{ net: string }>`
            select coalesce(sum(account_balance(id)), 0)::text as net
            from accounts
            where user_id = ${userId} and is_active = true
          `,
        ]);

      const income = statRows[0]?.income ?? "0.00";
      const expense = statRows[0]?.expense ?? "0.00";
      const stats: MonthStats = {
        from,
        to,
        income,
        expense,
        savings: subMoney(income, expense),
        netWorth: netRows[0]?.net ?? "0.00",
      };

      return {
        profile,
        accounts: accountRows.map(mapAccount),
        categories: categoryRows.map(mapCategory),
        projects: projectRows.map(mapProject),
        budgets: budgetRows.map(mapBudget),
        stats,
        recent: recentRows.map(mapTxn),
      };
    } catch (err) {
      publicError(err, "Couldn't load your finances. Try again.");
    }
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      fullName?: string;
      currency?: string;
      theme?: string;
      onboardingCompleted?: boolean;
      avatarUrl?: string | null;
    }) => data,
  )
  .handler(async ({ context, data }): Promise<Profile> => {
    try {
      const { sql } = await ensureUser(context.userId, data.fullName);
      const rows = await sql<Record<string, unknown>>`
        update profiles set
          full_name = coalesce(${data.fullName ?? null}, full_name),
          currency = coalesce(${data.currency ?? null}, currency),
          theme = coalesce(${data.theme ?? null}, theme),
          onboarding_completed = coalesce(${data.onboardingCompleted ?? null}, onboarding_completed),
          avatar_url = coalesce(${data.avatarUrl ?? null}, avatar_url),
          updated_at = now()
        where id = ${context.userId}
        returning id, full_name, avatar_url, currency, theme, onboarding_completed
      `;
      if (!rows[0]) throw new Error("Profile not found");
      const { mapProfile } = await import("@/lib/server/map");
      return mapProfile(rows[0]);
    } catch (err) {
      publicError(err, "Couldn't update your profile.");
    }
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const id = context.userId;
      await sql`delete from attachments where user_id = ${id}`;
      await sql`delete from transactions where user_id = ${id}`;
      await sql`delete from project_budgets where user_id = ${id}`;
      await sql`delete from budgets where user_id = ${id}`;
      await sql`delete from projects where user_id = ${id}`;
      await sql`delete from accounts where user_id = ${id}`;
      await sql`delete from categories where user_id = ${id}`;
      await sql`delete from profiles where id = ${id}`;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't delete your data.");
    }
  });

export type { Account, Bootstrap, Budget, Category, Project, Transaction };
