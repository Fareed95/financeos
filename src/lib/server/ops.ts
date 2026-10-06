import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import { CHART, buildStatements } from "@/lib/ledger";
import { fromCents, parseMoney, toCents } from "@/lib/money";
import {
  agingBucket,
  assertCanPay,
  billStatus,
  budgetVariance,
  depreciationAmount,
  nextRecurringDate,
  planAssetPurchase,
  planBillPayment,
  planDepreciation,
  planFullOpening,
  planLoanPayment,
  planLoanReceipt,
  planOpenBill,
} from "@/lib/ops";
import { gstOn } from "@/lib/gst";
import { publicError } from "@/lib/utils";
import { audit, loadLines, postJournal, requireBusiness } from "@/lib/server/business";
import { ensureUser } from "@/lib/server/ensure";
import { emitBusinessEvent, retryDueWebhooks, WEBHOOK_EVENTS } from "@/lib/server/webhooks";
import { can, type BizPermission } from "@/lib/biz-access";

const CASH = new Set(["1000", "1010", "1020"]);

async function gate(userId: string, projectId: string, permission: BizPermission) {
  const { sql } = await ensureUser(userId);
  const access = await requireBusiness(sql, userId, projectId, permission);
  return { sql, businessId: access.businessId, role: access.role };
}

function money(value: string) {
  return toCents(parseMoney(value));
}

export async function saveVendorRecord(
  sql: Sql,
  businessId: string,
  actorId: string,
  environment: "live" | "test",
  input: {
    id?: string | null;
    displayName: string;
    legalName?: string | null;
    vendorType?: string;
    email?: string | null;
    phone?: string | null;
    billingAddress?: string | null;
    city?: string | null;
    stateName?: string | null;
    stateCode?: string | null;
    country?: string | null;
    postalCode?: string | null;
    gstin?: string | null;
    pan?: string | null;
    paymentTerms?: string;
    expenseCode?: string | null;
    notes?: string | null;
    status?: string;
  },
) {
  const name = input.displayName.trim();
  if (!name) throw new Error("Enter the vendor name");
  const id = input.id || crypto.randomUUID();
  const existing = await sql<{ id: string }>`
    select id from biz_vendors where id = ${id} and business_id = ${businessId} and environment = ${environment}
  `;
  const fields = {
    legal_name: input.legalName ?? null,
    vendor_type: input.vendorType || "company",
    email: input.email ?? null,
    phone: input.phone ?? null,
    billing_address: input.billingAddress ?? null,
    city: input.city ?? null,
    state_name: input.stateName ?? null,
    state_code: input.stateCode ? input.stateCode.toUpperCase() : null,
    country: input.country || "IN",
    postal_code: input.postalCode ?? null,
    gstin: input.gstin ?? null,
    pan: input.pan ?? null,
    payment_terms: input.paymentTerms || "30",
    expense_code: input.expenseCode ?? null,
    notes: input.notes ?? null,
    status: input.status === "inactive" ? "inactive" : "active",
  };
  if (existing[0]) {
    await sql`
      update biz_vendors set
        display_name = ${name}, legal_name = ${fields.legal_name}, vendor_type = ${fields.vendor_type},
        email = ${fields.email}, phone = ${fields.phone}, billing_address = ${fields.billing_address},
        city = ${fields.city}, state_name = ${fields.state_name}, state_code = ${fields.state_code},
        country = ${fields.country}, postal_code = ${fields.postal_code}, gstin = ${fields.gstin}, pan = ${fields.pan},
        payment_terms = ${fields.payment_terms}, expense_code = ${fields.expense_code}, notes = ${fields.notes},
        status = ${fields.status}
      where id = ${id}
    `;
    await audit(sql, businessId, actorId, "vendor.updated", "vendor", id);
  } else {
    await sql`
      insert into biz_vendors (
        id, business_id, display_name, legal_name, vendor_type, email, phone, billing_address, city, state_name,
        state_code, country, postal_code, gstin, pan, payment_terms, expense_code, notes, status, environment
      ) values (
        ${id}, ${businessId}, ${name}, ${fields.legal_name}, ${fields.vendor_type}, ${fields.email}, ${fields.phone},
        ${fields.billing_address}, ${fields.city}, ${fields.state_name}, ${fields.state_code}, ${fields.country},
        ${fields.postal_code}, ${fields.gstin}, ${fields.pan}, ${fields.payment_terms}, ${fields.expense_code},
        ${fields.notes}, ${fields.status}, ${environment}
      )
    `;
    await audit(sql, businessId, actorId, "vendor.created", "vendor", id);
  }
  return { id };
}

