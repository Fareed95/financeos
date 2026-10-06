import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import {
  agingBucket,
  computeLines,
  displayStatus,
  financialYearLabel,
  formatInvoiceNumber,
  planCreditJournal,
  planIssueJournal,
  planPaymentJournal,
} from "@/lib/gst";
import { assertBalanced } from "@/lib/ledger";
import { fromCents, parseMoney, toCents } from "@/lib/money";
import { ensureUser } from "@/lib/server/ensure";
import { postJournal, requireBusiness } from "@/lib/server/business";
import { emitBusinessEvent } from "@/lib/server/webhooks";
import type { BizPermission } from "@/lib/biz-access";
import { publicError } from "@/lib/utils";

export type Books = "live" | "test";

const METHODS = ["upi", "bank", "cash", "card", "cheque", "other"] as const;

async function sellerRow(sql: Sql, businessId: string) {
  const rows = await sql<{
    legal_name: string;
    display_name: string | null;
    state_code: string | null;
    invoice_prefix: string;
    default_due_days: number;
    gstin: string | null;
    pan: string | null;
    email: string | null;
    phone: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state_name: string | null;
    postal_code: string | null;
    country: string;
    invoice_terms: string | null;
    default_notes: string | null;
    bank_holder: string | null;
    bank_name: string | null;
    bank_account_masked: string | null;
    bank_ifsc: string | null;
    upi_id: string | null;
    logo_data: string | null;
    currency: string;
  }>`
    select legal_name, display_name, state_code, invoice_prefix, default_due_days, gstin, pan, email, phone,
           address_line1, address_line2, city, state_name, postal_code, country, invoice_terms, default_notes,
           bank_holder, bank_name, bank_account_masked, bank_ifsc, upi_id, logo_data, currency
    from businesses where id = ${businessId}
  `;
  const row = rows[0];
  if (!row) throw new Error("Business not found");
  return row;
}

async function allocateNumber(sql: Sql, businessId: string, date: string, kind: "INV" | "CN") {
  const seller = await sellerRow(sql, businessId);
  const series = `${kind}-${financialYearLabel(date)}`;
  const rows = await sql<{ last_n: number }>`
    insert into biz_invoice_counters (business_id, series, last_n)
    values (${businessId}, ${series}, 1)
    on conflict (business_id, series) do update set last_n = biz_invoice_counters.last_n + 1
    returning last_n
  `;
  const n = Number(rows[0]?.last_n ?? 1);
  const prefix = kind === "CN" ? "CN" : seller.invoice_prefix || "INV";
  return formatInvoiceNumber(prefix, financialYearLabel(date), n);
}

function openOf(total: bigint, paid: bigint, credited: bigint) {
  return total - paid - credited;
}

async function audit(sql: Sql, businessId: string, actorId: string, action: string, entityId: string) {
  await sql`
    insert into biz_audit (id, business_id, actor_id, action, entity, entity_id)
    values (${crypto.randomUUID()}, ${businessId}, ${actorId}, ${action}, 'invoice', ${entityId})
  `;
}

export async function saveCustomer(
  sql: Sql,
  businessId: string,
  environment: Books,
  input: {
    id?: string | null;
    name: string;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    billingAddress?: string | null;
    shippingAddress?: string | null;
    gstin?: string | null;
    pan?: string | null;
    stateCode?: string | null;
    notes?: string | null;
  },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Customer name is required");
  const stateCode = input.stateCode?.trim().toUpperCase() || null;
  if (input.id) {
    const rows = await sql<{ id: string }>`
      update biz_customers set
        name = ${name},
        company = ${input.company ?? null},
        email = ${input.email ?? null},
        phone = ${input.phone ?? null},
        billing_address = ${input.billingAddress ?? null},
        shipping_address = ${input.shippingAddress ?? null},
        gstin = ${input.gstin ?? null},
        pan = ${input.pan ?? null},
        state_code = ${stateCode},
        notes = ${input.notes ?? null}
      where id = ${input.id} and business_id = ${businessId} and environment = ${environment}
      returning id
    `;
    if (!rows[0]) throw new Error("Customer not found");
    return { id: rows[0].id };
  }
  const id = crypto.randomUUID();
  await sql`
    insert into biz_customers (
      id, business_id, name, company, email, phone, billing_address, shipping_address, gstin, pan, state_code, notes, environment
    ) values (
      ${id}, ${businessId}, ${name}, ${input.company ?? null}, ${input.email ?? null}, ${input.phone ?? null},
      ${input.billingAddress ?? null}, ${input.shippingAddress ?? null}, ${input.gstin ?? null}, ${input.pan ?? null},
      ${stateCode}, ${input.notes ?? null}, ${environment}
    )
  `;
  return { id };
}

