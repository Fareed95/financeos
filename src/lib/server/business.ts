import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import { ownership, type Holder, type Ownership } from "@/lib/cap-table";
import {
  CHART,
  assertBalanced,
  buildStatements,
  type DraftLine,
  type PostedLine,
} from "@/lib/ledger";
import { fromCents, parseMoney, toCents } from "@/lib/money";
import { assertOpeningAllowed, can, periodRange, planStartingMoney, type BizPermission } from "@/lib/biz-access";
import { previousWindow, recentMonthRanges, runwayFrom, whyProfitChanged } from "@/lib/ops";
import { recordedDecision, buildOwnershipView, linkExistingHolder, type OwnershipPerson } from "@/lib/ownership-decision";
import { ensureUser } from "@/lib/server/ensure";
import { publicError } from "@/lib/utils";

const SCOPES = [
  "customers:read",
  "customers:create",
  "customers:update",
  "invoices:read",
  "invoices:create",
  "invoices:update",
  "payments:read",
  "payments:create",
  "expenses:read",
  "expenses:create",
  "reports:read",
  "transactions:read",
  "transactions:create",
  "accounting:read",
  "vendors:read",
  "vendors:create",
  "vendors:update",
  "bills:read",
  "bills:create",
  "bills:update",
  "budgets:read",
  "budgets:write",
  "assets:read",
  "loans:read",
] as const;