export async function vendorDesk(sql: Sql, businessId: string, environment: "live" | "test") {
  const vendors = await sql<{
    id: string;
    display_name: string;
    vendor_type: string;
    status: string;
    state_code: string | null;
    expense_code: string | null;
    gstin: string | null;
  }>`
    select id, display_name, vendor_type, status, state_code, expense_code, gstin
    from biz_vendors where business_id = ${businessId} and environment = ${environment} order by display_name
  `;
  const bills = await sql<{ vendor_id: string; taxable: string; total: string; amount_paid: string; status: string; bill_date: string }>`
    select vendor_id, taxable::text as taxable, total::text as total, amount_paid::text as amount_paid, status, bill_date::text as bill_date
    from biz_bills where business_id = ${businessId} and environment = ${environment} and status <> 'cancelled' and status <> 'draft'
  `;
  return vendors.map((vendor) => {
    const rows = bills.filter((bill) => bill.vendor_id === vendor.id);
    let spent = 0n;
    let due = 0n;
    let overdue = 0n;
    let last = "";
    for (const bill of rows) {
      spent += toCents(bill.taxable);
      const open = toCents(bill.total) - toCents(bill.amount_paid);
      if (bill.status !== "paid") due += open;
      if (bill.status === "overdue") overdue += open;
      if (bill.bill_date > last) last = bill.bill_date.slice(0, 10);
    }
    return {
      id: vendor.id,
      name: vendor.display_name,
      type: vendor.vendor_type,
      status: vendor.status,
      stateCode: vendor.state_code,
      expenseCode: vendor.expense_code,
      gstin: vendor.gstin,
      spent: fromCents(spent),
      due: fromCents(due),
      overdue: fromCents(overdue),
      lastPayment: last || null,
    };
  });
}

export async function saveBillDraft(
  sql: Sql,
  actorId: string,
  businessId: string,
  environment: "live" | "test",
  input: {
    vendorId: string;
    vendorBillNumber?: string | null;
    reference?: string | null;
    billDate: string;
    dueDate: string;
    placeOfSupply: string | null;
    expenseCode: string;
    description: string;
    quantity: string;
    rate: string;
    gstRate: number;
    notes?: string | null;
    sellerState: string | null;
  },
) {
  const vendor = await sql<{ id: string; state_code: string | null }>`
    select id, state_code from biz_vendors where id = ${input.vendorId} and business_id = ${businessId} and environment = ${environment}
  `;
  if (!vendor[0]) throw new Error("Choose a vendor");
  const taxable = money(input.rate);
  const gst = gstOn(taxable, input.gstRate, input.sellerState, input.placeOfSupply || vendor[0].state_code);
  if (input.gstRate > 0 && gst.treatment === "incomplete") {
    throw new Error("Add the business state and place of supply. GST is not guessed.");
  }
  const id = crypto.randomUUID();
  await sql`
    insert into biz_bills (
      id, business_id, vendor_id, vendor_bill_number, reference, bill_date, due_date, place_of_supply,
      taxable, cgst, sgst, igst, total, status, notes, expense_code, environment
    ) values (
      ${id}, ${businessId}, ${input.vendorId}, ${input.vendorBillNumber ?? null}, ${input.reference ?? null},
      ${input.billDate}::date, ${input.dueDate}::date, ${input.placeOfSupply},
      ${fromCents(gst.taxable)}::numeric, ${fromCents(gst.cgst)}::numeric, ${fromCents(gst.sgst)}::numeric,
      ${fromCents(gst.igst)}::numeric, ${fromCents(gst.total)}::numeric, 'draft', ${input.notes ?? null},
      ${input.expenseCode}, ${environment}
    )
  `;
  await sql`
    insert into biz_bill_lines (
      id, bill_id, position, description, quantity, rate, gst_rate, expense_code, taxable, cgst, sgst, igst, line_total
    ) values (
      ${crypto.randomUUID()}, ${id}, 1, ${input.description || "Purchase"}, ${input.quantity || "1"}::numeric,
      ${fromCents(taxable)}::numeric, ${input.gstRate}, ${input.expenseCode},
      ${fromCents(gst.taxable)}::numeric, ${fromCents(gst.cgst)}::numeric, ${fromCents(gst.sgst)}::numeric,
      ${fromCents(gst.igst)}::numeric, ${fromCents(gst.total)}::numeric
    )
  `;
  await audit(sql, businessId, actorId, "bill.created", "bill", id);
  return { id, total: fromCents(gst.total) };
}