type ItemInput = {
  description: string;
  hsnSac?: string | null;
  quantity: string;
  unit?: string | null;
  rate: bigint;
  discount?: bigint;
  gstRate: number;
  revenueCode?: string;
};

export async function saveDraftInvoice(
  sql: Sql,
  actorId: string,
  businessId: string,
  environment: Books,
  input: {
    id?: string | null;
    customerId: string;
    issueDate: string;
    dueDate?: string | null;
    placeOfSupply?: string | null;
    reference?: string | null;
    notes?: string | null;
    terms?: string | null;
    items: ItemInput[];
  },
) {
  const seller = await sellerRow(sql, businessId);
  const customers = await sql<{ id: string; name: string }>`
    select id, name from biz_customers where id = ${input.customerId} and business_id = ${businessId} and environment = ${environment}
  `;
  const customer = customers[0];
  if (!customer) throw new Error("Choose a customer from this business");
  const computed = computeLines(input.items, seller.state_code, input.placeOfSupply ?? null);
  const id = input.id ?? crypto.randomUUID();
  if (input.id) {
    const existing = await sql<{ status: string }>`
      select status from biz_invoices where id = ${id} and business_id = ${businessId} and environment = ${environment}
    `;
    if (!existing[0]) throw new Error("Invoice not found");
    if (existing[0].status !== "draft") throw new Error("Issued invoices can't be edited. Use a credit note.");
    await sql`delete from biz_invoice_lines where invoice_id = ${id}`;
    await sql`
      update biz_invoices set
        customer_id = ${customer.id},
        customer_name = ${customer.name},
        issue_date = ${input.issueDate}::date,
        due_date = ${input.dueDate || null},
        place_of_supply = ${input.placeOfSupply?.toUpperCase() || null},
        reference = ${input.reference ?? null},
        notes = ${input.notes ?? null},
        terms = ${input.terms ?? null},
        subtotal = ${fromCents(computed.taxable)}::numeric,
        discount = 0,
        tax = ${fromCents(computed.cgst + computed.sgst + computed.igst)}::numeric,
        total = ${fromCents(computed.total)}::numeric,
        taxable_total = ${fromCents(computed.taxable)}::numeric,
        cgst_total = ${fromCents(computed.cgst)}::numeric,
        sgst_total = ${fromCents(computed.sgst)}::numeric,
        igst_total = ${fromCents(computed.igst)}::numeric
      where id = ${id}
    `;
  } else {
    await sql`
      insert into biz_invoices (
        id, business_id, customer_id, number, customer_name, issue_date, due_date, place_of_supply, reference, notes, terms,
        subtotal, discount, tax, total, amount_paid, status, taxable_total, cgst_total, sgst_total, igst_total, environment, currency
      ) values (
        ${id}, ${businessId}, ${customer.id}, ${`DRAFT-${id.slice(0, 8)}`}, ${customer.name},
        ${input.issueDate}::date, ${input.dueDate || null}, ${input.placeOfSupply?.toUpperCase() || null},
        ${input.reference ?? null}, ${input.notes ?? null}, ${input.terms ?? null},
        ${fromCents(computed.taxable)}::numeric, 0, ${fromCents(computed.cgst + computed.sgst + computed.igst)}::numeric,
        ${fromCents(computed.total)}::numeric, 0, 'draft',
        ${fromCents(computed.taxable)}::numeric, ${fromCents(computed.cgst)}::numeric, ${fromCents(computed.sgst)}::numeric,
        ${fromCents(computed.igst)}::numeric, ${environment}, ${seller.currency}
      )
    `;
    await audit(sql, businessId, actorId, "invoice.draft_created", id);
  }
  for (const [index, line] of computed.lines.entries()) {
    await sql`
      insert into biz_invoice_lines (
        id, invoice_id, position, description, hsn_sac, quantity, unit, rate, discount, gst_rate, revenue_code,
        taxable, cgst, sgst, igst, line_total
      ) values (
        ${crypto.randomUUID()}, ${id}, ${index}, ${line.description}, ${line.hsnSac}, ${line.quantity}::numeric, ${line.unit},
        ${fromCents(line.rate)}::numeric, ${fromCents(line.discount)}::numeric, ${line.gstRate}, ${line.revenueCode},
        ${fromCents(line.taxable)}::numeric, ${fromCents(line.cgst)}::numeric, ${fromCents(line.sgst)}::numeric,
        ${fromCents(line.igst)}::numeric, ${fromCents(line.total)}::numeric
      )
    `;
  }
  return { id, treatment: computed.treatment, total: fromCents(computed.total), cgst: fromCents(computed.cgst), sgst: fromCents(computed.sgst), igst: fromCents(computed.igst) };
}

