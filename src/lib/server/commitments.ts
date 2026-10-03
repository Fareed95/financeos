import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser, ownedAccount } from "@/lib/server/ensure";
import { parseMoney, addMoney, toCents } from "@/lib/money";
import { ASSET_KINDS, straightLine, type AssetKind } from "@/lib/depreciation";
import type { PlanBill } from "@/lib/month-plan";
import { addDaysISO, publicError } from "@/lib/utils";

export const BILL_KINDS = ["emi", "rent", "subscription", "bill", "other"] as const;
export type BillKind = (typeof BILL_KINDS)[number];

export type BillRow = PlanBill & {
  kind: BillKind;
  dayOfMonth: number;
  snoozeUntil: string | null;
  accountId: string;
  accountName: string;
};

export type AssetView = {
  id: string;
  name: string;
  kind: AssetKind;
  purchaseAmount: string;
  salvageAmount: string;
  purchaseDate: string;
  usefulYears: number;
  isActive: boolean;
  monthly: string;
  monthsUsed: number;
  lifeMonths: number;
  depreciated: string;
  bookValue: string;
  finished: boolean;
};

type Sql = Awaited<ReturnType<typeof ensureUser>>["sql"];

function assertToday(today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("Pick a valid date");
  return today;
}

export async function loadCommitments(sql: Sql, userId: string, today: string, period: string) {
  const [billRows, assetRows] = await Promise.all([
    sql<{
      id: string;
      name: string;
      kind: BillKind;
      amount: string;
      day_of_month: number;
      account_id: string;
      account_name: string;
      is_active: boolean;
      status: BillRow["checkin"];
      snooze_until: string | null;
    }>`
      select b.id, b.name, b.kind, b.amount::text as amount, b.day_of_month,
             b.account_id, a.name as account_name, b.is_active,
             c.status, c.snooze_until::text as snooze_until
      from recurring_bills b
      join accounts a on a.id = b.account_id
      left join bill_checkins c on c.bill_id = b.id and c.period = ${period}
      where b.user_id = ${userId}
      order by b.is_active desc, b.day_of_month asc, b.created_at asc
    `,
    sql<{
      id: string;
      name: string;
      kind: AssetKind;
      purchase_amount: string;
      salvage_amount: string;
      purchase_date: string;
      useful_years: number;
      is_active: boolean;
    }>`
      select id, name, kind, purchase_amount::text as purchase_amount,
             salvage_amount::text as salvage_amount, purchase_date::text as purchase_date,
             useful_years, is_active
      from owned_assets
      where user_id = ${userId}
      order by is_active desc, purchase_date desc, created_at asc
    `,
  ]);

  const bills: BillRow[] = billRows.map((row) => ({
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

  const assets: AssetView[] = assetRows.map((row) => {
    const line = straightLine({
      today,
      purchaseDate: row.purchase_date,
      purchaseAmount: row.purchase_amount,
      salvageAmount: row.salvage_amount,
      usefulYears: Number(row.useful_years),
    });
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      purchaseAmount: row.purchase_amount,
      salvageAmount: row.salvage_amount,
      purchaseDate: row.purchase_date,
      usefulYears: Number(row.useful_years),
      isActive: row.is_active,
      ...line,
    };
  });

  const activeAssets = assets.filter((asset) => asset.isActive);
  const bookValue = activeAssets.reduce((sum, asset) => addMoney(sum, asset.bookValue), "0.00");
  const paperDrop = activeAssets
    .filter((asset) => !asset.finished)
    .reduce((sum, asset) => addMoney(sum, asset.monthly), "0.00");

  return { bills, assets, bookValue, paperDrop };
}

function assertBill(data: { name: string; kind: BillKind; amount: string; dayOfMonth: number }) {
  const name = data.name.trim();
  if (!name || name.length > 40) throw new Error("Name should be 1–40 characters");
  if (!BILL_KINDS.includes(data.kind)) throw new Error("Choose EMI, rent, a subscription, or a bill");
  const day = Math.floor(Number(data.dayOfMonth));
  if (day < 1 || day > 31) throw new Error("Day of month should be between 1 and 31");
  const amount = parseMoney(data.amount);
  if (amount.startsWith("-") || amount === "0.00") throw new Error("Amount must be greater than zero");
  return { name, day, amount };
}

export const saveBill = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: { id?: string; name: string; kind: BillKind; amount: string; dayOfMonth: number; accountId: string }) => data,
  )
  .handler(async ({ context, data }) => {
    try {
      const { name, day, amount } = assertBill(data);
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      const account = await ownedAccount(sql, userId, data.accountId);
      if (!account) throw new Error("Choose the account this leaves");
      if (data.id) {
        const rows = await sql<{ id: string }>`
          update recurring_bills set
            name = ${name}, kind = ${data.kind}, amount = ${amount}::numeric,
            day_of_month = ${day}, account_id = ${data.accountId}, updated_at = now()
          where id = ${data.id} and user_id = ${userId}
          returning id
        `;
        if (!rows[0]) throw new Error("That bill isn't on your account");
        return { id: rows[0].id };
      }
      const id = crypto.randomUUID();
      await sql`
        insert into recurring_bills (id, user_id, name, kind, amount, day_of_month, account_id)
        values (${id}, ${userId}, ${name}, ${data.kind}, ${amount}::numeric, ${day}, ${data.accountId})
      `;
      return { id };
    } catch (err) {
      publicError(err, "Couldn't save that bill.");
    }
  });