export async function postSavedBill(sql: Sql, actorId: string, businessId: string, environment: "live" | "test", billId: string) {
  const rows = await sql<{
    id: string;
    status: string;
    taxable: string;
    expense_code: string;
    place_of_supply: string | null;
    bill_date: string;
    due_date: string;
  }>`
    select id, status, taxable::text as taxable, expense_code, place_of_supply, bill_date::text as bill_date, due_date::text as due_date
    from biz_bills where id = ${billId} and business_id = ${businessId} and environment = ${environment}
  `;
  const bill = rows[0];
  if (!bill) throw new Error("Bill not found");
  if (bill.status !== "draft") throw new Error("Only a draft can be posted");
  const seller = await sql<{ state_code: string | null }>`select state_code from businesses where id = ${businessId}`;
  const lines = await sql<{ gst_rate: number; taxable: string; expense_code: string }>`
    select gst_rate, taxable::text as taxable, expense_code from biz_bill_lines where bill_id = ${billId}
  `;
  const journalLines = lines.flatMap((line) =>
    planOpenBill({
      expenseCode: line.expense_code,
      taxable: toCents(line.taxable),
      rate: line.gst_rate,
      sellerState: seller[0]?.state_code ?? null,
      placeOfSupply: bill.place_of_supply,
    }).lines.filter((entry) => entry.code !== "2000"),
  );
  const credit = journalLines.reduce((sum, line) => sum + line.debit, 0n);
  journalLines.push({ code: "2000", debit: 0n, credit });
  const journalId = await postJournal(sql, actorId, businessId, {
    date: bill.bill_date.slice(0, 10),
    memo: "Bill posted",
    source: "bill",
    sourceId: bill.id,
    lines: journalLines,
    environment,
  });
  const status = billStatus(credit, 0n, bill.due_date.slice(0, 10), new Date().toISOString().slice(0, 10));
  await sql`update biz_bills set status = ${status}, journal_id = ${journalId}, total = ${fromCents(credit)}::numeric where id = ${bill.id}`;
  await audit(sql, businessId, actorId, "bill.posted", "bill", bill.id);
  await emitBusinessEvent(sql, businessId, environment, "bill.created", { id: bill.id, total: fromCents(credit) });
  return { id: bill.id, total: fromCents(credit), status };
}