async function sha256(value: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

async function ownerProject(sql: Sql, userId: string, projectId: string) {
  const rows = await sql<{ id: string; name: string; project_type: string }>`
    select id, name, project_type from projects where id = ${projectId} and user_id = ${userId}
  `;
  const project = rows[0];
  if (!project) throw new Error("Project not found");
  if (project.project_type !== "business") throw new Error("This project is not a business");
  return project;
}

export async function audit(sql: Sql, businessId: string, actorId: string, action: string, entity: string, entityId: string) {
  await sql`
    insert into biz_audit (id, business_id, actor_id, action, entity, entity_id)
    values (${crypto.randomUUID()}, ${businessId}, ${actorId}, ${action}, ${entity}, ${entityId})
  `;
}

export async function ensureBusiness(sql: Sql, userId: string, projectId: string) {
  const project = await ownerProject(sql, userId, projectId);
  const existing = await sql<{ id: string }>`select id from businesses where project_id = ${projectId}`;
  let businessId = existing[0]?.id;
  if (!businessId) {
    businessId = crypto.randomUUID();
    await sql`
      insert into businesses (id, project_id, legal_name)
      values (${businessId}, ${projectId}, ${project.name})
    `;
  }
  const count = await sql<{ n: number }>`select count(*)::int as n from ledger_accounts where business_id = ${businessId}`;
  if ((count[0]?.n ?? 0) === 0) {
    for (const account of CHART) {
      await sql`
        insert into ledger_accounts (id, business_id, code, name, account_type, subtype, is_cash)
        values (
          ${crypto.randomUUID()}, ${businessId}, ${account.code}, ${account.name},
          ${account.type}, ${account.subtype}, ${account.cash}
        )
      `;
    }
  } else {
    const have = new Set(
      (await sql<{ code: string }>`select code from ledger_accounts where business_id = ${businessId}`).map((row) => row.code),
    );
    for (const account of CHART) {
      if (have.has(account.code)) continue;
      await sql`
        insert into ledger_accounts (id, business_id, code, name, account_type, subtype, is_cash)
        values (
          ${crypto.randomUUID()}, ${businessId}, ${account.code}, ${account.name},
          ${account.type}, ${account.subtype}, ${account.cash}
        )
      `;
    }
  }
  return businessId;
}

export async function requireBusiness(sql: Sql, userId: string, projectId: string, permission: BizPermission) {
  const rows = await sql<{ id: string; name: string; project_type: string; user_id: string }>`
    select id, name, project_type, user_id from projects where id = ${projectId}
  `;
  const project = rows[0];
  if (!project || project.project_type !== "business") throw new Error("Project not found");
  if (project.user_id === userId) {
    return { businessId: await ensureBusiness(sql, userId, projectId), role: "owner" as const };
  }
  const biz = await sql<{ id: string }>`select id from businesses where project_id = ${projectId}`;
  if (!biz[0]) throw new Error("Project not found");
  const members = await sql<{ role: string }>`
    select role from biz_members
    where business_id = ${biz[0].id} and user_id = ${userId} and status = 'active'
  `;
  const role = members[0]?.role;
  if (!role || !can(role, permission)) throw new Error("You don't have access to do that.");
  return { businessId: biz[0].id, role };
}

async function accountIds(sql: Sql, businessId: string) {
  const rows = await sql<{ id: string; code: string }>`
    select id, code from ledger_accounts where business_id = ${businessId} and is_active = true
  `;
  return new Map(rows.map((row) => [row.code, row.id]));
}

export async function postJournal(
  sql: Sql,
  actorId: string,
  businessId: string,
  input: {
    date: string;
    memo: string | null;
    source: string;
    sourceId: string | null;
    lines: DraftLine[];
    environment?: "live" | "test";
    /** When set, a second poster of the same source is an error instead of a silent reuse. */
    exclusive?: boolean;
  },
) {
  assertBalanced(input.lines);
  const environment = input.environment ?? "live";
  if (input.sourceId) {
    const dup = await sql<{ id: string }>`
      select id from journal_entries
      where business_id = ${businessId} and source = ${input.source} and source_id = ${input.sourceId}
        and status = 'posted' and environment = ${environment}
    `;
    if (dup[0]) {
      if (input.exclusive) throw new Error("That entry is already posted");
      return dup[0].id;
    }
  }
  const entryId = crypto.randomUUID();
  try {
    await sql`
      insert into journal_entries (id, business_id, entry_date, memo, source, source_id, status, created_by, environment)
      values (
        ${entryId}, ${businessId}, ${input.date}::date, ${input.memo}, ${input.source}, ${input.sourceId},
        'posted', ${actorId}, ${environment}
      )
    `;
  } catch (error) {
    const text = String(error).toLowerCase();
    if (input.sourceId && (text.includes("journal_source") || text.includes("duplicate") || text.includes("unique"))) {
      if (input.exclusive) throw new Error("That entry is already posted");
      const winner = await sql<{ id: string }>`
        select id from journal_entries
        where business_id = ${businessId} and source = ${input.source} and source_id = ${input.sourceId}
          and status = 'posted' and environment = ${environment}
      `;
      if (winner[0]) return winner[0].id;
    }
    throw error;
  }
  const ids = await accountIds(sql, businessId);
  for (const line of input.lines) {
    const accountId = ids.get(line.code);
    if (!accountId) throw new Error(`Unknown account ${line.code}`);
    await sql`
      insert into journal_lines (id, entry_id, account_id, debit, credit)
      values (
        ${crypto.randomUUID()}, ${entryId}, ${accountId},
        ${fromCents(line.debit)}::numeric, ${fromCents(line.credit)}::numeric
      )
    `;
  }
  const sums = await sql<{ d: string; c: string }>`
    select coalesce(sum(debit), 0)::text as d, coalesce(sum(credit), 0)::text as c
    from journal_lines where entry_id = ${entryId}
  `;
  if (toCents(sums[0]?.d ?? "0") !== toCents(sums[0]?.c ?? "0")) {
    await sql`delete from journal_entries where id = ${entryId}`;
    throw new Error("Journal does not balance");
  }
  await sql`update journal_entries set status = 'posted' where id = ${entryId} and status = 'posted'`;
  await audit(sql, businessId, actorId, "journal.posted", "journal", entryId);
  return entryId;
}

function moneyLine(code: string, debit: bigint, credit: bigint): DraftLine {
  return { code, debit, credit };
}

export async function issueInvoice(
  sql: Sql,
  actorId: string,
  businessId: string,
  input: { customer: string; subtotal: string; discount?: string; tax?: string; date: string; due?: string | null },
) {
  void sql;
  void actorId;
  void businessId;
  void input;
  throw new Error("Save a draft, check the GST breakup, then issue it.");
}

export async function collectInvoice(
  sql: Sql,
  actorId: string,
  businessId: string,
  input: { invoiceId: string; amount: string; date: string },
) {
  const rows = await sql<{ id: string; number: string; total: string; amount_paid: string; status: string }>`
    select id, number, total::text as total, amount_paid::text as amount_paid, status
    from biz_invoices where id = ${input.invoiceId} and business_id = ${businessId}
  `;
  const invoice = rows[0];
  if (!invoice || invoice.status === "void") throw new Error("Invoice not found");
  const open = toCents(invoice.total) - toCents(invoice.amount_paid);
  const amount = toCents(parseMoney(input.amount));
  if (amount <= 0n || amount > open) throw new Error("Payment is more than the amount still open");
  const paymentId = crypto.randomUUID();
  const journalId = await postJournal(sql, actorId, businessId, {
    date: input.date,
    memo: `Payment for ${invoice.number}`,
    source: "payment",
    sourceId: paymentId,
    lines: [moneyLine("1010", amount, 0n), moneyLine("1100", 0n, amount)],
  });
  const paid = toCents(invoice.amount_paid) + amount;
  const status = paid === toCents(invoice.total) ? "paid" : "partially_paid";
  await sql`
    insert into biz_payments (id, business_id, invoice_id, amount, paid_on, journal_id)
    values (${paymentId}, ${businessId}, ${invoice.id}, ${fromCents(amount)}::numeric, ${input.date}::date, ${journalId})
  `;
  await sql`
    update biz_invoices set amount_paid = ${fromCents(paid)}::numeric, status = ${status} where id = ${invoice.id}
  `;
  await audit(sql, businessId, actorId, "payment.posted", "payment", paymentId);
  return { id: paymentId, status };
}

export async function recordExpense(
  sql: Sql,
  actorId: string,
  businessId: string,
  input: { code: string; amount: string; date: string; memo?: string | null; paid: boolean; environment?: "live" | "test" },
) {
  const code = input.code;
  const account = CHART.find((row) => row.code === code && row.type === "expense");
  if (!account) throw new Error("Choose an expense account");
  const amount = toCents(parseMoney(input.amount));
  if (amount <= 0n) throw new Error("Amount must be greater than zero");
  const environment = input.environment ?? "live";
  const id = crypto.randomUUID();
  const credit = input.paid ? "1010" : "2000";
  const journalId = await postJournal(sql, actorId, businessId, {
    date: input.date,
    memo: input.memo?.trim() || account.name,
    source: "expense",
    sourceId: id,
    lines: [moneyLine(code, amount, 0n), moneyLine(credit, 0n, amount)],
    environment,
  });
  await sql`
    insert into biz_expenses (id, business_id, account_code, amount, memo, paid, spent_on, journal_id, environment)
    values (
      ${id}, ${businessId}, ${code}, ${fromCents(amount)}::numeric, ${input.memo ?? null},
      ${input.paid}, ${input.date}::date, ${journalId}, ${environment}
    )
  `;
  await audit(sql, businessId, actorId, "expense.posted", "expense", id);
  return { id };
}

export async function recordCapital(
  sql: Sql,
  actorId: string,
  businessId: string,
  input: { amount: string; date: string; place?: string; origin?: string; kind?: "opening" | "contribution" },
) {
  const kind = input.kind === "contribution" ? "contribution" : "opening";
  const existing = await sql<{ id: string }>`
    select id from journal_entries
    where business_id = ${businessId} and source in ('capital', 'opening') and status = 'posted'
    limit 1
  `;
  if (kind === "opening") assertOpeningAllowed(Boolean(existing[0]));
  const amount = toCents(parseMoney(input.amount));
  const lines = planStartingMoney({
    amount,
    place: input.place || "bank",
    origin: input.origin || "founder",
  });
  const id = crypto.randomUUID();
  await postJournal(sql, actorId, businessId, {
    date: input.date,
    memo: kind === "opening" ? "Starting balance" : "Money added to the business",
    source: kind === "opening" ? "opening" : "contribution",
    sourceId: id,
    lines,
  });
  if (kind === "opening") {
    await sql`update businesses set setup_completed_at = coalesce(setup_completed_at, now()) where id = ${businessId}`;
  }
  await audit(sql, businessId, actorId, kind === "opening" ? "opening.posted" : "contribution.posted", "journal", id);
  return { id };
}

export async function issueShares(
  sql: Sql,
  actorId: string,
  businessId: string,
  input: { holder: string; shares: number; amount?: string | null; date: string; linkUserId?: string | null },
) {
  const holder = input.holder.trim();
  if (!holder) throw new Error("Shareholder name is required");
  if (!Number.isInteger(input.shares) || input.shares <= 0) throw new Error("Shares must be a whole number");
  const linkUserId = input.linkUserId?.trim() || null;
  const linkKind = linkUserId ? await linkTarget(sql, businessId, linkUserId) : null;
  const id = crypto.randomUUID();
  const amount = input.amount?.trim() ? toCents(parseMoney(input.amount)) : 0n;
  await sql`
    insert into biz_equity_events (id, business_id, kind, holder, shares, amount, event_date)
    values (${id}, ${businessId}, 'issuance', ${holder}, ${input.shares}, ${amount ? fromCents(amount) : null}, ${input.date}::date)
  `;
  if (linkKind === "owner") {
    await sql`update businesses set owner_stakeholder_name = ${holder} where id = ${businessId}`;
  }
  if (linkKind === "member") {
    await sql`
      update biz_members set stakeholder_name = ${holder}
      where business_id = ${businessId} and user_id = ${linkUserId} and status = 'active'
    `;
  }
  if (amount > 0n) {
    await postJournal(sql, actorId, businessId, {
      date: input.date,
      memo: `Shares issued to ${holder}`,
      source: "equity",
      sourceId: id,
      lines: [moneyLine("1010", amount, 0n), moneyLine("3000", 0n, amount)],
    });
  }
  await audit(sql, businessId, actorId, "shares.issued", "equity", id);
  return { id };
}

export async function linkStakeholder(
  sql: Sql,
  actorId: string,
  businessId: string,
  input: { holder: string; linkUserId: string },
) {
  const write = linkExistingHolder(input);
  const holders = await holdersOf(sql, businessId);
  if (!holders.some((holder) => holder.name === write.holder && holder.shares > 0n)) {
    throw new Error("That shareholder has no shares yet. Issue shares instead.");
  }
  const kind = await linkTarget(sql, businessId, write.linkUserId);
  await sql`
    update biz_members set stakeholder_name = null
    where business_id = ${businessId} and stakeholder_name = ${write.holder}
  `;
  await sql`
    update businesses set owner_stakeholder_name = null
    where id = ${businessId} and owner_stakeholder_name = ${write.holder}
  `;
  if (kind === "owner") {
    await sql`update businesses set owner_stakeholder_name = ${write.holder} where id = ${businessId}`;
  } else {
    await sql`
      update biz_members set stakeholder_name = ${write.holder}
      where business_id = ${businessId} and user_id = ${write.linkUserId} and status = 'active'
    `;
  }
  await audit(sql, businessId, actorId, "ownership.linked", "equity", write.linkUserId);
  return { ok: true as const, shareEvents: write.shareEvents };
}

async function linkTarget(sql: Sql, businessId: string, userId: string) {
  const owner = await sql<{ user_id: string }>`
    select pr.user_id
    from businesses b
    join projects pr on pr.id = b.project_id
    where b.id = ${businessId}
  `;
  if (owner[0]?.user_id === userId) return "owner" as const;
  const member = await sql<{ id: string }>`
    select id from biz_members
    where business_id = ${businessId} and user_id = ${userId} and status = 'active'
  `;
  if (!member[0]) throw new Error("That person is not on this team");
  return "member" as const;
}

function holderPosition(name: string | null, holders: Ownership[]) {
  const cleaned = name?.trim() || "";
  if (!cleaned) return { linked: false, shares: 0n, bps: 0n, holderName: null as string | null };
  const found = holders.find((holder) => holder.name === cleaned);
  return { linked: true, shares: found?.shares ?? 0n, bps: found?.bps ?? 0n, holderName: cleaned };
}

export async function loadOwnershipPeople(sql: Sql, businessId: string, holders: Ownership[]) {
  const meta = await sql<{
    name: string;
    owner_id: string;
    owner_name: string | null;
    owner_email: string | null;
    owner_stakeholder_name: string | null;
  }>`
    select pr.name, pr.user_id as owner_id, p.full_name as owner_name, u.email as owner_email, b.owner_stakeholder_name
    from businesses b
    join projects pr on pr.id = b.project_id
    left join profiles p on p.id = pr.user_id
    left join "user" u on u.id = pr.user_id
    where b.id = ${businessId}
  `;
  const members = await sql<{
    id: string;
    user_id: string;
    role: string;
    full_name: string | null;
    email: string | null;
    stakeholder_name: string | null;
    ownership_decision: string | null;
  }>`
    select m.id, m.user_id, m.role, p.full_name, u.email, m.stakeholder_name, m.ownership_decision
    from biz_members m
    left join profiles p on p.id = m.user_id
    left join "user" u on u.id = m.user_id
    where m.business_id = ${businessId} and m.status = 'active'
    order by m.joined_at
  `;
  const row = meta[0];
  const people: Array<OwnershipPerson & { email: string | null; holderName: string | null }> = [];
  if (row) {
    const position = holderPosition(row.owner_stakeholder_name, holders);
    people.push({
      id: "owner",
      userId: row.owner_id,
      name: row.owner_name || "Owner",
      role: "owner",
      email: row.owner_email,
      linked: position.linked,
      shares: position.shares,
      bps: position.bps,
      decision: null,
      holderName: position.holderName,
    });
  }
  for (const member of members) {
    const position = holderPosition(member.stakeholder_name, holders);
    people.push({
      id: member.id,
      userId: member.user_id,
      name: member.full_name || "Member",
      role: member.role,
      email: member.email,
      linked: position.linked,
      shares: position.shares,
      bps: position.bps,
      decision: recordedDecision(member.ownership_decision),
      holderName: position.holderName,
    });
  }
  return { businessName: row?.name || "this business", people };
}

export async function holdersOf(sql: Sql, businessId: string): Promise<Holder[]> {
  const events = await sql<{ kind: string; holder: string; counterparty: string | null; shares: string }>`
    select kind, holder, counterparty, shares::text as shares
    from biz_equity_events where business_id = ${businessId} order by event_date asc, created_at asc
  `;
  const map = new Map<string, bigint>();
  for (const event of events) {
    const shares = BigInt(event.shares);
    if (event.kind === "issuance") map.set(event.holder, (map.get(event.holder) ?? 0n) + shares);
    if (event.kind === "cancellation") map.set(event.holder, (map.get(event.holder) ?? 0n) - shares);
    if (event.kind === "transfer") {
      map.set(event.holder, (map.get(event.holder) ?? 0n) - shares);
      const to = event.counterparty || "";
      map.set(to, (map.get(to) ?? 0n) + shares);
    }
  }
  return [...map.entries()].filter(([, shares]) => shares > 0n).map(([name, shares]) => ({ name, shares }));
}

function fiscalRange(today: string, startMonth = 4) {
  const [yearText, monthText] = today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const startYear = month >= startMonth ? year : year - 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const last = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return {
    from: `${startYear}-${String(startMonth).padStart(2, "0")}-01`,
    to: `${endYear}-${String(endMonth).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

export async function loadLines(sql: Sql, businessId: string): Promise<PostedLine[]> {
  const rows = await sql<{ entry_id: string; date: string; code: string; debit: string; credit: string }>`
    select e.id as entry_id, e.entry_date::text as date, a.code, l.debit::text as debit, l.credit::text as credit
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join ledger_accounts a on a.id = l.account_id
    where e.business_id = ${businessId} and e.status = 'posted' and e.environment = 'live'
  `;
  return rows.map((row) => ({
    entryId: row.entry_id,
    date: row.date.slice(0, 10),
    code: row.code,
    debit: toCents(row.debit),
    credit: toCents(row.credit),
  }));
}

function present(books: ReturnType<typeof buildStatements>) {
  const money = (value: bigint) => fromCents(value);
  const rows = (list: { code: string; name: string; amount: bigint }[]) =>
    list.map((row) => ({ ...row, amount: money(row.amount) }));
  return {
    ok: books.ok,
    error: books.error,
    totalRevenue: money(books.totalRevenue),
    grossProfit: money(books.grossProfit),
    ebitda: money(books.ebitda),
    ebit: money(books.ebit),
    profitBeforeTax: money(books.profitBeforeTax),
    netProfit: money(books.netProfit),
    totalAssets: money(books.totalAssets),
    totalLiabilities: money(books.totalLiabilities),
    totalEquity: money(books.totalEquity),
    currentEarnings: money(books.currentEarnings),
    openingCash: money(books.openingCash),
    operating: money(books.operating),
    investing: money(books.investing),
    financing: money(books.financing),
    closingCash: money(books.closingCash),
    trialDebit: money(books.trialDebit),
    trialCredit: money(books.trialCredit),
    revenue: rows(books.revenue),
    cogs: rows(books.cogs),
    opex: rows(books.opex),
    depreciation: money(books.depreciation),
    interest: money(books.interest),
    tax: money(books.tax),
    assets: rows(books.assets),
    liabilities: rows(books.liabilities),
    equity: rows(books.equity),
    hasActivity: books.trialDebit !== 0n || books.trialCredit !== 0n,
  };
}

export const getBusiness = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; today: string; period?: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const access = await requireBusiness(sql, context.userId, data.projectId, "view_finance");
      const businessId = access.businessId;
      const today = data.today || new Date().toISOString().slice(0, 10);
      const range = periodRange(today, data.period || "month");
      const lines = await loadLines(sql, businessId);
      const invoices = await sql<{
        id: string;
        number: string;
        customer_name: string;
        issue_date: string;
        due_date: string | null;
        total: string;
        amount_paid: string;
        status: string;
        taxable_total: string;
        cgst_total: string;
        sgst_total: string;
        igst_total: string;
      }>`
        select id, number, customer_name, issue_date::text as issue_date, due_date::text as due_date,
               total::text as total, amount_paid::text as amount_paid, status,
               taxable_total::text as taxable_total, cgst_total::text as cgst_total,
               sgst_total::text as sgst_total, igst_total::text as igst_total
        from biz_invoices where business_id = ${businessId} order by issue_date desc, number desc
      `;
      const expenses = await sql<{
        id: string;
        account_code: string;
        amount: string;
        memo: string | null;
        paid: boolean;
        spent_on: string;
        payer_kind: string;
        payer_user_id: string | null;
        reimbursed: string;
        place: string | null;
      }>`
        select id, account_code, amount::text as amount, memo, paid, spent_on::text as spent_on,
               payer_kind, payer_user_id, reimbursed::text as reimbursed, place
        from biz_expenses where business_id = ${businessId} and environment = 'live'
        order by spent_on desc
      `;
      const keys = await sql<{ id: string; name: string; prefix: string; environment: string; scopes: string; revoked_at: string | null }>`
        select id, name, prefix, environment, scopes, revoked_at::text as revoked_at
        from biz_api_keys where business_id = ${businessId} order by created_at desc
      `;
      const holderRows = ownership(await holdersOf(sql, businessId));
      const holders = can(access.role, "view_equity") ? holderRows : [];
      const roster = await loadOwnershipPeople(sql, businessId, holderRows);
      const ownershipView = buildOwnershipView({
        businessName: roster.businessName,
        viewerRole: access.role,
        members: roster.people,
      });
      const opening = await sql<{ id: string }>`
        select id from journal_entries
        where business_id = ${businessId} and source in ('capital', 'opening', 'opening_full') and status = 'posted'
        limit 1
      `;
      const profile = await sql<{ setup_completed_at: string | null; business_kind: string | null; gst_registered: string | null }>`
        select setup_completed_at::text as setup_completed_at, business_kind, gst_registered
        from businesses where id = ${businessId}
      `;
      let cash = 0n;
      let bank = 0n;
      let cashBox = 0n;
      let petty = 0n;
      let receivable = 0n;
      let payable = 0n;
      let reimbursement = 0n;
      let gstPayable = 0n;
      for (const line of lines) {
        if (line.code === "1000") cashBox += line.debit - line.credit;
        if (line.code === "1010") bank += line.debit - line.credit;
        if (line.code === "1020") petty += line.debit - line.credit;
        if (line.code === "1000" || line.code === "1010" || line.code === "1020") cash += line.debit - line.credit;
        if (line.code === "1100") receivable += line.debit - line.credit;
        if (line.code === "2000") payable += line.credit - line.debit;
        if (line.code === "2500") reimbursement += line.credit - line.debit;
        if (line.code === "2210" || line.code === "2220" || line.code === "2230") gstPayable += line.credit - line.debit;
      }
      const funded = await sql<{ amount: string }>`
        select coalesce(sum(l.credit - l.debit), 0)::text as amount
        from journal_lines l
        join journal_entries e on e.id = l.entry_id
        join ledger_accounts a on a.id = l.account_id
        where e.business_id = ${businessId} and e.status = 'posted' and e.environment = 'live'
          and e.source in ('capital', 'opening', 'contribution')
          and a.code in ('3000', '3100', '3200')
      `;
      const people = await sql<{ user_id: string; name: string | null; role: string }>`
        select pr.user_id, p.full_name as name, 'owner' as role
        from projects pr
        join businesses b on b.project_id = pr.id
        left join profiles p on p.id = pr.user_id
        where b.id = ${businessId}
        union all
        select m.user_id, p.full_name, m.role
        from biz_members m
        left join profiles p on p.id = m.user_id
        where m.business_id = ${businessId} and m.status = 'active'
      `;
      const owedPeople = new Set(
        expenses.filter((row) => row.payer_kind === "personal" && toCents(row.amount) > toCents(row.reimbursed) && row.payer_user_id).map((row) => row.payer_user_id),
      );
      const showKeys = can(access.role, "manage_api_keys");
      const currentBooks = buildStatements(lines, range.from, range.to);
      const previousRange = previousWindow(range.from, range.to);
      const previousBooks = buildStatements(lines, previousRange.from, previousRange.to);
      const expenseParts = (books: ReturnType<typeof buildStatements>) =>
        [
          ...books.cogs,
          ...books.opex,
          { code: "5700", name: "Depreciation", amount: books.depreciation },
          { code: "5800", name: "Interest", amount: books.interest },
          { code: "5900", name: "Tax", amount: books.tax },
        ].filter((row) => row.amount !== 0n);
      const change = whyProfitChanged(
        { revenue: previousBooks.totalRevenue, expenses: expenseParts(previousBooks), profit: previousBooks.netProfit },
        { revenue: currentBooks.totalRevenue, expenses: expenseParts(currentBooks), profit: currentBooks.netProfit },
      );
      const runway = runwayFrom(cash, recentMonthRanges(today, 3).map((window) => buildStatements(lines, window.from, window.to).operating));
      return {
        businessId,
        role: access.role,
        range,
        openingDone: Boolean(opening[0]),
        setupDone: Boolean(opening[0] || profile[0]?.setup_completed_at),
        businessKind: profile[0]?.business_kind ?? null,
        cash: fromCents(cash),
        bank: fromCents(bank),
        cashBox: fromCents(cashBox),
        petty: fromCents(petty),
        receivable: fromCents(receivable),
        payable: fromCents(payable),
        reimbursementDue: fromCents(reimbursement),
        reimbursementPeople: owedPeople.size,
        gstPayable: fromCents(gstPayable),
        ownerFunding: fromCents(toCents(funded[0]?.amount || "0")),
        statements: present(currentBooks),
        expenseAccounts: CHART.filter((account) => account.type === "expense").map((account) => ({
          code: account.code,
          name: account.name,
        })),
        invoices: invoices.map((row) => ({
          ...row,
          issueDate: row.issue_date.slice(0, 10),
          dueDate: row.due_date?.slice(0, 10) ?? null,
        })),
        expenses: expenses.map((row) => ({
          ...row,
          spentOn: row.spent_on.slice(0, 10),
          payerKind: row.payer_kind,
          payerUserId: row.payer_user_id,
          reimbursed: row.reimbursed,
          place: row.place,
        })),
        people: people
          .filter((person, index, list) => person.user_id && list.findIndex((item) => item.user_id === person.user_id) === index)
          .map((person) => ({ userId: person.user_id, name: person.name || "Member", role: person.role })),
        holders: holders.map((row) => ({ name: row.name, shares: row.shares.toString(), bps: row.bps.toString() })),
        stakeholderLinks: can(access.role, "view_equity")
          ? roster.people.flatMap((person) => (person.holderName ? [{ userId: person.userId, holder: person.holderName }] : []))
          : [],
        ownershipPrompt: ownershipView.prompt,
        ownershipReminder: ownershipView.reminder,
        keys: showKeys ? keys.map((row) => ({ ...row, revoked: Boolean(row.revoked_at) })) : [],
        change: {
          explained: change.explained,
          delta: fromCents(change.delta),
          parts: change.parts.map((part) => ({ label: part.label, amount: fromCents(part.impact) })),
        },
        runway,
      };
    } catch (err) {
      publicError(err, "Couldn't load this business.");
    }
  });

async function withBusiness(userId: string, projectId: string, permission: BizPermission) {
  const { sql } = await ensureUser(userId);
  const access = await requireBusiness(sql, userId, projectId, permission);
  return { sql, businessId: access.businessId, role: access.role };
}

export const postBusinessCapital = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; amount: string; date: string; place?: string; origin?: string; kind?: "opening" | "contribution" }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId, "create_records");
      return await recordCapital(sql, context.userId, businessId, data);
    } catch (err) {
      publicError(err, "Couldn't record that capital.");
    }
  });

export const postBusinessInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; customer: string; subtotal: string; discount?: string; tax?: string; date: string; due?: string | null }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId, "create_records");
      return await issueInvoice(sql, context.userId, businessId, data);
    } catch (err) {
      publicError(err, "Couldn't issue that invoice.");
    }
  });

export const postBusinessPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; invoiceId: string; amount: string; date: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId, "create_records");
      return await collectInvoice(sql, context.userId, businessId, data);
    } catch (err) {
      publicError(err, "Couldn't record that payment.");
    }
  });

export const postBusinessExpense = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; code: string; amount: string; date: string; memo?: string | null; paid: boolean }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId, "create_records");
      return await recordExpense(sql, context.userId, businessId, data);
    } catch (err) {
      publicError(err, "Couldn't record that expense.");
    }
  });

export const postBusinessShares = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; holder: string; shares: number; amount?: string | null; date: string; linkUserId?: string | null }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId, "manage_equity");
      return await issueShares(sql, context.userId, businessId, data);
    } catch (err) {
      publicError(err, "Couldn't issue those shares.");
    }
  });

export const linkBusinessStakeholder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; holder: string; linkUserId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId, "manage_equity");
      return await linkStakeholder(sql, context.userId, businessId, data);
    } catch (err) {
      publicError(err, "Couldn't link that shareholder.");
    }
  });

export const createBusinessApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; name: string; environment: "test" | "live"; scopes: string[]; expiresInDays?: number | null }) => data)
  .handler(async ({ context, data }) => {
    try {
      const name = data.name.trim();
      if (!name) throw new Error("Name the key");
      if (data.environment !== "test" && data.environment !== "live") throw new Error("Choose test or live");
      const scopes = [...new Set(data.scopes.filter((scope) => (SCOPES as readonly string[]).includes(scope)))];
      if (scopes.length === 0) throw new Error("Pick at least one permission");
      const { sql, businessId } = await withBusiness(context.userId, data.projectId, "manage_api_keys");
      const raw = `kh_${data.environment}_${crypto.randomUUID().replace(/-/g, "")}`;
      const id = crypto.randomUUID();
      const days = data.expiresInDays;
      const expires = days && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
      await sql`
        insert into biz_api_keys (id, business_id, name, prefix, hashed_secret, environment, scopes, created_by, expires_at)
        values (
          ${id}, ${businessId}, ${name}, ${raw.slice(0, 16)}, ${await sha256(raw)},
          ${data.environment}, ${scopes.join(",")}, ${context.userId}, ${expires}
        )
      `;
      await audit(sql, businessId, context.userId, "api_key.created", "api_key", id);
      return { id, token: raw, prefix: raw.slice(0, 16) };
    } catch (err) {
      publicError(err, "Couldn't create that key.");
    }
  });

export const revokeBusinessApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; keyId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId, "manage_api_keys");
      await sql`
        update biz_api_keys set revoked_at = now()
        where id = ${data.keyId} and business_id = ${businessId} and revoked_at is null
      `;
      await audit(sql, businessId, context.userId, "api_key.revoked", "api_key", data.keyId);
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't revoke that key.");
    }
  });

export const rotateBusinessApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; keyId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId, "manage_api_keys");
      const rows = await sql<{ name: string; environment: string; scopes: string }>`
        select name, environment, scopes from biz_api_keys
        where id = ${data.keyId} and business_id = ${businessId} and revoked_at is null
      `;
      const current = rows[0];
      if (!current) throw new Error("Key not found");
      await sql`update biz_api_keys set revoked_at = now() where id = ${data.keyId}`;
      const raw = `kh_${current.environment}_${crypto.randomUUID().replace(/-/g, "")}`;
      const id = crypto.randomUUID();
      await sql`
        insert into biz_api_keys (id, business_id, name, prefix, hashed_secret, environment, scopes, created_by)
        values (
          ${id}, ${businessId}, ${current.name}, ${raw.slice(0, 16)}, ${await sha256(raw)},
          ${current.environment}, ${current.scopes}, ${context.userId}
        )
      `;
      await audit(sql, businessId, context.userId, "api_key.rotated", "api_key", id);
      return { id, token: raw, prefix: raw.slice(0, 16) };
    } catch (err) {
      publicError(err, "Couldn't rotate that key.");
    }
  });

export const listBusinessApiLogs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId, "manage_api_keys");
      const logs = await sql<{
        request_id: string;
        method: string;
        path: string;
        status: number;
        duration_ms: number;
        error_code: string | null;
        environment: string;
        created_at: string;
        name: string | null;
      }>`
        select l.request_id, l.method, l.path, l.status, l.duration_ms, l.error_code, l.environment,
               l.created_at::text as created_at, k.name
        from biz_api_logs l
        left join biz_api_keys k on k.id = l.key_id
        where l.business_id = ${businessId}
        order by l.created_at desc
        limit 40
      `;
      return { logs };
    } catch (err) {
      publicError(err, "Couldn't load API logs.");
    }
  });

export { SCOPES };
