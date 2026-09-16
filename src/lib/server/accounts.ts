import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser } from "@/lib/server/ensure";
import { mapAccount, mapTxn, TXN_FROM, TXN_SELECT } from "@/lib/server/map";
import { parseMoney } from "@/lib/money";
import { publicError } from "@/lib/utils";
import type { Account, AccountType } from "@/lib/types";

const TYPES = new Set(["bank", "cash", "upi", "credit_card", "wallet", "other"]);

export const listAccounts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Account[]> => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<Record<string, unknown>>`
        select id, name, type, opening_balance::text as opening_balance,
               account_balance(id)::text as current_balance,
               currency, is_active, is_demo
        from accounts
        where user_id = ${context.userId}
        order by is_active desc, created_at asc
      `;
      return rows.map(mapAccount);
    } catch (err) {
      publicError(err, "Couldn't load accounts.");
    }
  });

export const upsertAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      id?: string;
      name: string;
      type: AccountType;
      openingBalance: string;
      currency?: string;
    }) => data,
  )
  .handler(async ({ context, data }): Promise<Account> => {
    try {
      const { sql, profile } = await ensureUser(context.userId);
      const name = data.name.trim();
      if (!name) throw new Error("Give the account a name");
      if (!TYPES.has(data.type)) throw new Error("Choose a valid account type");
      const opening = parseMoney(data.openingBalance || "0");
      const currency = data.currency || profile.currency;
      const id = data.id ?? crypto.randomUUID();

      if (data.id) {
        const existing = await sql<{ id: string }>`
          select id from accounts where id = ${id} and user_id = ${context.userId}
        `;
        if (!existing[0]) throw new Error("Account not found");
        await sql`
          update accounts set
            name = ${name},
            type = ${data.type},
            opening_balance = ${opening}::numeric,
            currency = ${currency},
            updated_at = now()
          where id = ${id} and user_id = ${context.userId}
        `;
      } else {
        await sql`
          insert into accounts (id, user_id, name, type, opening_balance, currency)
          values (${id}, ${context.userId}, ${name}, ${data.type}, ${opening}::numeric, ${currency})
        `;
      }

      const rows = await sql<Record<string, unknown>>`
        select id, name, type, opening_balance::text as opening_balance,
               account_balance(id)::text as current_balance,
               currency, is_active, is_demo
        from accounts where id = ${id} and user_id = ${context.userId}
      `;
      if (!rows[0]) throw new Error("Could not save account");
      return mapAccount(rows[0]);
    } catch (err) {
      publicError(err, "Couldn't save that account.");
    }
  });

export const archiveAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; isActive: boolean }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ id: string }>`
        update accounts set is_active = ${data.isActive}, updated_at = now()
        where id = ${data.id} and user_id = ${context.userId}
        returning id
      `;
      if (!rows[0]) throw new Error("Account not found");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't update that account.");
    }
  });

export const deleteAccountRecord = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const used = await sql<{ n: number }>`
        select count(*)::int as n from transactions
        where user_id = ${context.userId}
          and (account_id = ${data.id} or counterparty_account_id = ${data.id})
      `;
      if ((used[0]?.n ?? 0) > 0) {
        throw new Error("This account has transactions. Archive it instead of deleting.");
      }
      const rows = await sql<{ id: string }>`
        delete from accounts where id = ${data.id} and user_id = ${context.userId} returning id
      `;
      if (!rows[0]) throw new Error("Account not found");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't delete that account.");
    }
  });

export const getAccountDetail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<Record<string, unknown>>`
        select id, name, type, opening_balance::text as opening_balance,
               account_balance(id)::text as current_balance,
               currency, is_active, is_demo
        from accounts where id = ${data.id} and user_id = ${context.userId}
      `;
      if (!rows[0]) throw new Error("Account not found");
      const account = mapAccount(rows[0]);
      const stats = await sql<{ income: string; expense: string }>`
        select
          coalesce(sum(case when type in ('income', 'refund') then amount else 0 end), 0)::text as income,
          coalesce(sum(case when type = 'expense' then amount else 0 end), 0)::text as expense
        from transactions
        where user_id = ${context.userId} and account_id = ${data.id} and is_committed = true
      `;
      const txns = await sql.query<Record<string, unknown>>(
        `select ${TXN_SELECT} ${TXN_FROM}
         where t.user_id = $1 and (t.account_id = $2 or t.counterparty_account_id = $2)
         order by t.transaction_date desc, t.created_at desc
         limit 30`,
        [context.userId, data.id],
      );
      return {
        account,
        income: stats[0]?.income ?? "0.00",
        expense: stats[0]?.expense ?? "0.00",
        recent: txns.map(mapTxn),
      };
    } catch (err) {
      publicError(err, "Couldn't load that account.");
    }
  });