export async function paySavedBill(
  sql: Sql,
  actorId: string,
  businessId: string,
  environment: "live" | "test",
  input: { billId: string; amount: string; date: string; method: string; accountCode: string; reference?: string | null; notes?: string | null },
) {
  if (!CASH.has(input.accountCode)) throw new Error("Choose a cash or bank account");
  const rows = await sql<{ id: string; status: string; total: string; amount_paid: string; due_date: string }>`
    select id, status, total::text as total, amount_paid::text as amount_paid, due_date::text as due_date
    from biz_bills where id = ${input.billId} and business_id = ${businessId} and environment = ${environment}
  `;
  const bill = rows[0];
  if (!bill || bill.status === "draft" || bill.status === "cancelled") throw new Error("This bill is not open");
  const open = toCents(bill.total) - toCents(bill.amount_paid);
  const amount = money(input.amount);
  assertCanPay(open, amount);
  const paymentId = crypto.randomUUID();
  const journalId = await postJournal(sql, actorId, businessId, {
    date: input.date,
    memo: "Vendor payment",
    source: "bill_payment",
    sourceId: paymentId,
    lines: planBillPayment(amount, input.accountCode),
    environment,
  });
  const paid = toCents(bill.amount_paid) + amount;
  const status = billStatus(toCents(bill.total), paid, bill.due_date.slice(0, 10), input.date);
  await sql`
    insert into biz_vendor_payments (id, business_id, bill_id, amount, paid_on, method, account_code, reference, notes, journal_id, environment)
    values (
      ${paymentId}, ${businessId}, ${bill.id}, ${fromCents(amount)}::numeric, ${input.date}::date,
      ${input.method}, ${input.accountCode}, ${input.reference ?? null}, ${input.notes ?? null}, ${journalId}, ${environment}
    )
  `;
  await sql`update biz_bills set amount_paid = ${fromCents(paid)}::numeric, status = ${status} where id = ${bill.id}`;
  await audit(sql, businessId, actorId, "bill.payment_recorded", "bill", bill.id);
  if (status === "paid") await emitBusinessEvent(sql, businessId, environment, "bill.paid", { id: bill.id });
  return { status, balance: fromCents(toCents(bill.total) - paid) };
}

export async function moneyDesk(sql: Sql, businessId: string, environment: "live" | "test", today: string) {
  const invoices = await sql<{ number: string; customer_name: string; due_date: string | null; total: string; amount_paid: string; status: string }>`
    select number, customer_name, due_date::text as due_date, total::text as total, amount_paid::text as amount_paid, status
    from biz_invoices
    where business_id = ${businessId} and environment = ${environment} and status not in ('draft', 'void', 'cancelled')
  `;
  const bills = await sql<{ id: string; total: string; amount_paid: string; due_date: string; status: string; display_name: string }>`
    select b.id, b.total::text as total, b.amount_paid::text as amount_paid, b.due_date::text as due_date, b.status, v.display_name
    from biz_bills b join biz_vendors v on v.id = b.vendor_id
    where b.business_id = ${businessId} and b.environment = ${environment} and b.status not in ('draft', 'cancelled')
  `;
  const collect = { current: 0n, "1-30": 0n, "31-60": 0n, "61-90": 0n, "90+": 0n };
  const pay = { ...collect };
  const collectRows = [];
  for (const invoice of invoices) {
    const open = toCents(invoice.total) - toCents(invoice.amount_paid);
    if (open <= 0n) continue;
    const due = invoice.due_date?.slice(0, 10) || today;
    const bucket = agingBucket(due, today);
    collect[bucket] += open;
    collectRows.push({ who: invoice.customer_name, ref: invoice.number, due, open: fromCents(open), bucket });
  }
  const payRows = [];
  for (const bill of bills) {
    const open = toCents(bill.total) - toCents(bill.amount_paid);
    if (open <= 0n) continue;
    const due = bill.due_date.slice(0, 10);
    const bucket = agingBucket(due, today);
    pay[bucket] += open;
    payRows.push({ who: bill.display_name, ref: bill.id, due, open: fromCents(open), bucket });
  }
  const pack = (rows: typeof collect) => Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, fromCents(value)]));
  return { collect: pack(collect), pay: pack(pay), collectRows, payRows };
}

async function sellerState(sql: Sql, businessId: string) {
  const rows = await sql<{ state_code: string | null }>`select state_code from businesses where id = ${businessId}`;
  return rows[0]?.state_code ?? null;
}

