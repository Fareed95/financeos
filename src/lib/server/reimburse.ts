import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { can } from "@/lib/biz-access";
import type { Sql } from "@/lib/db";
import { withTransaction } from "@/lib/db";
import { CHART } from "@/lib/ledger";
import { fromCents, parseMoney, toCents } from "@/lib/money";
import {
  allocateReimbursement,
  assertCanRecordFor,
  cashCode,
  planCashTransfer,
  planReimbursement,
  planSpend,
  type SpendSource,
} from "@/lib/reimburse";
import { audit, postJournal, requireBusiness } from "@/lib/server/business";
import { ensureUser } from "@/lib/server/ensure";
import { publicError } from "@/lib/utils";

type Person = { userId: string; name: string; role: string };

async function peopleOf(sql: Sql, businessId: string): Promise<Person[]> {
  const owner = await sql<{ user_id: string; name: string | null }>`
    select pr.user_id, p.full_name as name
    from projects pr
    join businesses b on b.project_id = pr.id
    left join profiles p on p.id = pr.user_id
    where b.id = ${businessId}
  `;
  const members = await sql<{ user_id: string; name: string | null; role: string }>`
    select m.user_id, p.full_name as name, m.role
    from biz_members m
    left join profiles p on p.id = m.user_id
    where m.business_id = ${businessId} and m.status = 'active'
    order by m.joined_at
  `;
  const people: Person[] = [];
  if (owner[0]) people.push({ userId: owner[0].user_id, name: owner[0].name || "Owner", role: "owner" });
  for (const member of members) {
    if (people.some((person) => person.userId === member.user_id)) continue;
    people.push({ userId: member.user_id, name: member.name || "Member", role: member.role });
  }
  return people;
}

function expenseAccount(code: string) {
  const account = CHART.find((row) => row.code === code && row.type === "expense");
  if (!account) throw new Error("Choose an expense account");
  return account;
}

function day(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a date");
  return value;
}

export async function recordSourcedSpend(
  sql: Sql,
  actorId: string,
  businessId: string,
  role: string,
  input: {
    code: string;
    amount: string;
    date: string;
    memo?: string | null;
    source: SpendSource;
    payerUserId?: string | null;
    place?: string | null;
  },
) {
  const source = input.source;
  if (source !== "business" && source !== "personal" && source !== "unpaid") throw new Error("Choose how this was paid");
  if (source === "personal") {
    if (!can(role, "record_personal_business_expense")) throw new Error("You don't have access to do that.");
  } else if (!can(role, "create_records")) {
    throw new Error("You don't have access to do that.");
  }
  const account = expenseAccount(input.code);
  const amount = toCents(parseMoney(input.amount));
  const date = day(input.date);
  let payer: string | null = null;
  if (source === "personal") {
    payer = input.payerUserId || actorId;
    const people = await peopleOf(sql, businessId);
    if (!people.some((person) => person.userId === payer)) throw new Error("Choose a team member");
    assertCanRecordFor(can(role, "manage_reimbursements"), actorId, payer);
  }
  const place = source === "business" ? input.place || "bank" : null;
  const lines = planSpend({
    expenseCode: account.code,
    amount,
    source,
    place: place || undefined,
  });
  const id = crypto.randomUUID();
  const journalId = await postJournal(sql, actorId, businessId, {
    date,
    memo: input.memo?.trim() || account.name,
    source: "expense",
    sourceId: id,
    lines,
  });
  await sql`
    insert into biz_expenses (
      id, business_id, account_code, amount, memo, paid, spent_on, journal_id, environment,
      payer_kind, payer_user_id, reimbursed, place
    ) values (
      ${id}, ${businessId}, ${account.code}, ${fromCents(amount)}::numeric, ${input.memo?.trim() || null},
      ${source === "business"}, ${date}::date, ${journalId}, 'live',
      ${source}, ${payer}, 0, ${place}
    )
  `;
  await audit(sql, businessId, actorId, source === "personal" ? "member_expense.recorded" : "expense.posted", "expense", id);
  return { id };
}