export const setBillActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; isActive: boolean }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ id: string }>`
        update recurring_bills set is_active = ${data.isActive}, updated_at = now()
        where id = ${data.id} and user_id = ${context.userId}
        returning id
      `;
      if (!rows[0]) throw new Error("That bill isn't on your account");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't update that bill.");
    }
  });

export const deleteBill = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ id: string }>`
        delete from recurring_bills where id = ${data.id} and user_id = ${context.userId} returning id
      `;
      if (!rows[0]) throw new Error("That bill isn't on your account");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't remove that bill.");
    }
  });

async function expenseCategoryId(sql: Sql, userId: string, kind: BillKind) {
  const preferred = kind === "subscription" ? "subscriptions" : kind === "other" ? "other" : "bills";
  const rows = await sql<{ id: string }>`
    select id from categories
    where user_id = ${userId} and type = 'expense' and is_active = true
    order by case when lower(name) = ${preferred} then 0 else 1 end, name
    limit 1
  `;
  return rows[0]?.id ?? null;
}

export const answerBill = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { billId: string; action: "paid" | "not_yet" | "skip"; today: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const today = assertToday(data.today);
      if (data.action !== "paid" && data.action !== "not_yet" && data.action !== "skip") {
        throw new Error("Choose paid, not yet, or skip");
      }
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      const period = today.slice(0, 7);
      const bills = await sql<{
        id: string;
        name: string;
        kind: BillKind;
        amount: string;
        account_id: string;
        is_active: boolean;
      }>`
        select id, name, kind, amount::text as amount, account_id, is_active
        from recurring_bills
        where id = ${data.billId} and user_id = ${userId}
      `;
      const bill = bills[0];
      if (!bill || !bill.is_active) throw new Error("That bill isn't active");

      if (data.action === "not_yet" || data.action === "skip") {
        const status = data.action === "skip" ? "skipped" : "snoozed";
        const until = data.action === "not_yet" ? addDaysISO(today, 1) : null;
        await sql`
          insert into bill_checkins (id, user_id, bill_id, period, status, snooze_until)
          values (${crypto.randomUUID()}, ${userId}, ${bill.id}, ${period}, ${status}, ${until}::date)
          on conflict (bill_id, period) do update set
            status = excluded.status,
            snooze_until = excluded.snooze_until
          where bill_checkins.status <> 'paid'
        `;
        return { ok: true as const };
      }

      const existing = await sql<{ status: string }>`
        select status from bill_checkins where bill_id = ${bill.id} and period = ${period}
      `;
      if (existing[0]?.status === "paid") return { ok: true as const, already: true };

      const categoryId = await expenseCategoryId(sql, userId, bill.kind);
      const txnId = crypto.randomUUID();
      const amount = parseMoney(bill.amount);
      await sql`
        insert into transactions (
          id, user_id, account_id, category_id, type, amount, transaction_date, description, is_committed
        ) values (
          ${txnId}, ${userId}, ${bill.account_id}, ${categoryId}, 'expense',
          ${amount}::numeric, ${today}::date, ${bill.name}, true
        )
      `;
      const claimed = await sql<{ id: string }>`
        insert into bill_checkins (id, user_id, bill_id, period, status, transaction_id, snooze_until)
        values (${crypto.randomUUID()}, ${userId}, ${bill.id}, ${period}, 'paid', ${txnId}, null)
        on conflict (bill_id, period) do update set
          status = 'paid',
          transaction_id = coalesce(bill_checkins.transaction_id, excluded.transaction_id),
          snooze_until = null
        where bill_checkins.status <> 'paid'
        returning id
      `;
      if (!claimed[0]) {
        await sql`delete from transactions where id = ${txnId} and user_id = ${userId}`;
        return { ok: true as const, already: true };
      }
      return { ok: true as const };
    } catch (err) {
      publicError(err, "Couldn't update that bill.");
    }
  });