export const getOpsDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; today: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId, role } = await gate(context.userId, data.projectId, "view_finance");
      const today = data.today || new Date().toISOString().slice(0, 10);
      return {
        role,
        canVendors: can(role, "manage_vendors"),
        canBills: can(role, "manage_bills"),
        canPay: can(role, "pay_bills"),
        canBudgets: can(role, "manage_budgets"),
        canAssets: can(role, "manage_assets"),
        canLoans: can(role, "manage_loans"),
        vendors: await vendorDesk(sql, businessId, "live"),
        bills: (await sql<{ id: string; vendor: string; status: string; total: string; amount_paid: string; due_date: string; taxable: string; expense_code: string }>`
          select b.id, v.display_name as vendor, b.status, b.total::text as total, b.amount_paid::text as amount_paid,
                 b.due_date::text as due_date, b.taxable::text as taxable, b.expense_code
          from biz_bills b join biz_vendors v on v.id = b.vendor_id
          where b.business_id = ${businessId} and b.environment = 'live' order by b.bill_date desc
        `).map((bill) => ({ ...bill, due_date: bill.due_date.slice(0, 10) })),
        money: await moneyDesk(sql, businessId, "live", today),
        recurring: (await sql<{ id: string; name: string; amount: string; frequency: string; next_date: string; kind: string }>`
          select id, name, amount::text as amount, frequency, next_date::text as next_date, kind
          from biz_recurring where business_id = ${businessId} and environment = 'live' and active = true order by next_date
        `).map((row) => ({ ...row, next_date: row.next_date.slice(0, 10) })),
        budgets: await budgetRows(sql, businessId, today),
        loans: (await sql<{ id: string; lender: string; principal: string; outstanding: string; start_date: string }>`
          select id, lender, principal::text as principal, outstanding::text as outstanding, start_date::text as start_date
          from biz_loans where business_id = ${businessId} and environment = 'live' order by start_date desc
        `).map((row) => ({ ...row, start_date: row.start_date.slice(0, 10) })),
        assets: (await sql<{ id: string; name: string; category: string; cost: string; residual: string; life_months: number; purchased_on: string; status: string }>`
          select id, name, category, cost::text as cost, residual::text as residual, life_months, purchased_on::text as purchased_on, status
          from biz_fixed_assets where business_id = ${businessId} and environment = 'live' order by purchased_on desc
        `).map((row) => ({ ...row, purchased_on: row.purchased_on.slice(0, 10) })),
        expenseAccounts: CHART.filter((account) => account.type === "expense").map((account) => ({ code: account.code, name: account.name })),
        sellerState: await sellerState(sql, businessId),
      };
    } catch (err) {
      publicError(err, "Couldn't load vendors and bills.");
    }
  });

async function budgetRows(sql: Sql, businessId: string, today: string) {
  const budgets = await sql<{ id: string; name: string; kind: string; account_code: string | null; amount: string; period_start: string; period: string }>`
    select id, name, kind, account_code, amount::text as amount, period_start::text as period_start, period
    from biz_budgets where business_id = ${businessId} and environment = 'live'
  `;
  const lines = await loadLines(sql, businessId);
  return budgets.map((budget) => {
    const start = budget.period_start.slice(0, 10);
    const end = budget.period === "year" ? today : today;
    const books = buildStatements(lines.filter((line) => line.date >= start && line.date <= end), start, end);
    const actual = budget.kind === "revenue"
      ? books.totalRevenue
      : budget.account_code
        ? (books.opex.find((row) => row.code === budget.account_code)?.amount ?? books.cogs.find((row) => row.code === budget.account_code)?.amount ?? 0n)
        : books.opex.reduce((sum, row) => sum + row.amount, 0n) + books.cogs.reduce((sum, row) => sum + row.amount, 0n);
    const variance = budgetVariance(toCents(budget.amount), actual);
    return {
      id: budget.id,
      name: budget.name,
      kind: budget.kind,
      budget: budget.amount,
      actual: fromCents(actual),
      remaining: fromCents(variance.remaining),
      over: variance.over,
    };
  });
}

export const saveVendor = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; displayName: string; vendorType?: string; email?: string | null; phone?: string | null; stateCode?: string | null; gstin?: string | null; paymentTerms?: string; expenseCode?: string | null; notes?: string | null; legalName?: string | null; city?: string | null }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_vendors");
      return await saveVendorRecord(sql, businessId, context.userId, "live", data);
    } catch (err) {
      publicError(err, "Couldn't save that vendor.");
    }
  });