export async function payMemberBack(
  sql: Sql,
  actorId: string,
  businessId: string,
  role: string,
  input: {
    payerUserId: string;
    amount: string;
    date: string;
    place: string;
    expenseIds?: string[] | null;
    idempotencyKey?: string | null;
  },
) {
  if (!can(role, "manage_reimbursements")) throw new Error("You don't have access to do that.");
  const payer = input.payerUserId;
  const people = await peopleOf(sql, businessId);
  if (!people.some((person) => person.userId === payer)) throw new Error("Choose a team member");
  const pay = toCents(parseMoney(input.amount));
  const date = day(input.date);
  const place = input.place || "bank";
  cashCode(place);
  const key = input.idempotencyKey?.trim() || null;
  if (key && key.length > 80) throw new Error("That reference is too long");
  const wanted = new Set((input.expenseIds || []).filter(Boolean));

  return withTransaction(async (tx) => {
    if (key) {
      const prior = await tx<{ id: string }>`
        select id from biz_reimbursements
        where business_id = ${businessId} and idempotency_key = ${key} and environment = 'live'
      `;
      if (prior[0]) return { id: prior[0].id, replayed: true };
    }
    await tx`
      select id from ledger_accounts
      where business_id = ${businessId} and code = ${cashCode(place)}
      for update
    `;
    const cashRows = await tx<{ bal: string }>`
      select coalesce(sum(l.debit - l.credit), 0)::text as bal
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join ledger_accounts a on a.id = l.account_id
      where e.business_id = ${businessId} and e.status = 'posted' and e.environment = 'live'
        and a.code = ${cashCode(place)}
    `;
    if (toCents(cashRows[0]?.bal || "0") < pay) {
      throw new Error("That account doesn't have enough money to reimburse this");
    }
    const openRows = await tx<{ id: string; open: string }>`
      select id, (amount - reimbursed)::text as open
      from biz_expenses
      where business_id = ${businessId} and payer_user_id = ${payer} and payer_kind = 'personal'
        and environment = 'live' and amount > reimbursed
      order by spent_on, id
      for update
    `;
    const slices = openRows
      .filter((row) => wanted.size === 0 || wanted.has(row.id))
      .map((row) => ({ id: row.id, open: toCents(row.open) }));
    const allocation = allocateReimbursement(slices, pay);
    for (const line of allocation) {
      const updated = await tx<{ id: string }>`
        update biz_expenses
        set reimbursed = reimbursed + ${fromCents(line.take)}::numeric
        where id = ${line.id} and business_id = ${businessId}
          and reimbursed + ${fromCents(line.take)}::numeric <= amount
        returning id
      `;
      if (!updated[0]) throw new Error("That amount is no longer outstanding");
    }
    const id = crypto.randomUUID();
    let journalId: string;
    try {
      journalId = await postJournal(tx, actorId, businessId, {
        date,
        memo: "Reimbursement to team member",
        source: "reimbursement",
        sourceId: id,
        lines: planReimbursement(pay, place),
        exclusive: true,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (text.includes("already posted")) throw new Error("That reimbursement is already posted");
      throw error;
    }
    await tx`
      insert into biz_reimbursements (
        id, business_id, payer_user_id, amount, paid_on, place, journal_id, status, created_by, environment, idempotency_key
      ) values (
        ${id}, ${businessId}, ${payer}, ${fromCents(pay)}::numeric, ${date}::date, ${place},
        ${journalId}, 'posted', ${actorId}, 'live', ${key}
      )
    `;
    for (const line of allocation) {
      await tx`
        insert into biz_reimbursement_lines (id, reimbursement_id, expense_id, amount)
        values (${crypto.randomUUID()}, ${id}, ${line.id}, ${fromCents(line.take)}::numeric)
      `;
    }
    const left = await tx<{ open: string }>`
      select coalesce(sum(amount - reimbursed), 0)::text as open
      from biz_expenses
      where business_id = ${businessId} and payer_user_id = ${payer} and payer_kind = 'personal' and environment = 'live'
    `;
    const remaining = toCents(left[0]?.open || "0");
    await audit(tx, businessId, actorId, "reimbursement.created", "reimbursement", id);
    await audit(
      tx,
      businessId,
      actorId,
      remaining === 0n ? "reimbursement.paid" : "reimbursement.partially_paid",
      "reimbursement",
      id,
    );
    return { id, replayed: false, remaining: fromCents(remaining) };
  });
}

export const recordBusinessSpend = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    projectId: string;
    code: string;
    amount: string;
    date: string;
    memo?: string | null;
    source: SpendSource;
    payerUserId?: string | null;
    place?: string | null;
  }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const access = await requireBusiness(sql, context.userId, data.projectId, "view_finance");
      return await recordSourcedSpend(sql, context.userId, access.businessId, access.role, data);
    } catch (err) {
      publicError(err, "Couldn't record that expense.");
    }
  });

