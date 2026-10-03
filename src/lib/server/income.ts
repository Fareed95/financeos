import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser, ownedAccount } from "@/lib/server/ensure";
import { loadCommitments, type AssetView, type BillRow } from "@/lib/server/commitments";
import { parseMoney } from "@/lib/money";
import {
  buildMonthPlan,
  INCOME_KINDS,
  shouldAskDue,
  shouldAskPayday,
  type Advice,
  type IncomeKind,
  type PlanSource,
} from "@/lib/month-plan";
import { addDaysISO, publicError } from "@/lib/utils";

export type IncomeSourceRow = PlanSource & {
  accountId: string;
  accountName: string;
};

export type PaydayPrompt = {
  sourceId: string;
  name: string;
  kind: IncomeKind;
  amount: string;
  dayOfMonth: number;
  accountName: string;
};

export type IncomePlan = {
  sources: IncomeSourceRow[];
  prompts: PaydayPrompt[];
  todaySpent: string;
  expected: string;
  received: string;
  spent: string;
  left: string;
  reserved: string;
  over: boolean;
  daily: string;
  daysLeft: number;
  advice: Advice[];
  bills: BillRow[];
  billPrompts: Array<{
    billId: string;
    name: string;
    kind: BillRow["kind"];
    amount: string;
    dayOfMonth: number;
    accountName: string;
  }>;
  assets: AssetView[];
  bookValue: string;
  paperDrop: string;
};

function assertToday(today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("Pick a valid date");
  return today;
}

function periodOf(today: string) {
  return today.slice(0, 7);
}

export const getIncomePlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { today: string }) => data)
  .handler(async ({ context, data }): Promise<IncomePlan> => {
    try {
      const today = assertToday(data.today);
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      const period = periodOf(today);
      const from = `${period}-01`;

      const [sourceRows, spendRows, todayRows, categoryRows, commitments] = await Promise.all([
        sql<{
          id: string;
          name: string;
          kind: IncomeKind;
          amount: string;
          day_of_month: number;
          account_id: string;
          account_name: string;
          is_active: boolean;
          status: PlanSource["checkin"];
          snooze_until: string | null;
        }>`
          select s.id, s.name, s.kind, s.amount::text as amount, s.day_of_month,
                 s.account_id, a.name as account_name, s.is_active,
                 c.status, c.snooze_until::text as snooze_until
          from income_sources s
          join accounts a on a.id = s.account_id
          left join income_checkins c on c.source_id = s.id and c.period = ${period}
          where s.user_id = ${userId}
          order by s.is_active desc, s.day_of_month asc, s.created_at asc
        `,
        sql<{ income: string; expense: string }>`
          select
            coalesce(sum(case when type = 'income' then amount else 0 end), 0)::text as income,
            coalesce(sum(case when type = 'expense' then amount when type = 'refund' then -amount else 0 end), 0)::text as expense
          from transactions
          where user_id = ${userId}
            and is_committed = true
            and affects_ledger = true
            and transaction_date >= ${from}::date
            and transaction_date <= ${today}::date
        `,
        sql<{ spent: string }>`
          select coalesce(sum(case when type = 'expense' then amount when type = 'refund' then -amount else 0 end), 0)::text as spent
          from transactions
          where user_id = ${userId}
            and is_committed = true
            and affects_ledger = true
            and transaction_date = ${today}::date
        `,
        sql<{ name: string; amount: string }>`
          select coalesce(c.name, 'Uncategorized') as name,
                 coalesce(sum(t.amount), 0)::text as amount
          from transactions t
          left join categories c on c.id = t.category_id
          where t.user_id = ${userId}
            and t.type = 'expense'
            and t.is_committed = true
            and t.affects_ledger = true
            and t.transaction_date >= ${from}::date
            and t.transaction_date <= ${today}::date
          group by c.name
        `,
        loadCommitments(sql, userId, today, period),
      ]);

      const sources: IncomeSourceRow[] = sourceRows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        amount: row.amount,
        dayOfMonth: Number(row.day_of_month),
        isActive: row.is_active,
        checkin: row.status,
        snoozeUntil: row.snooze_until,
        accountId: row.account_id,
        accountName: row.account_name,
      }));
      const plan = buildMonthPlan({
        today,
        sources,
        bills: commitments.bills,
        categories: categoryRows,
        spent: spendRows[0]?.expense ?? "0.00",
        received: spendRows[0]?.income ?? "0.00",
      });
      const prompts: PaydayPrompt[] = sources.filter((s) => shouldAskPayday(today, s)).map((s) => ({
        sourceId: s.id,
        name: s.name,
        kind: s.kind,
        amount: s.amount,
        dayOfMonth: s.dayOfMonth,
        accountName: s.accountName,
      }));
      const billPrompts = commitments.bills.filter((bill) => shouldAskDue(today, bill)).map((bill) => ({
        billId: bill.id,
        name: bill.name,
        kind: bill.kind,
        amount: bill.amount,
        dayOfMonth: bill.dayOfMonth,
        accountName: bill.accountName,
      }));

      return {
        sources,
        prompts,
        bills: commitments.bills,
        billPrompts,
        assets: commitments.assets,
        bookValue: commitments.bookValue,
        paperDrop: commitments.paperDrop,
        todaySpent: todayRows[0]?.spent ?? "0.00",
        ...plan,
      };
    } catch (err) {
      publicError(err, "Couldn't load your monthly plan.");
    }
  });

