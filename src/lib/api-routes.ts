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
  {
    id: "listVendors",
    method: "GET",
    pattern: "vendors",
    scope: "vendors:read",
    summary: "Vendors in this key's environment. A test key does not see live vendors.",
    response: '{ "vendors": [{ "id": "…", "name": "AWS India" }] }',
  },
  {
    id: "createVendor",
    method: "POST",
    pattern: "vendors",
    scope: "vendors:create",
    summary: "Create a vendor. Identity is the returned id, not the display name.",
    idempotent: true,
    body: '{ "display_name": "AWS India", "vendor_type": "company", "state_code": "MH" }',
    response: '{ "id": "…" }',
  },
  {
    id: "updateVendor",
    method: "PATCH",
    pattern: "vendors/:id",
    scope: "vendors:update",
    summary: "Update a vendor that belongs to this key's environment.",
    idempotent: true,
    body: '{ "display_name": "AWS India", "status": "inactive" }',
    response: '{ "id": "…" }',
  },
  {
    id: "listBills",
    method: "GET",
    pattern: "bills",
    scope: "bills:read",
    summary: "Bills in this key's environment, including open balance. Drafts have no ledger impact.",
    response: '{ "bills": [{ "id": "…", "status": "open", "balance": "11800.00" }] }',
  },
  {
    id: "createBill",
    method: "POST",
    pattern: "bills",
    scope: "bills:create",
    summary: "Create a draft bill. Pass post true only when it should hit accounts payable. GST is calculated, not guessed.",
    idempotent: true,
    body: '{ "vendor_id": "…", "bill_date": "2026-10-07", "due_date": "2026-11-06", "expense_code": "5400", "description": "Software", "rate": "10000.00", "gst_rate": 18, "place_of_supply": "MH", "post": true }',
    response: '{ "id": "…", "total": "11800.00" }',
  },
  {
    id: "postBill",
    method: "POST",
    pattern: "bills/:id/post",
    scope: "bills:update",
    summary: "Post a draft bill. Expense and input GST are debited. Accounts payable is credited. Bank is not touched.",
    idempotent: true,
    response: '{ "id": "…", "status": "open" }',
  },
  {
    id: "payBill",
    method: "POST",
    pattern: "bills/:id/payments",
    scope: "payments:create",
    summary: "Pay part of an open bill. Accounts payable is debited and bank is credited. The expense is not posted again.",
    idempotent: true,
    body: '{ "amount": "5000.00", "date": "2026-10-08", "method": "bank", "account_code": "1010" }',
    response: '{ "status": "partially_paid", "balance": "6800.00" }',
  },
  {
    id: "payablesReport",
    method: "GET",
    pattern: "reports/payables",
    scope: "reports:read",
    summary: "Open vendor bills in this key's environment, grouped only by the records that exist.",
    response: '{ "rows": [{ "who": "AWS India", "open": "6800.00" }] }',
  },
  {
    id: "balanceSheet",
    method: "GET",
    pattern: "reports/balance-sheet",
    scope: "reports:read",
    summary: "Balance sheet from posted journals in this key's environment. An imbalance is returned, not hidden.",
    response: '{ "ok": true, "assets": "20000.00", "liabilities": "0.00", "equity": "20000.00" }',
  },
  {
    id: "cashFlow",
    method: "GET",
    pattern: "reports/cash-flow",
    scope: "reports:read",
    summary: "Operating, investing, and financing cash movement for the financial year in this key's environment.",
    response: '{ "operating": "0.00", "investing": "0.00", "financing": "20000.00" }',
  },
  {
    id: "listBudgets",
    method: "GET",
    pattern: "budgets",
    scope: "budgets:read",
    summary: "Planning budgets. They do not post journals. Actuals are not included in this list.",
    response: '{ "budgets": [{ "name": "Software", "amount": "20000.00" }] }',
  },
  {
    id: "createBudget",
    method: "POST",
    pattern: "budgets",
    scope: "budgets:write",
    summary: "Create a budget for a period. This is a plan, not an accounting entry.",
    idempotent: true,
    body: '{ "name": "Software", "kind": "expense", "account_code": "5400", "amount": "20000.00", "period": "month", "period_start": "2026-10-01" }',
    response: '{ "id": "…" }',
  },
  {
    id: "listAssets",
    method: "GET",
    pattern: "assets",
    scope: "assets:read",
    summary: "Fixed assets recorded in this key's environment. Buying one does not post an operating expense.",
    response: '{ "assets": [{ "name": "Laptop", "cost": "60000.00" }] }',
  },
  {
    id: "listLoans",
    method: "GET",
    pattern: "loans",
    scope: "loans:read",
    summary: "Loans recorded in this key's environment. Receiving a loan does not create revenue.",
    response: '{ "loans": [{ "lender": "Bank", "outstanding": "100000.00" }] }',
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
