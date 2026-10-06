import { API_ROUTES, type ApiRoute } from "@/lib/api-routes";
import { CHART, buildStatements, type DraftLine } from "@/lib/ledger";
import { fromCents, parseMoney, toCents } from "@/lib/money";
import type { Sql } from "@/lib/db";
import { postJournal, recordExpense } from "@/lib/server/business";
import { paySavedBill, postSavedBill, saveBillDraft, saveVendorRecord } from "@/lib/server/ops";
import {
  createCreditNote,
  invoiceDetail,
  invoicePdfBase64,
  issueDraft,
  listInvoicePayments,
  recordInvoicePayment,
  saveCustomer,
  saveDraftInvoice,
  type Books,
} from "@/lib/server/invoices";

export type ApiCtx = {
  sql: Sql;
  businessId: string;
  environment: Books;
  params: Record<string, string>;
  body: Record<string, unknown>;
  today: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function invalid(message: string) {
  const error = new Error(message) as Error & { status: number; code: string };
  error.status = 422;
  error.code = "validation_error";
  throw error;
}

function paise(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) invalid(`${label} must be integer paise`);
  return BigInt(value as number);
}

function itemsOf(body: Record<string, unknown>) {
  if (!Array.isArray(body.items) || body.items.length === 0) invalid("items are required");
  return (body.items as Record<string, unknown>[]).map((item) => ({
    description: String(item.description || ""),
    hsnSac: item.hsn_sac ? String(item.hsn_sac) : null,
    quantity: String(item.quantity ?? "1"),
    unit: item.unit ? String(item.unit) : null,
    rate: paise(item.unit_price, "unit_price"),
    discount: item.discount_paise == null ? 0n : paise(item.discount_paise, "discount_paise"),
    gstRate: Number(item.gst_rate ?? 0),
    revenueCode: item.revenue_code === "4000" ? "4000" : "4100",
  }));
}

async function yearBooks(ctx: ApiCtx) {
  const [yearText, monthText] = ctx.today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const startYear = month >= 4 ? year : year - 1;
  const rows = await ctx.sql<{ entry_id: string; date: string; code: string; debit: string; credit: string }>`
    select e.id as entry_id, e.entry_date::text as date, a.code, l.debit::text as debit, l.credit::text as credit
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join ledger_accounts a on a.id = l.account_id
    where e.business_id = ${ctx.businessId} and e.status = 'posted' and e.environment = ${ctx.environment}
  `;
  return buildStatements(
    rows.map((row) => ({
      entryId: row.entry_id,
      date: row.date.slice(0, 10),
      code: row.code,
      debit: toCents(row.debit),
      credit: toCents(row.credit),
    })),
    `${startYear}-04-01`,
    `${startYear + 1}-03-31`,
  );
}