export const payReimbursement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    projectId: string;
    payerUserId: string;
    amount: string;
    date: string;
    place: string;
    expenseIds?: string[] | null;
    idempotencyKey?: string | null;
  }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const access = await requireBusiness(sql, context.userId, data.projectId, "view_reimbursements");
      return await payMemberBack(sql, context.userId, access.businessId, access.role, data);
    } catch (err) {
      publicError(err, "Couldn't reimburse that.");
    }
  });

export const transferBusinessMoney = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; amount: string; date: string; from: string; to: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const access = await requireBusiness(sql, context.userId, data.projectId, "create_records");
      const amount = toCents(parseMoney(data.amount));
      const id = crypto.randomUUID();
      await postJournal(sql, context.userId, access.businessId, {
        date: day(data.date),
        memo: "Transfer between business accounts",
        source: "transfer",
        sourceId: id,
        lines: planCashTransfer(amount, data.from, data.to),
      });
      await audit(sql, access.businessId, context.userId, "transfer.posted", "journal", id);
      return { id };
    } catch (err) {
      publicError(err, "Couldn't transfer that.");
    }
  });

export const getReimbursementDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const access = await requireBusiness(sql, context.userId, data.projectId, "view_reimbursements");
      const people = await peopleOf(sql, access.businessId);
      const expenses = await sql<{
        id: string;
        payer_user_id: string | null;
        account_code: string;
        amount: string;
        reimbursed: string;
        memo: string | null;
        spent_on: string;
      }>`
        select id, payer_user_id, account_code, amount::text as amount, reimbursed::text as reimbursed,
               memo, spent_on::text as spent_on
        from biz_expenses
        where business_id = ${access.businessId} and payer_kind = 'personal' and environment = 'live'
        order by spent_on desc, id desc
      `;
      const nameOf = new Map(CHART.map((account) => [account.code, account.name]));
      let total = 0n;
      const grouped = people.map((person) => {
        const rows = expenses.filter((row) => row.payer_user_id === person.userId);
        let due = 0n;
        let returned = 0n;
        const items = rows.map((row) => {
          const open = toCents(row.amount) - toCents(row.reimbursed);
          due += open;
          returned += toCents(row.reimbursed);
          return {
            id: row.id,
            memo: row.memo || nameOf.get(row.account_code) || "Expense",
            code: row.account_code,
            name: nameOf.get(row.account_code) || row.account_code,
            amount: row.amount,
            reimbursed: row.reimbursed,
            open: fromCents(open),
            date: row.spent_on.slice(0, 10),
          };
        });
        total += due;
        return {
          userId: person.userId,
          name: person.name,
          role: person.role,
          due: fromCents(due),
          reimbursed: fromCents(returned),
          count: items.length,
          expenses: items,
        };
      }).filter((person) => person.count > 0);
      return {
        totalDue: fromCents(total),
        canPay: can(access.role, "manage_reimbursements"),
        canRecord: can(access.role, "record_personal_business_expense"),
        people: grouped,
      };
    } catch (err) {
      publicError(err, "Couldn't load reimbursements.");
    }
  });