async function loadInvoice(sql: Sql, businessId: string, invoiceId: string, environment: Books) {
  const rows = await sql<{
    id: string;
    number: string;
    customer_id: string | null;
    customer_name: string;
    issue_date: string;
    due_date: string | null;
    status: string;
    total: string;
    amount_paid: string;
    amount_credited: string;
    taxable_total: string;
    cgst_total: string;
    sgst_total: string;
    igst_total: string;
    place_of_supply: string | null;
    notes: string | null;
    terms: string | null;
    reference: string | null;
    currency: string;
    journal_id: string | null;
  }>`
    select id, number, customer_id, customer_name, issue_date::text as issue_date, due_date::text as due_date, status,
           total::text as total, amount_paid::text as amount_paid, amount_credited::text as amount_credited,
           taxable_total::text as taxable_total, cgst_total::text as cgst_total, sgst_total::text as sgst_total,
           igst_total::text as igst_total, place_of_supply, notes, terms, reference, currency, journal_id
    from biz_invoices where id = ${invoiceId} and business_id = ${businessId} and environment = ${environment}
  `;
  const invoice = rows[0];
  if (!invoice) throw new Error("Invoice not found");
  const lines = await sql<{
    description: string;
    hsn_sac: string | null;
    quantity: string;
    unit: string | null;
    rate: string;
    discount: string;
    gst_rate: number;
    revenue_code: string;
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    line_total: string;
  }>`
    select description, hsn_sac, quantity::text as quantity, unit, rate::text as rate, discount::text as discount,
           gst_rate, revenue_code, taxable::text as taxable, cgst::text as cgst, sgst::text as sgst, igst::text as igst,
           line_total::text as line_total
    from biz_invoice_lines where invoice_id = ${invoice.id} order by position
  `;
  return { invoice, lines };
}