export const saveBill = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; vendorId: string; billDate: string; dueDate: string; placeOfSupply: string | null; expenseCode: string; description: string; quantity: string; rate: string; gstRate: number; notes?: string | null; post?: boolean }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_bills");
      const draft = await saveBillDraft(sql, context.userId, businessId, "live", { ...data, sellerState: await sellerState(sql, businessId) });
      if (data.post) return await postSavedBill(sql, context.userId, businessId, "live", draft.id);
      return draft;
    } catch (err) {
      publicError(err, "Couldn't save that bill.");
    }
  });

export const payBill = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; billId: string; amount: string; date: string; method: string; accountCode: string; reference?: string | null }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "pay_bills");
      return await paySavedBill(sql, context.userId, businessId, "live", data);
    } catch (err) {
      publicError(err, "Couldn't record that payment.");
    }
  });

export const saveRecurring = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; name: string; amount: string; expenseCode: string; frequency: "weekly" | "monthly" | "quarterly" | "yearly"; nextDate: string; kind: "bill" | "expense" }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_bills");
      const id = crypto.randomUUID();
      await sql`
        insert into biz_recurring (id, business_id, name, amount, expense_code, frequency, next_date, kind, environment)
        values (${id}, ${businessId}, ${data.name}, ${parseMoney(data.amount)}::numeric, ${data.expenseCode}, ${data.frequency}, ${data.nextDate}::date, ${data.kind}, 'live')
      `;
      return { id, next: data.nextDate };
    } catch (err) {
      publicError(err, "Couldn't save that recurring cost.");
    }
  });

export const createRecurringDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; id: string; vendorId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_bills");
      const rows = await sql<{ name: string; amount: string; expense_code: string; frequency: "monthly"; next_date: string }>`
        select name, amount::text as amount, expense_code, frequency, next_date::text as next_date from biz_recurring
        where id = ${data.id} and business_id = ${businessId} and environment = 'live' and active = true
      `;
      const rule = rows[0];
      if (!rule) throw new Error("Recurring cost not found");
      const draft = await saveBillDraft(sql, context.userId, businessId, "live", {
        vendorId: data.vendorId,
        billDate: rule.next_date.slice(0, 10),
        dueDate: rule.next_date.slice(0, 10),
        placeOfSupply: await sellerState(sql, businessId),
        expenseCode: rule.expense_code,
        description: rule.name,
        quantity: "1",
        rate: rule.amount,
        gstRate: 0,
        sellerState: await sellerState(sql, businessId),
      });
      const next = nextRecurringDate(rule.next_date.slice(0, 10), rule.frequency);
      await sql`update biz_recurring set next_date = ${next}::date where id = ${data.id}`;
      return { ...draft, next, posted: false };
    } catch (err) {
      publicError(err, "Couldn't create that draft.");
    }
  });

export const saveBudget = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; name: string; kind: "expense" | "revenue"; accountCode?: string | null; amount: string; period: string; periodStart: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_budgets");
      const id = crypto.randomUUID();
      await sql`
        insert into biz_budgets (id, business_id, name, period, period_start, account_code, kind, amount, environment)
        values (${id}, ${businessId}, ${data.name}, ${data.period}, ${data.periodStart}::date, ${data.accountCode ?? null}, ${data.kind}, ${parseMoney(data.amount)}::numeric, 'live')
      `;
      await audit(sql, businessId, context.userId, "budget.created", "budget", id);
      return { id };
    } catch (err) {
      publicError(err, "Couldn't save that budget.");
    }
  });

export const receiveLoan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; lender: string; principal: string; date: string; accountCode: string; rate?: string | null; notes?: string | null }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_loans");
      if (!CASH.has(data.accountCode)) throw new Error("Choose a cash or bank account");
      const amount = money(data.principal);
      const id = crypto.randomUUID();
      const journalId = await postJournal(sql, context.userId, businessId, {
        date: data.date,
        memo: `Loan from ${data.lender}`,
        source: "loan_receipt",
        sourceId: id,
        lines: planLoanReceipt(amount, data.accountCode),
      });
      await sql`
        insert into biz_loans (id, business_id, lender, principal, outstanding, start_date, interest_rate, notes, journal_id, environment)
        values (${id}, ${businessId}, ${data.lender}, ${fromCents(amount)}::numeric, ${fromCents(amount)}::numeric, ${data.date}::date, ${data.rate ? Number(data.rate) : null}, ${data.notes ?? null}, ${journalId}, 'live')
      `;
      await audit(sql, businessId, context.userId, "loan.created", "loan", id);
      return { id };
    } catch (err) {
      publicError(err, "Couldn't record that loan.");
    }
  });

