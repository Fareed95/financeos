/** The only API surface the developer docs are allowed to show. */

export type ApiRoute = {
  id: string;
  method: "GET" | "POST" | "PATCH";
  pattern: string;
  scope: string;
  summary: string;
  body?: string;
  response: string;
  idempotent?: boolean;
};

export const API_ROUTES: ApiRoute[] = [
  {
    id: "business",
    method: "GET",
    pattern: "business",
    scope: "accounting:read",
    summary: "The business this key belongs to. The key decides the business. Do not send a business id.",
    response: '{ "id": "…", "legalName": "Crodlin", "environment": "test" }',
  },
  {
    id: "accounts",
    method: "GET",
    pattern: "accounts",
    scope: "accounting:read",
    summary: "Chart of accounts for this business, including GST payable accounts.",
    response: '{ "accounts": [{ "code": "2210", "name": "CGST Payable" }] }',
  },
  {
    id: "listCustomers",
    method: "GET",
    pattern: "customers",
    scope: "customers:read",
    summary: "Customers in this key's environment. A test key does not see live customers.",
    response: '{ "customers": [{ "id": "…", "name": "ABC Ltd", "stateCode": "MH" }] }',
  },
  {
    id: "createCustomer",
    method: "POST",
    pattern: "customers",
    scope: "customers:create",
    summary: "Create a customer. Identity is the returned id, not the name.",
    idempotent: true,
    body: '{ "name": "ABC Ltd", "gstin": "27AAAAA0000A1Z5", "state_code": "MH" }',
    response: '{ "id": "…" }',
  },
  {
    id: "updateCustomer",
    method: "PATCH",
    pattern: "customers/:id",
    scope: "customers:update",
    summary: "Update a customer in this key's environment.",
    idempotent: true,
    body: '{ "name": "ABC Ltd", "state_code": "MH" }',
    response: '{ "id": "…" }',
  },
  {
    id: "listInvoices",
    method: "GET",
    pattern: "invoices",
    scope: "invoices:read",
    summary: "Invoices for this key's environment, including balance and GST totals.",
    response: '{ "invoices": [{ "number": "INV/2026-27/00001", "status": "issued", "balance": "39000.00" }] }',
  },
  {
    id: "createInvoice",
    method: "POST",
    pattern: "invoices",
    scope: "invoices:create",
    summary: "Create a DRAFT. Totals are calculated on the server from line items. unit_price is integer paise. Nothing is posted to the ledger yet.",
    idempotent: true,
    body: '{ "customer_id": "…", "issue_date": "2026-10-07", "due_date": "2026-11-06", "place_of_supply": "MH", "items": [{ "description": "Software Development", "hsn_sac": "998314", "quantity": "1", "unit_price": 5000000, "gst_rate": 18 }] }',
    response: '{ "id": "…", "treatment": "intra", "total": "59000.00", "cgst": "4500.00", "sgst": "4500.00", "igst": "0.00" }',
  },
  {
    id: "getInvoice",
    method: "GET",
    pattern: "invoices/:id",
    scope: "invoices:read",
    summary: "One invoice with lines, GST breakup, payments, and balance.",
    response: '{ "number": "INV/2026-27/00001", "lines": [], "balance": "59000.00" }',
  },
  {
    id: "updateInvoice",
    method: "PATCH",
    pattern: "invoices/:id",
    scope: "invoices:update",
    summary: "Replace the lines on a draft. Issued invoices are rejected.",
    idempotent: true,
    body: '{ "customer_id": "…", "issue_date": "2026-10-07", "place_of_supply": "MH", "items": [{ "description": "Software Development", "quantity": "1", "unit_price": 5000000, "gst_rate": 18 }] }',
    response: '{ "id": "…", "total": "59000.00" }',
  },
  {
    id: "issueInvoice",
    method: "POST",
    pattern: "invoices/:id/issue",
    scope: "invoices:create",
    summary: "Allocate the financial-year number and post the journal. Receivable is debited. Revenue excludes GST. CGST, SGST, or IGST are credited to liability.",
    idempotent: true,
    response: '{ "id": "…", "number": "INV/2026-27/00001", "total": "59000.00" }',
  },
  {
    id: "listPayments",
    method: "GET",
    pattern: "invoices/:id/payments",
    scope: "payments:read",
    summary: "Payments recorded against one invoice.",
    response: '{ "payments": [{ "amount": "20000.00", "method": "upi" }] }',
  },
  {
    id: "payInvoice",
    method: "POST",
    pattern: "invoices/:id/payments",
    scope: "payments:create",
    summary: "Collect part or all of the balance into a cash account. Revenue is not posted again. account_code is 1000 Cash, 1010 Bank, or 1020 Petty Cash.",
    idempotent: true,
    body: '{ "amount": "20000.00", "date": "2026-10-07", "method": "upi", "account_code": "1010", "reference": "UTR123" }',
    response: '{ "status": "partially_paid", "balance": "39000.00" }',
  },
  {
    id: "invoicePdf",
    method: "GET",
    pattern: "invoices/:id/pdf",
    scope: "invoices:read",
    summary: "PDF bytes for this invoice. The response is application/pdf, not JSON.",
    response: "application/pdf",
  },
  {
    id: "creditInvoice",
    method: "POST",
    pattern: "invoices/:id/credit-notes",
    scope: "invoices:create",
    summary: "Credit note against the open balance. Reverses revenue, GST liability, and receivable. The original journal is not deleted.",
    idempotent: true,
    body: '{ "amount": "39000.00", "date": "2026-10-08", "reason": "Short supply" }',
    response: '{ "number": "CN/2026-27/00001", "balance": "0.00" }',
  },
  {
    id: "payAlias",
    method: "POST",
    pattern: "payments",
    scope: "payments:create",
    summary: "Same as POST /invoices/:id/payments. Pass invoice_id in the body.",
    idempotent: true,
    body: '{ "invoice_id": "…", "amount": "20000.00", "date": "2026-10-07", "method": "bank", "account_code": "1010" }',
    response: '{ "status": "partially_paid", "balance": "39000.00" }',
  },
  {
    id: "listExpenses",
    method: "GET",
    pattern: "expenses",
    scope: "expenses:read",
    summary: "Expenses in this key's environment.",
    response: '{ "expenses": [{ "account_code": "5400", "amount": "20000.00" }] }',
  },
  {
    id: "createExpense",
    method: "POST",
    pattern: "expenses",
    scope: "expenses:create",
    summary: "Post a paid or unpaid expense. Paid expenses credit the bank. Unpaid expenses credit accounts payable.",
    idempotent: true,
    body: '{ "code": "5400", "amount": "20000.00", "date": "2026-10-07", "memo": "Figma", "paid": true }',
    response: '{ "id": "…" }',
  },
  {
    id: "createJournal",
    method: "POST",
    pattern: "transactions",
    scope: "transactions:create",
    summary: "Post a balanced journal. Debit and credit amounts are rupee strings. Unbalanced entries are rejected.",
    idempotent: true,
    body: '{ "date": "2026-10-07", "memo": "Adjustment", "lines": [{ "code": "5400", "debit": "100.00" }, { "code": "1010", "credit": "100.00" }] }',
    response: '{ "id": "…" }',
  },
  {
    id: "pnl",
    method: "GET",
    pattern: "reports/pnl",
    scope: "reports:read",
    summary: "Profit and loss from posted journals in this key's environment. Test keys do not read the live books.",
    response: '{ "ok": true, "revenue": "50000.00", "netProfit": "50000.00" }',
  },
];

export function matchApiRoute(method: string, path: string) {
  const parts = path.split("/").filter(Boolean);
  const ordered = [...API_ROUTES].sort((a, b) => b.pattern.split("/").length - a.pattern.split("/").length);
  for (const route of ordered) {
    if (route.method !== method) continue;
    const bits = route.pattern.split("/");
    if (bits.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < bits.length; i += 1) {
      const bit = bits[i] ?? "";
      const part = parts[i] ?? "";
      if (bit.startsWith(":")) params[bit.slice(1)] = decodeURIComponent(part);
      else if (bit !== part) ok = false;
    }
    if (ok) return { route, params };
  }
  return null;
}