export async function issueDraft(sql: Sql, actorId: string, businessId: string, environment: Books, invoiceId: string) {
  const { invoice, lines } = await loadInvoice(sql, businessId, invoiceId, environment);
  if (invoice.status !== "draft") throw new Error("Only a draft can be issued");
  if (lines.length === 0) throw new Error("Add a line before issuing");
  const seller = await sellerRow(sql, businessId);
  const computed = computeLines(
    lines.map((line) => ({
      description: line.description,
      hsnSac: line.hsn_sac,
      quantity: line.quantity,
      unit: line.unit,
      rate: toCents(line.rate),
      discount: toCents(line.discount),
      gstRate: Number(line.gst_rate),
      revenueCode: line.revenue_code,
    })),
    seller.state_code,
    invoice.place_of_supply,
  );
  if (computed.treatment === "incomplete") {
    throw new Error("Add your state and the place of supply before issuing a taxed invoice");
  }
  const journal = planIssueJournal({
    lines: computed.lines,
    cgst: computed.cgst,
    sgst: computed.sgst,
    igst: computed.igst,
    total: computed.total,
  });
  assertBalanced(journal);
  const number = await allocateNumber(sql, businessId, invoice.issue_date.slice(0, 10), "INV");
  const journalId = await postJournal(sql, actorId, businessId, {
    date: invoice.issue_date.slice(0, 10),
    memo: `Invoice ${number}`,
    source: "invoice",
    sourceId: invoice.id,
    lines: journal,
    environment,
  });
  await sql`
    update biz_invoices set
      number = ${number},
      status = 'issued',
      journal_id = ${journalId},
      issued_at = now(),
      subtotal = ${fromCents(computed.taxable)}::numeric,
      tax = ${fromCents(computed.cgst + computed.sgst + computed.igst)}::numeric,
      total = ${fromCents(computed.total)}::numeric,
      taxable_total = ${fromCents(computed.taxable)}::numeric,
      cgst_total = ${fromCents(computed.cgst)}::numeric,
      sgst_total = ${fromCents(computed.sgst)}::numeric,
      igst_total = ${fromCents(computed.igst)}::numeric
    where id = ${invoice.id}
  `;
  await audit(sql, businessId, actorId, "invoice.issued", invoice.id);
  try {
    await emitBusinessEvent(sql, businessId, environment, "invoice.issued", { id: invoice.id, number });
  } catch {
    /* delivery bookkeeping must not undo the invoice */
  }
  return { id: invoice.id, number, total: fromCents(computed.total) };
}

export async function recordInvoicePayment(
  sql: Sql,
  actorId: string,
  businessId: string,
  environment: Books,
  input: { invoiceId: string; amount: string; date: string; method: string; accountCode: string; reference?: string | null; notes?: string | null },
) {
  const { invoice } = await loadInvoice(sql, businessId, input.invoiceId, environment);
  if (invoice.status === "draft" || invoice.status === "void" || invoice.status === "cancelled") {
    throw new Error("Issue the invoice before recording a payment");
  }
  const total = toCents(invoice.total);
  const paid = toCents(invoice.amount_paid);
  const credited = toCents(invoice.amount_credited);
  const open = openOf(total, paid, credited);
  const amount = toCents(parseMoney(input.amount));
  if (amount > open) throw new Error("Payment is more than the balance due");
  const method = METHODS.includes(input.method as (typeof METHODS)[number]) ? input.method : "other";
  const journalLines = planPaymentJournal(input.accountCode, amount);
  const paymentId = crypto.randomUUID();
  const journalId = await postJournal(sql, actorId, businessId, {
    date: input.date,
    memo: `Payment for ${invoice.number}`,
    source: "payment",
    sourceId: paymentId,
    lines: journalLines,
    environment,
  });
  const nextPaid = paid + amount;
  const stillOpen = openOf(total, nextPaid, credited);
  const status = stillOpen === 0n ? "paid" : "partially_paid";
  await sql`
    insert into biz_payments (id, business_id, invoice_id, amount, paid_on, journal_id, method, reference, notes, account_code, environment)
    values (
      ${paymentId}, ${businessId}, ${invoice.id}, ${fromCents(amount)}::numeric, ${input.date}::date, ${journalId},
      ${method}, ${input.reference ?? null}, ${input.notes ?? null}, ${input.accountCode}, ${environment}
    )
  `;
  await sql`
    update biz_invoices set amount_paid = ${fromCents(nextPaid)}::numeric, status = ${status} where id = ${invoice.id}
  `;
  await audit(sql, businessId, actorId, "invoice.payment_recorded", paymentId);
  try {
    await emitBusinessEvent(sql, businessId, environment, status === "paid" ? "invoice.paid" : "invoice.partially_paid", { id: invoice.id });
    await emitBusinessEvent(sql, businessId, environment, "payment.created", { id: paymentId, invoiceId: invoice.id });
  } catch {
    /* a failed endpoint does not undo the cash receipt */
  }
  return { id: paymentId, status, balance: fromCents(stillOpen) };
}