export const saveIncomeSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      id?: string;
      name: string;
      kind: IncomeKind;
      amount: string;
      dayOfMonth: number;
      accountId: string;
    }) => data,
  )
  .handler(async ({ context, data }) => {
    try {
      const name = data.name.trim();
      if (!name || name.length > 40) throw new Error("Name should be 1–40 characters");
      if (!INCOME_KINDS.includes(data.kind)) throw new Error("Choose salary, an asset, or other");
      const day = Math.floor(Number(data.dayOfMonth));
      if (day < 1 || day > 31) throw new Error("Day of month should be between 1 and 31");
      const amount = parseMoney(data.amount);
      if (amount.startsWith("-") || amount === "0.00") throw new Error("Amount must be greater than zero");
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      const account = await ownedAccount(sql, userId, data.accountId);
      if (!account) throw new Error("Choose an account this lands in");

      if (data.id) {
        const rows = await sql<{ id: string }>`
          update income_sources set
            name = ${name},
            kind = ${data.kind},
            amount = ${amount}::numeric,
            day_of_month = ${day},
            account_id = ${data.accountId},
            updated_at = now()
          where id = ${data.id} and user_id = ${userId}
          returning id
        `;
        if (!rows[0]) throw new Error("That income isn't on your account");
        return { id: rows[0].id };
      }

      const id = crypto.randomUUID();
      await sql`
        insert into income_sources (id, user_id, name, kind, amount, day_of_month, account_id)
        values (${id}, ${userId}, ${name}, ${data.kind}, ${amount}::numeric, ${day}, ${data.accountId})
      `;
      return { id };
    } catch (err) {
      publicError(err, "Couldn't save that income.");
    }
  });

export const setIncomeActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; isActive: boolean }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ id: string }>`
        update income_sources set is_active = ${data.isActive}, updated_at = now()
        where id = ${data.id} and user_id = ${context.userId}
        returning id
      `;
      if (!rows[0]) throw new Error("That income isn't on your account");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't update that income.");
    }
  });

export const deleteIncomeSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ id: string }>`
        delete from income_sources where id = ${data.id} and user_id = ${context.userId} returning id
      `;
      if (!rows[0]) throw new Error("That income isn't on your account");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't remove that income.");
    }
  });

async function incomeCategoryId(
  sql: Awaited<ReturnType<typeof ensureUser>>["sql"],
  userId: string,
  kind: IncomeKind,
) {
  const preferred = kind === "salary" ? "salary" : "other income";
  const rows = await sql<{ id: string }>`
    select id from categories
    where user_id = ${userId} and type = 'income' and is_active = true
    order by case when lower(name) = ${preferred} then 0 when lower(name) = 'salary' then 1 else 2 end, name
    limit 1
  `;
  return rows[0]?.id ?? null;
}

export const answerPayday = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { sourceId: string; action: "credited" | "not_yet" | "skip"; today: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const today = assertToday(data.today);
      if (data.action !== "credited" && data.action !== "not_yet" && data.action !== "skip") {
        throw new Error("Choose credited, not yet, or skip");
      }
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      const period = periodOf(today);
      const sources = await sql<{
        id: string;
        name: string;
        kind: IncomeKind;
        amount: string;
        account_id: string;
        is_active: boolean;
      }>`
        select id, name, kind, amount::text as amount, account_id, is_active
        from income_sources
        where id = ${data.sourceId} and user_id = ${userId}
      `;
      const source = sources[0];
      if (!source || !source.is_active) throw new Error("That income isn't active");

      if (data.action === "not_yet" || data.action === "skip") {
        const status = data.action === "skip" ? "skipped" : "snoozed";
        const until = data.action === "not_yet" ? addDaysISO(today, 1) : null;
        await sql`
          insert into income_checkins (id, user_id, source_id, period, status, snooze_until)
          values (${crypto.randomUUID()}, ${userId}, ${source.id}, ${period}, ${status}, ${until}::date)
          on conflict (source_id, period) do update set
            status = excluded.status,
            snooze_until = excluded.snooze_until
          where income_checkins.status <> 'credited'
        `;
        return { ok: true as const };
      }

      const existing = await sql<{ status: string; transaction_id: string | null }>`
        select status, transaction_id from income_checkins
        where source_id = ${source.id} and period = ${period}
      `;
      if (existing[0]?.status === "credited") return { ok: true as const, already: true };

      const categoryId = await incomeCategoryId(sql, userId, source.kind);
      const txnId = crypto.randomUUID();
      const amount = parseMoney(source.amount);
      await sql`
        insert into transactions (
          id, user_id, account_id, category_id, type, amount, transaction_date, description, is_committed
        ) values (
          ${txnId}, ${userId}, ${source.account_id}, ${categoryId}, 'income',
          ${amount}::numeric, ${today}::date, ${source.name}, true
        )
      `;
      const claimed = await sql<{ id: string }>`
        insert into income_checkins (id, user_id, source_id, period, status, transaction_id, snooze_until)
        values (${crypto.randomUUID()}, ${userId}, ${source.id}, ${period}, 'credited', ${txnId}, null)
        on conflict (source_id, period) do update set
          status = 'credited',
          transaction_id = coalesce(income_checkins.transaction_id, excluded.transaction_id),
          snooze_until = null
        where income_checkins.status <> 'credited'
        returning id
      `;
      if (!claimed[0]) {
        await sql`delete from transactions where id = ${txnId} and user_id = ${userId}`;
        return { ok: true as const, already: true };
      }
      return { ok: true as const };
    } catch (err) {
      publicError(err, "Couldn't update that payday.");
    }
  });