export const repayLoan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; loanId: string; date: string; principal: string; interest: string; accountCode: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_loans");
      const rows = await sql<{ id: string; outstanding: string }>`
        select id, outstanding::text as outstanding from biz_loans where id = ${data.loanId} and business_id = ${businessId} and environment = 'live'
      `;
      const loan = rows[0];
      if (!loan) throw new Error("Loan not found");
      const principal = money(data.principal || "0");
      const interest = money(data.interest || "0");
      if (principal > toCents(loan.outstanding)) throw new Error("Principal is more than the outstanding loan");
      const paymentId = crypto.randomUUID();
      const journalId = await postJournal(sql, context.userId, businessId, {
        date: data.date,
        memo: "Loan payment",
        source: "loan_payment",
        sourceId: paymentId,
        lines: planLoanPayment(principal, interest, data.accountCode),
      });
      await sql`
        insert into biz_loan_payments (id, loan_id, business_id, paid_on, principal, interest, account_code, journal_id, environment)
        values (${paymentId}, ${loan.id}, ${businessId}, ${data.date}::date, ${fromCents(principal)}::numeric, ${fromCents(interest)}::numeric, ${data.accountCode}, ${journalId}, 'live')
      `;
      await sql`update biz_loans set outstanding = ${fromCents(toCents(loan.outstanding) - principal)}::numeric where id = ${loan.id}`;
      await audit(sql, businessId, context.userId, "loan.payment_recorded", "loan", loan.id);
      return { outstanding: fromCents(toCents(loan.outstanding) - principal) };
    } catch (err) {
      publicError(err, "Couldn't record that loan payment.");
    }
  });

export const buyAsset = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; name: string; category: string; date: string; cost: string; residual: string; lifeMonths: number; paid: boolean; accountCode: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_assets");
      const cost = money(data.cost);
      const id = crypto.randomUUID();
      const journalId = await postJournal(sql, context.userId, businessId, {
        date: data.date,
        memo: data.name,
        source: "asset_purchase",
        sourceId: id,
        lines: planAssetPurchase(cost, data.paid, data.accountCode),
      });
      await sql`
        insert into biz_fixed_assets (id, business_id, name, category, purchased_on, cost, residual, life_months, status, paid, journal_id, environment)
        values (
          ${id}, ${businessId}, ${data.name}, ${data.category}, ${data.date}::date, ${fromCents(cost)}::numeric,
          ${parseMoney(data.residual || "0")}::numeric, ${data.lifeMonths}, 'active', ${data.paid}, ${journalId}, 'live'
        )
      `;
      await audit(sql, businessId, context.userId, "asset.created", "asset", id);
      return { id };
    } catch (err) {
      publicError(err, "Couldn't record that asset.");
    }
  });

export const postAssetDepreciation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; assetId: string; date: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_assets");
      const rows = await sql<{ id: string; cost: string; residual: string; life_months: number; status: string }>`
        select id, cost::text as cost, residual::text as residual, life_months, status
        from biz_fixed_assets where id = ${data.assetId} and business_id = ${businessId} and environment = 'live'
      `;
      const asset = rows[0];
      if (!asset || asset.status !== "active") throw new Error("Asset not found");
      const posted = await sql<{ n: number }>`select count(*)::int as n from biz_depreciation_entries where asset_id = ${asset.id}`;
      const amount = depreciationAmount(toCents(asset.cost), toCents(asset.residual), asset.life_months, posted[0]?.n ?? 0);
      if (amount <= 0n) throw new Error("This asset is fully depreciated");
      const period = data.date.slice(0, 7);
      const id = crypto.randomUUID();
      const journalId = await postJournal(sql, context.userId, businessId, {
        date: data.date,
        memo: "Depreciation",
        source: "depreciation",
        sourceId: `${asset.id}:${period}`,
        lines: planDepreciation(amount),
      });
      await sql`
        insert into biz_depreciation_entries (id, asset_id, business_id, period, amount, journal_id)
        values (${id}, ${asset.id}, ${businessId}, ${period}, ${fromCents(amount)}::numeric, ${journalId})
      `;
      await audit(sql, businessId, context.userId, "depreciation.posted", "asset", asset.id);
      return { amount: fromCents(amount), period };
    } catch (err) {
      publicError(err, "Couldn't post depreciation.");
    }
  });