export async function createCreditNote(
  sql: Sql,
  actorId: string,
  businessId: string,
  environment: Books,
  input: { invoiceId: string; amount: string; date: string; reason?: string | null },
) {
  const { invoice, lines } = await loadInvoice(sql, businessId, input.invoiceId, environment);
  if (invoice.journal_id == null || invoice.status === "draft") throw new Error("Only an issued invoice can be credited");
  const total = toCents(invoice.total);
  const paid = toCents(invoice.amount_paid);
  const credited = toCents(invoice.amount_credited);
  const open = openOf(total, paid, credited);
  const amount = toCents(parseMoney(input.amount));
  const legacy = lines.length === 0;
  const journal = planCreditJournal({
    lines: legacy
      ? [{ revenueCode: "4000", taxable: total }]
      : lines.map((line) => ({ revenueCode: line.revenue_code, taxable: toCents(line.taxable) })),
    cgst: legacy ? 0n : toCents(invoice.cgst_total),
    sgst: legacy ? 0n : toCents(invoice.sgst_total),
    igst: legacy ? 0n : toCents(invoice.igst_total),
    total: legacy ? total : toCents(invoice.taxable_total) + toCents(invoice.cgst_total) + toCents(invoice.sgst_total) + toCents(invoice.igst_total),
    credit: amount,
  });
  if (amount > open) throw new Error("Credit note is more than the balance due");
  assertBalanced(journal);
  const number = await allocateNumber(sql, businessId, input.date, "CN");
  const id = crypto.randomUUID();
  const journalId = await postJournal(sql, actorId, businessId, {
    date: input.date,
    memo: `Credit note ${number} for ${invoice.number}`,
    source: "credit_note",
    sourceId: id,
    lines: journal,
    environment,
  });
  const cgst = journal.find((line) => line.code === "2210")?.debit ?? 0n;
  const sgst = journal.find((line) => line.code === "2220")?.debit ?? 0n;
  const igst = journal.find((line) => line.code === "2230")?.debit ?? 0n;
  const taxable = journal.filter((line) => line.code.startsWith("4")).reduce((sum, line) => sum + line.debit, 0n);
  await sql`
    insert into biz_credit_notes (
      id, business_id, invoice_id, number, issue_date, reason, taxable, cgst, sgst, igst, total, journal_id, environment
    ) values (
      ${id}, ${businessId}, ${invoice.id}, ${number}, ${input.date}::date, ${input.reason ?? null},
      ${fromCents(taxable)}::numeric, ${fromCents(cgst)}::numeric, ${fromCents(sgst)}::numeric, ${fromCents(igst)}::numeric,
      ${fromCents(amount)}::numeric, ${journalId}, ${environment}
    )
  `;
  const nextCredited = credited + amount;
  const stillOpen = openOf(total, paid, nextCredited);
  const status = stillOpen === 0n ? (paid > 0n ? "paid" : "credited") : invoice.status === "partially_paid" || paid > 0n ? "partially_paid" : "issued";
  await sql`
    update biz_invoices set amount_credited = ${fromCents(nextCredited)}::numeric, status = ${status} where id = ${invoice.id}
  `;
  await audit(sql, businessId, actorId, "invoice.credit_note_created", id);
  return { id, number, balance: fromCents(stillOpen) };
}

export async function listInvoicePayments(sql: Sql, businessId: string, invoiceId: string, environment: Books) {
  await loadInvoice(sql, businessId, invoiceId, environment);
  return sql<{ id: string; amount: string; paid_on: string; method: string; reference: string | null; account_code: string }>`
    select id, amount::text as amount, paid_on::text as paid_on, method, reference, account_code
    from biz_payments where invoice_id = ${invoiceId} and business_id = ${businessId} and environment = ${environment}
    order by paid_on
  `;
}