const handlers: Record<string, (ctx: ApiCtx) => Promise<Response>> = {
  async business(ctx) {
    const rows = await ctx.sql<{ id: string; legal_name: string }>`select id, legal_name from businesses where id = ${ctx.businessId}`;
    return json({ id: rows[0]?.id, legalName: rows[0]?.legal_name, environment: ctx.environment });
  },
  async accounts() {
    return json({ accounts: CHART.map((account) => ({ code: account.code, name: account.name, type: account.type })) });
  },
  async listCustomers(ctx) {
    const customers = await ctx.sql`
      select id, name, company, email, phone, gstin, state_code as "stateCode"
      from biz_customers where business_id = ${ctx.businessId} and environment = ${ctx.environment}
      order by name
    `;
    return json({ customers });
  },
  async createCustomer(ctx) {
    const saved = await saveCustomer(ctx.sql, ctx.businessId, ctx.environment, {
      name: String(ctx.body.name || ""),
      company: ctx.body.company ? String(ctx.body.company) : null,
      email: ctx.body.email ? String(ctx.body.email) : null,
      phone: ctx.body.phone ? String(ctx.body.phone) : null,
      gstin: ctx.body.gstin ? String(ctx.body.gstin) : null,
      stateCode: ctx.body.state_code ? String(ctx.body.state_code) : null,
      billingAddress: ctx.body.billing_address ? String(ctx.body.billing_address) : null,
    });
    return json(saved, 201);
  },
  async updateCustomer(ctx) {
    const saved = await saveCustomer(ctx.sql, ctx.businessId, ctx.environment, {
      id: ctx.params.id,
      name: String(ctx.body.name || ""),
      company: ctx.body.company ? String(ctx.body.company) : null,
      email: ctx.body.email ? String(ctx.body.email) : null,
      gstin: ctx.body.gstin ? String(ctx.body.gstin) : null,
      stateCode: ctx.body.state_code ? String(ctx.body.state_code) : null,
    });
    return json(saved);
  },
  async listInvoices(ctx) {
    const rows = await ctx.sql<{ id: string }>`
      select id from biz_invoices where business_id = ${ctx.businessId} and environment = ${ctx.environment}
      order by issue_date desc
    `;
    const invoices = [];
    for (const row of rows) invoices.push(await invoiceDetail(ctx.sql, ctx.businessId, row.id, ctx.environment, ctx.today));
    return json({ invoices });
  },
  async createInvoice(ctx) {
    const saved = await saveDraftInvoice(ctx.sql, "api", ctx.businessId, ctx.environment, {
      customerId: String(ctx.body.customer_id || ""),
      issueDate: String(ctx.body.issue_date || ctx.today),
      dueDate: ctx.body.due_date ? String(ctx.body.due_date) : null,
      placeOfSupply: ctx.body.place_of_supply ? String(ctx.body.place_of_supply) : null,
      reference: ctx.body.reference ? String(ctx.body.reference) : null,
      items: itemsOf(ctx.body),
    });
    return json(saved, 201);
  },
  async getInvoice(ctx) {
    return json(await invoiceDetail(ctx.sql, ctx.businessId, ctx.params.id || "", ctx.environment, ctx.today));
  },
  async updateInvoice(ctx) {
    const saved = await saveDraftInvoice(ctx.sql, "api", ctx.businessId, ctx.environment, {
      id: ctx.params.id,
      customerId: String(ctx.body.customer_id || ""),
      issueDate: String(ctx.body.issue_date || ctx.today),
      dueDate: ctx.body.due_date ? String(ctx.body.due_date) : null,
      placeOfSupply: ctx.body.place_of_supply ? String(ctx.body.place_of_supply) : null,
      items: itemsOf(ctx.body),
    });
    return json(saved);
  },
  async issueInvoice(ctx) {
    return json(await issueDraft(ctx.sql, "api", ctx.businessId, ctx.environment, ctx.params.id || ""));
  },
  async listPayments(ctx) {
    const payments = await listInvoicePayments(ctx.sql, ctx.businessId, ctx.params.id || "", ctx.environment);
    return json({ payments });
  },
  async payInvoice(ctx) {
    const saved = await recordInvoicePayment(ctx.sql, "api", ctx.businessId, ctx.environment, {
      invoiceId: ctx.params.id || String(ctx.body.invoice_id || ""),
      amount: String(ctx.body.amount || ""),
      date: String(ctx.body.date || ctx.today),
      method: String(ctx.body.method || "bank"),
      accountCode: String(ctx.body.account_code || "1010"),
      reference: ctx.body.reference ? String(ctx.body.reference) : null,
    });
    return json(saved, 201);
  },
  async invoicePdf(ctx) {
    const base64 = await invoicePdfBase64(ctx.sql, ctx.businessId, ctx.params.id || "", ctx.environment);
    const bytes = Buffer.from(base64, "base64");
    return new Response(bytes, { status: 200, headers: { "content-type": "application/pdf" } });
  },
  async creditInvoice(ctx) {
    const saved = await createCreditNote(ctx.sql, "api", ctx.businessId, ctx.environment, {
      invoiceId: ctx.params.id || "",
      amount: String(ctx.body.amount || ""),
      date: String(ctx.body.date || ctx.today),
      reason: ctx.body.reason ? String(ctx.body.reason) : null,
    });
    return json(saved, 201);
  },
  async payAlias(ctx) {
    return handlers.payInvoice!({ ...ctx, params: { id: String(ctx.body.invoice_id || "") } });
  },
  async listExpenses(ctx) {
    const expenses = await ctx.sql`
      select id, account_code, amount::text as amount, memo, paid, spent_on::text as spent_on
      from biz_expenses where business_id = ${ctx.businessId} and environment = ${ctx.environment}
      order by spent_on desc
    `;
    return json({ expenses });
  },
  async createExpense(ctx) {
    const saved = await recordExpense(ctx.sql, "api", ctx.businessId, {
      code: String(ctx.body.code || ""),
      amount: String(ctx.body.amount || ""),
      date: String(ctx.body.date || ctx.today),
      memo: ctx.body.memo ? String(ctx.body.memo) : null,
      paid: ctx.body.paid !== false,
      environment: ctx.environment,
    });
    return json(saved, 201);
  },
  async createJournal(ctx) {
    const lines = Array.isArray(ctx.body.lines) ? (ctx.body.lines as { code?: string; debit?: string; credit?: string }[]) : [];
    const draft: DraftLine[] = lines.map((line) => ({
      code: String(line.code || ""),
      debit: line.debit ? toCents(parseMoney(String(line.debit))) : 0n,
      credit: line.credit ? toCents(parseMoney(String(line.credit))) : 0n,
    }));
    const id = await postJournal(ctx.sql, "api", ctx.businessId, {
      date: String(ctx.body.date || ctx.today),
      memo: ctx.body.memo ? String(ctx.body.memo) : "API journal",
      source: "api",
      sourceId: null,
      lines: draft,
      environment: ctx.environment,
    });
    return json({ id }, 201);
  },
  async pnl(ctx) {
    const [yearText, monthText] = ctx.today.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const startYear = month >= 4 ? year : year - 1;
    const rows = await ctx.sql<{ entry_id: string; date: string; code: string; debit: string; credit: string }>`
      select e.id as entry_id, e.entry_date::text as date, a.code, l.debit::text as debit, l.credit::text as credit
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join ledger_accounts a on a.id = l.account_id
      where e.business_id = ${ctx.businessId} and e.status = 'posted' and e.environment = ${ctx.environment}
    `;
    const books = buildStatements(
      rows.map((row) => ({
        entryId: row.entry_id,
        date: row.date.slice(0, 10),
        code: row.code,
        debit: toCents(row.debit),
        credit: toCents(row.credit),
      })),
      `${startYear}-04-01`,
      `${startYear + 1}-03-31`,
    );
    return json({
      ok: books.ok,
      error: books.error,
      revenue: fromCents(books.totalRevenue),
      netProfit: fromCents(books.netProfit),
      cash: fromCents(books.closingCash),
    });
  },
  async listVendors(ctx) {
    const vendors = await ctx.sql`
      select id, display_name as name, vendor_type as type, status, state_code as "stateCode"
      from biz_vendors where business_id = ${ctx.businessId} and environment = ${ctx.environment} order by display_name
    `;
    return json({ vendors });
  },
  async createVendor(ctx) {
    const saved = await saveVendorRecord(ctx.sql, ctx.businessId, "api", ctx.environment, {
      displayName: String(ctx.body.display_name || ""),
      vendorType: ctx.body.vendor_type ? String(ctx.body.vendor_type) : "company",
      stateCode: ctx.body.state_code ? String(ctx.body.state_code) : null,
      gstin: ctx.body.gstin ? String(ctx.body.gstin) : null,
      email: ctx.body.email ? String(ctx.body.email) : null,
    });
    return json(saved, 201);
  },
  async updateVendor(ctx) {
    const saved = await saveVendorRecord(ctx.sql, ctx.businessId, "api", ctx.environment, {
      id: ctx.params.id,
      displayName: String(ctx.body.display_name || ""),
      status: ctx.body.status ? String(ctx.body.status) : "active",
    });
    return json(saved);
  },
  async listBills(ctx) {
    const bills = await ctx.sql`
      select id, status, total::text as total, amount_paid::text as amount_paid, vendor_id
      from biz_bills where business_id = ${ctx.businessId} and environment = ${ctx.environment} order by bill_date desc
    `;
    return json({
      bills: (bills as { id: string; status: string; total: string; amount_paid: string; vendor_id: string }[]).map((bill) => ({
        ...bill,
        balance: fromCents(toCents(bill.total) - toCents(bill.amount_paid)),
      })),
    });
  },
  async createBill(ctx) {
    const seller = await ctx.sql<{ state_code: string | null }>`select state_code from businesses where id = ${ctx.businessId}`;
    const draft = await saveBillDraft(ctx.sql, "api", ctx.businessId, ctx.environment, {
      vendorId: String(ctx.body.vendor_id || ""),
      billDate: String(ctx.body.bill_date || ctx.today),
      dueDate: String(ctx.body.due_date || ctx.today),
      placeOfSupply: ctx.body.place_of_supply ? String(ctx.body.place_of_supply) : null,
      expenseCode: String(ctx.body.expense_code || "5400"),
      description: String(ctx.body.description || "Purchase"),
      quantity: "1",
      rate: String(ctx.body.rate || "0"),
      gstRate: Number(ctx.body.gst_rate ?? 0),
      sellerState: seller[0]?.state_code ?? null,
    });
    if (ctx.body.post === true) return json(await postSavedBill(ctx.sql, "api", ctx.businessId, ctx.environment, draft.id), 201);
    return json(draft, 201);
  },
  async postBill(ctx) {
    return json(await postSavedBill(ctx.sql, "api", ctx.businessId, ctx.environment, ctx.params.id ?? ""));
  },
  async payBill(ctx) {
    return json(await paySavedBill(ctx.sql, "api", ctx.businessId, ctx.environment, {
      billId: ctx.params.id ?? "",
      amount: String(ctx.body.amount || ""),
      date: String(ctx.body.date || ctx.today),
      method: String(ctx.body.method || "bank"),
      accountCode: String(ctx.body.account_code || "1010"),
      reference: ctx.body.reference ? String(ctx.body.reference) : null,
    }));
  },
  async payablesReport(ctx) {
    const rows = await ctx.sql`
      select v.display_name as who, b.total::text as total, b.amount_paid::text as amount_paid, b.due_date::text as due
      from biz_bills b join biz_vendors v on v.id = b.vendor_id
      where b.business_id = ${ctx.businessId} and b.environment = ${ctx.environment} and b.status not in ('draft', 'cancelled', 'paid')
    `;
    return json({
      rows: (rows as { who: string; total: string; amount_paid: string; due: string }[]).map((row) => ({
        who: row.who,
        due: row.due.slice(0, 10),
        open: fromCents(toCents(row.total) - toCents(row.amount_paid)),
      })),
    });
  },
  async balanceSheet(ctx) {
    const books = await yearBooks(ctx);
    return json({
      ok: books.ok,
      error: books.error,
      assets: fromCents(books.totalAssets),
      liabilities: fromCents(books.totalLiabilities),
      equity: fromCents(books.totalEquity),
    });
  },
  async cashFlow(ctx) {
    const books = await yearBooks(ctx);
    return json({
      operating: fromCents(books.operating),
      investing: fromCents(books.investing),
      financing: fromCents(books.financing),
      policy: "A journal that includes a loan or equity account is financing. Asset accounts are investing. Interest still hits profit and loss.",
    });
  },
  async listBudgets(ctx) {
    const budgets = await ctx.sql`
      select id, name, kind, amount::text as amount, period, period_start::text as period_start
      from biz_budgets where business_id = ${ctx.businessId} and environment = ${ctx.environment}
    `;
    return json({ budgets });
  },
  async createBudget(ctx) {
    const id = crypto.randomUUID();
    await ctx.sql`
      insert into biz_budgets (id, business_id, name, period, period_start, account_code, kind, amount, environment)
      values (
        ${id}, ${ctx.businessId}, ${String(ctx.body.name || "Budget")}, ${String(ctx.body.period || "month")},
        ${String(ctx.body.period_start || ctx.today)}::date, ${ctx.body.account_code ? String(ctx.body.account_code) : null},
        ${String(ctx.body.kind || "expense")}, ${parseMoney(String(ctx.body.amount || "0"))}::numeric, ${ctx.environment}
      )
    `;
    return json({ id }, 201);
  },
  async listAssets(ctx) {
    const assets = await ctx.sql`
      select id, name, category, cost::text as cost, status from biz_fixed_assets
      where business_id = ${ctx.businessId} and environment = ${ctx.environment}
    `;
    return json({ assets });
  },
  async listLoans(ctx) {
    const loans = await ctx.sql`
      select id, lender, outstanding::text as outstanding from biz_loans
      where business_id = ${ctx.businessId} and environment = ${ctx.environment}
    `;
    return json({ loans });
  },
};

const routeIds = new Set(API_ROUTES.map((route) => route.id));
for (const id of routeIds) {
  if (!handlers[id]) throw new Error(`Missing API handler ${id}`);
}

export async function dispatchApi(route: ApiRoute, ctx: ApiCtx) {
  const handler = handlers[route.id];
  if (!handler) return json({ error: { code: "not_found", message: "That endpoint does not exist." } }, 404);
  return handler(ctx);
}