export const postFullOpening = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; date: string; cash: string; bank: string; receivable: string; payable: string; loan: string; assets: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "create_records");
      const existing = await sql<{ id: string }>`
        select id from journal_entries
        where business_id = ${businessId} and source in ('capital', 'opening', 'opening_full') and status = 'posted' limit 1
      `;
      if (existing[0]) throw new Error("Opening balances are already posted. They are not replaced.");
      const planned = planFullOpening({
        cash: money(data.cash || "0"),
        bank: money(data.bank || "0"),
        receivable: money(data.receivable || "0"),
        payable: money(data.payable || "0"),
        loan: money(data.loan || "0"),
        assets: money(data.assets || "0"),
      });
      const journalId = await postJournal(sql, context.userId, businessId, {
        date: data.date,
        memo: "Opening balances",
        source: "opening_full",
        sourceId: businessId,
        lines: planned.lines,
      });
      await audit(sql, businessId, context.userId, "opening_balances.posted", "journal", journalId);
      return { equity: fromCents(planned.plug), journalId };
    } catch (err) {
      publicError(err, "Couldn't post opening balances.");
    }
  });

export const saveWebhookEndpoint = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; url: string; events: string[] }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_api_keys");
      if (!data.url.startsWith("https://")) throw new Error("The endpoint must be https");
      const events = data.events.filter((event) => (WEBHOOK_EVENTS as readonly string[]).includes(event));
      if (events.length === 0) throw new Error("Choose at least one event");
      const id = crypto.randomUUID();
      const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
      await sql`
        insert into biz_webhook_endpoints (id, business_id, url, secret, events, environment)
        values (${id}, ${businessId}, ${data.url}, ${secret}, ${events.join(",")}, 'live')
      `;
      await audit(sql, businessId, context.userId, "webhook.created", "webhook", id);
      return { id, secret };
    } catch (err) {
      publicError(err, "Couldn't save that endpoint.");
    }
  });

export const webhookDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_api_keys");
      await retryDueWebhooks(sql, businessId);
      const endpoints = await sql<{ id: string; url: string; events: string; status: string }>`
        select id, url, events, status from biz_webhook_endpoints where business_id = ${businessId} and environment = 'live' order by created_at desc
      `;
      const deliveries = await sql<{ id: string; event: string; status: string; attempts: number; http_status: number | null }>`
        select id, event, status, attempts, http_status
        from biz_webhook_deliveries where business_id = ${businessId} order by created_at desc limit 20
      `;
      return { endpoints, deliveries, events: WEBHOOK_EVENTS };
    } catch (err) {
      publicError(err, "Couldn't load endpoints.");
    }
  });

export const disableWebhook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_api_keys");
      await sql`update biz_webhook_endpoints set status = 'disabled' where id = ${data.id} and business_id = ${businessId}`;
      await audit(sql, businessId, context.userId, "webhook.disabled", "webhook", data.id);
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't disable that endpoint.");
    }
  });

export const rotateWebhookSecret = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await gate(context.userId, data.projectId, "manage_api_keys");
      const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
      const rows = await sql<{ id: string }>`
        update biz_webhook_endpoints set secret = ${secret} where id = ${data.id} and business_id = ${businessId} returning id
      `;
      if (!rows[0]) throw new Error("Endpoint not found");
      await audit(sql, businessId, context.userId, "webhook.secret_rotated", "webhook", data.id);
      return { secret };
    } catch (err) {
      publicError(err, "Couldn't rotate that secret.");
    }
  });