function presentInvoice(invoice: Awaited<ReturnType<typeof loadInvoice>>["invoice"], today: string) {
  const total = toCents(invoice.total);
  const paid = toCents(invoice.amount_paid);
  const credited = toCents(invoice.amount_credited);
  const open = openOf(total, paid, credited);
  const due = invoice.due_date?.slice(0, 10) ?? null;
  return {
    id: invoice.id,
    number: invoice.number,
    customerId: invoice.customer_id,
    customerName: invoice.customer_name,
    issueDate: invoice.issue_date.slice(0, 10),
    dueDate: due,
    status: invoice.status,
    displayStatus: displayStatus(invoice.status, due, today, open),
    total: fromCents(total),
    amountPaid: fromCents(paid),
    amountCredited: fromCents(credited),
    balance: fromCents(open < 0n ? 0n : open),
    taxable: fromCents(toCents(invoice.taxable_total)),
    cgst: fromCents(toCents(invoice.cgst_total)),
    sgst: fromCents(toCents(invoice.sgst_total)),
    igst: fromCents(toCents(invoice.igst_total)),
    placeOfSupply: invoice.place_of_supply,
    notes: invoice.notes,
    terms: invoice.terms,
    reference: invoice.reference,
    currency: invoice.currency,
    bucket: agingBucket(due, today, open < 0n ? 0n : open),
  };
}

export async function invoiceDetail(sql: Sql, businessId: string, invoiceId: string, environment: Books, today: string) {
  const loaded = await loadInvoice(sql, businessId, invoiceId, environment);
  const payments = await listInvoicePayments(sql, businessId, invoiceId, environment);
  return {
    ...presentInvoice(loaded.invoice, today),
    lines: loaded.lines.map((line) => ({
      description: line.description,
      hsnSac: line.hsn_sac,
      quantity: line.quantity,
      unit: line.unit,
      rate: line.rate,
      discount: line.discount,
      gstRate: Number(line.gst_rate),
      taxable: line.taxable,
      cgst: line.cgst,
      sgst: line.sgst,
      igst: line.igst,
      total: line.line_total,
    })),
    payments: payments.map((row) => ({ ...row, paidOn: row.paid_on.slice(0, 10) })),
  };
}

async function withLive(userId: string, projectId: string, permission: BizPermission) {
  const { sql } = await ensureUser(userId);
  const access = await requireBusiness(sql, userId, projectId, permission);
  return { sql, businessId: access.businessId };
}

export const getInvoiceDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; today: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withLive(context.userId, data.projectId, "view_finance");
      const seller = await sellerRow(sql, businessId);
      const customers = await sql<{ id: string; name: string; company: string | null; gstin: string | null; state_code: string | null; email: string | null }>`
        select id, name, company, gstin, state_code, email from biz_customers
        where business_id = ${businessId} and environment = 'live' order by name
      `;
      const invoices = await sql<{ id: string }>`
        select id from biz_invoices where business_id = ${businessId} and environment = 'live' order by issue_date desc, number desc
      `;
      const detailed = [];
      for (const row of invoices) detailed.push(await invoiceDetail(sql, businessId, row.id, "live", data.today));
      const buckets = { current: 0n, d30: 0n, d60: 0n, d90: 0n, d90p: 0n };
      for (const invoice of detailed) {
        const open = toCents(invoice.balance);
        if (invoice.bucket === "current") buckets.current += open;
        if (invoice.bucket === "1-30") buckets.d30 += open;
        if (invoice.bucket === "31-60") buckets.d60 += open;
        if (invoice.bucket === "61-90") buckets.d90 += open;
        if (invoice.bucket === "90+") buckets.d90p += open;
      }
      return {
        seller: {
          legalName: seller.legal_name,
          displayName: seller.display_name,
          stateCode: seller.state_code,
          gstin: seller.gstin,
          pan: seller.pan,
          prefix: seller.invoice_prefix,
          dueDays: seller.default_due_days,
          email: seller.email,
          phone: seller.phone,
          address1: seller.address_line1,
          city: seller.city,
          terms: seller.invoice_terms,
          upi: seller.upi_id,
        },
        customers,
        invoices: detailed,
        aging: {
          current: fromCents(buckets.current),
          d30: fromCents(buckets.d30),
          d60: fromCents(buckets.d60),
          d90: fromCents(buckets.d90),
          d90p: fromCents(buckets.d90p),
          receivable: fromCents(buckets.current + buckets.d30 + buckets.d60 + buckets.d90 + buckets.d90p),
        },
      };
    } catch (err) {
      publicError(err, "Couldn't load invoices.");
    }
  });