function assertAsset(data: {
  name: string;
  kind: AssetKind;
  purchaseAmount: string;
  salvageAmount?: string;
  purchaseDate: string;
  usefulYears: number;
}) {
  const name = data.name.trim();
  if (!name || name.length > 40) throw new Error("Name should be 1–40 characters");
  if (!ASSET_KINDS.includes(data.kind)) throw new Error("Choose what kind of thing this is");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.purchaseDate)) throw new Error("Pick the date you bought it");
  const years = Math.floor(Number(data.usefulYears));
  if (years < 1 || years > 40) throw new Error("Useful life should be 1–40 years");
  const purchase = parseMoney(data.purchaseAmount);
  if (purchase.startsWith("-") || purchase === "0.00") throw new Error("Purchase amount must be greater than zero");
  const salvage = parseMoney(data.salvageAmount?.trim() ? data.salvageAmount : "0");
  if (salvage.startsWith("-")) throw new Error("Value at the end can't be negative");
  if (toCents(salvage) > toCents(purchase)) throw new Error("Value at the end can't be more than what you paid");
  return { name, years, purchase, salvage };
}

export const saveAsset = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      id?: string;
      name: string;
      kind: AssetKind;
      purchaseAmount: string;
      salvageAmount?: string;
      purchaseDate: string;
      usefulYears: number;
    }) => data,
  )
  .handler(async ({ context, data }) => {
    try {
      const { name, years, purchase, salvage } = assertAsset(data);
      const { sql } = await ensureUser(context.userId);
      const userId = context.userId;
      if (data.id) {
        const rows = await sql<{ id: string }>`
          update owned_assets set
            name = ${name}, kind = ${data.kind},
            purchase_amount = ${purchase}::numeric, salvage_amount = ${salvage}::numeric,
            purchase_date = ${data.purchaseDate}::date, useful_years = ${years}, updated_at = now()
          where id = ${data.id} and user_id = ${userId}
          returning id
        `;
        if (!rows[0]) throw new Error("That asset isn't on your account");
        return { id: rows[0].id };
      }
      const id = crypto.randomUUID();
      await sql`
        insert into owned_assets (
          id, user_id, name, kind, purchase_amount, salvage_amount, purchase_date, useful_years
        ) values (
          ${id}, ${userId}, ${name}, ${data.kind}, ${purchase}::numeric, ${salvage}::numeric,
          ${data.purchaseDate}::date, ${years}
        )
      `;
      return { id };
    } catch (err) {
      publicError(err, "Couldn't save that asset.");
    }
  });

export const setAssetActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; isActive: boolean }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ id: string }>`
        update owned_assets set is_active = ${data.isActive}, updated_at = now()
        where id = ${data.id} and user_id = ${context.userId}
        returning id
      `;
      if (!rows[0]) throw new Error("That asset isn't on your account");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't update that asset.");
    }
  });

export const deleteAsset = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ id: string }>`
        delete from owned_assets where id = ${data.id} and user_id = ${context.userId} returning id
      `;
      if (!rows[0]) throw new Error("That asset isn't on your account");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't remove that asset.");
    }
  });

export function defaultUsefulYears(kind: AssetKind): number {
  if (kind === "vehicle") return 8;
  if (kind === "property") return 20;
  if (kind === "gadget") return 3;
  return 5;
}
