import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import { ownership, type Holder } from "@/lib/cap-table";
import {
  CHART,
  assertBalanced,
  buildStatements,
  type DraftLine,
  type PostedLine,
} from "@/lib/ledger";
import { fromCents, parseMoney, toCents } from "@/lib/money";
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

async function audit(sql: Sql, businessId: string, actorId: string, action: string, entity: string, entityId: string) {
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
    if (dup[0]) return dup[0].id;
  }
  const entryId = crypto.randomUUID();
  await sql`
    insert into journal_entries (id, business_id, entry_date, memo, source, source_id, status, created_by, environment)
    values (
      ${entryId}, ${businessId}, ${input.date}::date, ${input.memo}, ${input.source}, ${input.sourceId},
      'draft', ${actorId}, ${environment}
    )
  `;
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
  await sql`update journal_entries set status = 'posted' where id = ${entryId}`;
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

export async function recordCapital(sql: Sql, actorId: string, businessId: string, input: { amount: string; date: string }) {
  const amount = toCents(parseMoney(input.amount));
  if (amount <= 0n) throw new Error("Amount must be greater than zero");
  const id = crypto.randomUUID();
  await postJournal(sql, actorId, businessId, {
    date: input.date,
    memo: "Owner capital",
    source: "capital",
    sourceId: id,
    lines: [moneyLine("1010", amount, 0n), moneyLine("3000", 0n, amount)],
  });
  await audit(sql, businessId, actorId, "capital.posted", "journal", id);
  return { id };
}

export async function issueShares(
  sql: Sql,
  actorId: string,
  businessId: string,
  input: { holder: string; shares: number; amount?: string | null; date: string },
) {
  const holder = input.holder.trim();
  if (!holder) throw new Error("Shareholder name is required");
  if (!Number.isInteger(input.shares) || input.shares <= 0) throw new Error("Shares must be a whole number");
  const id = crypto.randomUUID();
  const amount = input.amount?.trim() ? toCents(parseMoney(input.amount)) : 0n;
  await sql`
    insert into biz_equity_events (id, business_id, kind, holder, shares, amount, event_date)
    values (${id}, ${businessId}, 'issuance', ${holder}, ${input.shares}, ${amount ? fromCents(amount) : null}, ${input.date}::date)
  `;
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

async function holdersOf(sql: Sql, businessId: string): Promise<Holder[]> {
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

async function loadLines(sql: Sql, businessId: string): Promise<PostedLine[]> {
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
  .validator((data: { projectId: string; today: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const businessId = await ensureBusiness(sql, context.userId, data.projectId);
      const range = fiscalRange(data.today || new Date().toISOString().slice(0, 10));
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
      }>`
        select id, number, customer_name, issue_date::text as issue_date, due_date::text as due_date,
               total::text as total, amount_paid::text as amount_paid, status
        from biz_invoices where business_id = ${businessId} order by issue_date desc, number desc
      `;
      const expenses = await sql<{ id: string; account_code: string; amount: string; memo: string | null; paid: boolean; spent_on: string }>`
        select id, account_code, amount::text as amount, memo, paid, spent_on::text as spent_on
        from biz_expenses where business_id = ${businessId} order by spent_on desc
      `;
      const keys = await sql<{ id: string; name: string; prefix: string; environment: string; scopes: string; revoked_at: string | null }>`
        select id, name, prefix, environment, scopes, revoked_at::text as revoked_at
        from biz_api_keys where business_id = ${businessId} order by created_at desc
      `;
      const holders = ownership(await holdersOf(sql, businessId));
      return {
        businessId,
        range,
        statements: present(buildStatements(lines, range.from, range.to)),
        expenseAccounts: CHART.filter((account) => account.type === "expense").map((account) => ({
          code: account.code,
          name: account.name,
        })),
        invoices: invoices.map((row) => ({
          ...row,
          issueDate: row.issue_date.slice(0, 10),
          dueDate: row.due_date?.slice(0, 10) ?? null,
        })),
        expenses: expenses.map((row) => ({ ...row, spentOn: row.spent_on.slice(0, 10) })),
        holders: holders.map((row) => ({ name: row.name, shares: row.shares.toString(), bps: row.bps.toString() })),
        keys: keys.map((row) => ({ ...row, revoked: Boolean(row.revoked_at) })),
      };
    } catch (err) {
      publicError(err, "Couldn't load this business.");
    }
  });

async function withBusiness(userId: string, projectId: string) {
  const { sql } = await ensureUser(userId);
  const businessId = await ensureBusiness(sql, userId, projectId);
  return { sql, businessId };
}

export const postBusinessCapital = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; amount: string; date: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId);
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
      const { sql, businessId } = await withBusiness(context.userId, data.projectId);
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
      const { sql, businessId } = await withBusiness(context.userId, data.projectId);
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
      const { sql, businessId } = await withBusiness(context.userId, data.projectId);
      return await recordExpense(sql, context.userId, businessId, data);
    } catch (err) {
      publicError(err, "Couldn't record that expense.");
    }
  });

export const postBusinessShares = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; holder: string; shares: number; amount?: string | null; date: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withBusiness(context.userId, data.projectId);
      return await issueShares(sql, context.userId, businessId, data);
    } catch (err) {
      publicError(err, "Couldn't issue those shares.");
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
      const { sql, businessId } = await withBusiness(context.userId, data.projectId);
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
      const { sql, businessId } = await withBusiness(context.userId, data.projectId);
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
      const { sql, businessId } = await withBusiness(context.userId, data.projectId);
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
      const { sql, businessId } = await withBusiness(context.userId, data.projectId);
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