export const saveBusinessCustomer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; name: string; company?: string; email?: string; gstin?: string; stateCode?: string; billingAddress?: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withLive(context.userId, data.projectId, "create_records");
      return await saveCustomer(sql, businessId, "live", data);
    } catch (err) {
      publicError(err, "Couldn't save that customer.");
    }
  });

export const saveSellerProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; legalName?: string; stateCode?: string; gstin?: string; pan?: string; email?: string; phone?: string; address1?: string; city?: string; prefix?: string; dueDays?: number; terms?: string; upi?: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withLive(context.userId, data.projectId, "create_records");
      const prefix = (data.prefix || "INV").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "INV";
      const due = Number.isInteger(data.dueDays) && (data.dueDays as number) >= 0 && (data.dueDays as number) <= 365 ? data.dueDays : 30;
      await sql`
        update businesses set
          legal_name = coalesce(${data.legalName?.trim() || null}, legal_name),
          state_code = ${data.stateCode?.trim().toUpperCase() || null},
          gstin = ${data.gstin?.trim() || null},
          pan = ${data.pan?.trim() || null},
          email = ${data.email?.trim() || null},
          phone = ${data.phone?.trim() || null},
          address_line1 = ${data.address1?.trim() || null},
          city = ${data.city?.trim() || null},
          invoice_prefix = ${prefix},
          default_due_days = ${due},
          invoice_terms = ${data.terms?.trim() || null},
          upi_id = ${data.upi?.trim() || null}
        where id = ${businessId}
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't save the seller profile.");
    }
  });

export const saveBusinessDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    projectId: string;
    id?: string | null;
    customerId: string;
    issueDate: string;
    dueDate?: string | null;
    placeOfSupply?: string | null;
    items: { description: string; hsnSac?: string; quantity: string; rate: string; gstRate: number; revenueCode?: string }[];
  }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withLive(context.userId, data.projectId, "create_records");
      return await saveDraftInvoice(sql, context.userId, businessId, "live", {
        ...data,
        items: data.items.map((item) => ({ ...item, rate: toCents(parseMoney(item.rate)) })),
      });
    } catch (err) {
      publicError(err, "Couldn't save that draft.");
    }
  });

export const issueBusinessInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; invoiceId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withLive(context.userId, data.projectId, "create_records");
      return await issueDraft(sql, context.userId, businessId, "live", data.invoiceId);
    } catch (err) {
      publicError(err, "Couldn't issue that invoice.");
    }
  });

export const payBusinessInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; invoiceId: string; amount: string; date: string; method: string; accountCode: string; reference?: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withLive(context.userId, data.projectId, "create_records");
      return await recordInvoicePayment(sql, context.userId, businessId, "live", data);
    } catch (err) {
      publicError(err, "Couldn't record that payment.");
    }
  });

export const creditBusinessInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; invoiceId: string; amount: string; date: string; reason?: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withLive(context.userId, data.projectId, "create_records");
      return await createCreditNote(sql, context.userId, businessId, "live", data);
    } catch (err) {
      publicError(err, "Couldn't create that credit note.");
    }
  });

export async function invoicePdfBase64(sql: Sql, businessId: string, invoiceId: string, environment: Books) {
  const detail = await invoiceDetail(sql, businessId, invoiceId, environment, new Date().toISOString().slice(0, 10));
  const seller = await sellerRow(sql, businessId);
  const { buildInvoicePdf } = await import("./invoice-pdf");
  const bytes = await buildInvoicePdf({ detail, seller });
  return Buffer.from(bytes).toString("base64");
}

export const downloadInvoicePdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; invoiceId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql, businessId } = await withLive(context.userId, data.projectId, "view_finance");
      const pdf = await invoicePdfBase64(sql, businessId, data.invoiceId, "live");
      return { pdf };
    } catch (err) {
      publicError(err, "Couldn't build that PDF.");
    }
  });
