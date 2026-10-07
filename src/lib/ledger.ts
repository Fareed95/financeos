/** Double-entry math in integer paise. Reports read posted lines only. */

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type LedgerAccount = {
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  cash: boolean;
};

export type PostedLine = {
  entryId: string;
  date: string;
  code: string;
  debit: bigint;
  credit: bigint;
};

export const CHART: LedgerAccount[] = [
  { code: "1000", name: "Cash", type: "asset", subtype: "cash", cash: true },
  { code: "1010", name: "Bank", type: "asset", subtype: "bank", cash: true },
  { code: "1020", name: "Petty Cash", type: "asset", subtype: "cash", cash: true },
  { code: "1100", name: "Accounts Receivable", type: "asset", subtype: "receivable", cash: false },
  { code: "1200", name: "Inventory", type: "asset", subtype: "inventory", cash: false },
  { code: "1210", name: "Input CGST", type: "asset", subtype: "input_gst", cash: false },
  { code: "1220", name: "Input SGST", type: "asset", subtype: "input_gst", cash: false },
  { code: "1230", name: "Input IGST", type: "asset", subtype: "input_gst", cash: false },
  { code: "1300", name: "Prepaid Expenses", type: "asset", subtype: "prepaid", cash: false },
  { code: "1400", name: "Fixed Assets", type: "asset", subtype: "fixed", cash: false },
  { code: "1420", name: "Computer Equipment", type: "asset", subtype: "fixed", cash: false },
  { code: "1410", name: "Accumulated Depreciation", type: "asset", subtype: "accum_depr", cash: false },
  { code: "2000", name: "Accounts Payable", type: "liability", subtype: "payable", cash: false },
  { code: "2100", name: "Credit Cards", type: "liability", subtype: "card", cash: false },
  { code: "2200", name: "Taxes Payable", type: "liability", subtype: "tax", cash: false },
  { code: "2210", name: "CGST Payable", type: "liability", subtype: "tax", cash: false },
  { code: "2220", name: "SGST Payable", type: "liability", subtype: "tax", cash: false },
  { code: "2230", name: "IGST Payable", type: "liability", subtype: "tax", cash: false },
  { code: "2300", name: "Loans Payable", type: "liability", subtype: "loan", cash: false },
  { code: "2400", name: "Accrued Expenses", type: "liability", subtype: "accrued", cash: false },
  { code: "2500", name: "Due to team members", type: "liability", subtype: "reimbursement", cash: false },
  { code: "3000", name: "Share Capital", type: "equity", subtype: "capital", cash: false },
  { code: "3100", name: "Additional Paid-in Capital", type: "equity", subtype: "apic", cash: false },
  { code: "3200", name: "Retained Earnings", type: "equity", subtype: "retained", cash: false },
  { code: "4000", name: "Product Revenue", type: "revenue", subtype: "product", cash: false },
  { code: "4100", name: "Service Revenue", type: "revenue", subtype: "service", cash: false },
  { code: "4200", name: "Other Income", type: "revenue", subtype: "other_income", cash: false },
  { code: "5000", name: "Cost of Goods Sold", type: "expense", subtype: "cogs", cash: false },
  { code: "5100", name: "Salaries", type: "expense", subtype: "salary", cash: false },
  { code: "5200", name: "Rent", type: "expense", subtype: "rent", cash: false },
  { code: "5300", name: "Marketing", type: "expense", subtype: "marketing", cash: false },
  { code: "5400", name: "Software", type: "expense", subtype: "software", cash: false },
  { code: "5500", name: "Travel", type: "expense", subtype: "travel", cash: false },
  { code: "5600", name: "Professional Fees", type: "expense", subtype: "professional", cash: false },
  { code: "5700", name: "Depreciation", type: "expense", subtype: "depreciation", cash: false },
  { code: "5800", name: "Interest", type: "expense", subtype: "interest", cash: false },
  { code: "5900", name: "Taxes", type: "expense", subtype: "tax", cash: false },
];

const BY_CODE = new Map(CHART.map((account) => [account.code, account]));

export function accountByCode(code: string): LedgerAccount {
  const account = BY_CODE.get(code);
  if (!account) throw new Error(`Unknown account ${code}`);
  return account;
}

export type DraftLine = { code: string; debit: bigint; credit: bigint };

export function assertBalanced(lines: DraftLine[]) {
  if (lines.length < 2) throw new Error("A journal needs at least two lines");
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    if (line.debit < 0n || line.credit < 0n) throw new Error("Amounts can't be negative");
    const hasDebit = line.debit > 0n;
    const hasCredit = line.credit > 0n;
    if (hasDebit === hasCredit) throw new Error("Each line is either a debit or a credit");
    accountByCode(line.code);
    debit += line.debit;
    credit += line.credit;
  }
  if (debit !== credit) throw new Error("Journal does not balance");
  if (debit === 0n) throw new Error("Journal is empty");
}

export function invoiceTotal(subtotal: bigint, discount: bigint, tax: bigint): bigint {
  if (subtotal < 0n || discount < 0n || tax < 0n) throw new Error("Amounts can't be negative");
  if (discount > subtotal) throw new Error("Discount can't exceed subtotal");
  return subtotal - discount + tax;
}

type Bucket = { code: string; name: string; amount: bigint };

export type Statements = {
  ok: boolean;
  error: string | null;
  trialDebit: bigint;
  trialCredit: bigint;
  revenue: Bucket[];
  cogs: Bucket[];
  opex: Bucket[];
  depreciation: bigint;
  interest: bigint;
  tax: bigint;
  totalRevenue: bigint;
  grossProfit: bigint;
  ebitda: bigint;
  ebit: bigint;
  profitBeforeTax: bigint;
  netProfit: bigint;
  assets: Bucket[];
  liabilities: Bucket[];
  equity: Bucket[];
  totalAssets: bigint;
  totalLiabilities: bigint;
  totalEquity: bigint;
  currentEarnings: bigint;
  openingCash: bigint;
  operating: bigint;
  investing: bigint;
  financing: bigint;
  closingCash: bigint;
};

function emptyStatements(error: string | null, ok: boolean): Statements {
  const zero = {
    ok,
    error,
    trialDebit: 0n,
    trialCredit: 0n,
    revenue: [],
    cogs: [],
    opex: [],
    depreciation: 0n,
    interest: 0n,
    tax: 0n,
    totalRevenue: 0n,
    grossProfit: 0n,
    ebitda: 0n,
    ebit: 0n,
    profitBeforeTax: 0n,
    netProfit: 0n,
    assets: [],
    liabilities: [],
    equity: [],
    totalAssets: 0n,
    totalLiabilities: 0n,
    totalEquity: 0n,
    currentEarnings: 0n,
    openingCash: 0n,
    operating: 0n,
    investing: 0n,
    financing: 0n,
    closingCash: 0n,
  };
  return zero;
}

function inRange(date: string, from: string, to: string) {
  return date >= from && date <= to;
}

/** Natural debit-minus-credit movement. Credit-normal accounts come out negative when they have a credit balance. */
function net(debit: bigint, credit: bigint) {
  return debit - credit;
}

export function buildStatements(lines: PostedLine[], from: string, to: string): Statements {
  if (lines.length === 0) return emptyStatements(null, true);
  const life = new Map<string, { debit: bigint; credit: bigint }>();
  const period = new Map<string, { debit: bigint; credit: bigint }>();
  const beforeCash = { debit: 0n, credit: 0n };
  for (const line of lines) {
    const lifeRow = life.get(line.code) ?? { debit: 0n, credit: 0n };
    if (line.date <= to) {
      lifeRow.debit += line.debit;
      lifeRow.credit += line.credit;
      life.set(line.code, lifeRow);
    }
    if (inRange(line.date, from, to)) {
      const row = period.get(line.code) ?? { debit: 0n, credit: 0n };
      row.debit += line.debit;
      row.credit += line.credit;
      period.set(line.code, row);
    }
    const account = BY_CODE.get(line.code);
    if (account?.cash && line.date < from) {
      beforeCash.debit += line.debit;
      beforeCash.credit += line.credit;
    }
  }

  const buckets = (codes: string[], source: Map<string, { debit: bigint; credit: bigint }>, flip: boolean) => {
    const out: Bucket[] = [];
    for (const code of codes) {
      const row = source.get(code);
      if (!row) continue;
      const account = accountByCode(code);
      const amount = flip ? row.credit - row.debit : row.debit - row.credit;
      if (amount === 0n) continue;
      out.push({ code, name: account.name, amount });
    }
    return out;
  };

  const sum = (rows: Bucket[]) => rows.reduce((total, row) => total + row.amount, 0n);
  const revenue = buckets(
    CHART.filter((account) => account.type === "revenue").map((account) => account.code),
    period,
    true,
  );
  const cogs = buckets(
    CHART.filter((account) => account.subtype === "cogs").map((account) => account.code),
    period,
    false,
  );
  const opex = buckets(
    CHART.filter((account) => account.type === "expense" && !["cogs", "depreciation", "interest", "tax"].includes(account.subtype)).map(
      (account) => account.code,
    ),
    period,
    false,
  );
  const depreciation = sum(
    buckets(
      CHART.filter((account) => account.subtype === "depreciation").map((account) => account.code),
      period,
      false,
    ),
  );
  const interest = sum(
    buckets(
      CHART.filter((account) => account.type === "expense" && account.subtype === "interest").map((account) => account.code),
      period,
      false,
    ),
  );
  const tax = sum(
    buckets(
      CHART.filter((account) => account.type === "expense" && account.subtype === "tax").map((account) => account.code),
      period,
      false,
    ),
  );
  const totalRevenue = sum(revenue);
  const grossProfit = totalRevenue - sum(cogs);
  const ebitda = grossProfit - sum(opex);
  const ebit = ebitda - depreciation;
  const profitBeforeTax = ebit - interest;
  const netProfit = profitBeforeTax - tax;

  const assets = buckets(
    CHART.filter((account) => account.type === "asset").map((account) => account.code),
    life,
    false,
  );
  const liabilities = buckets(
    CHART.filter((account) => account.type === "liability").map((account) => account.code),
    life,
    true,
  );
  const equity = buckets(
    CHART.filter((account) => account.type === "equity").map((account) => account.code),
    life,
    true,
  );
  let currentEarnings = 0n;
  for (const account of CHART) {
    if (account.type !== "revenue" && account.type !== "expense") continue;
    const row = life.get(account.code);
    if (!row) continue;
    currentEarnings += row.credit - row.debit;
  }
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity) + currentEarnings;

  let trialDebit = 0n;
  let trialCredit = 0n;
  for (const account of CHART) {
    const row = life.get(account.code);
    if (!row) continue;
    const balance = row.debit - row.credit;
    if (balance > 0n) trialDebit += balance;
    else if (balance < 0n) trialCredit += -balance;
  }

  const byEntry = new Map<string, PostedLine[]>();
  for (const line of lines) {
    if (!inRange(line.date, from, to)) continue;
    const list = byEntry.get(line.entryId) ?? [];
    list.push(line);
    byEntry.set(line.entryId, list);
  }
  let operating = 0n;
  let investing = 0n;
  let financing = 0n;
  for (const entry of byEntry.values()) {
    let cashMove = 0n;
    let kind: "operating" | "investing" | "financing" = "operating";
    for (const line of entry) {
      const account = accountByCode(line.code);
      if (account.cash) cashMove += line.debit - line.credit;
      else if (account.type === "equity" || account.subtype === "loan") kind = "financing";
      else if (account.subtype === "fixed" || account.subtype === "accum_depr") kind = "investing";
    }
    if (cashMove === 0n) continue;
    if (kind === "financing") financing += cashMove;
    else if (kind === "investing") investing += cashMove;
    else operating += cashMove;
  }
  const openingCash = beforeCash.debit - beforeCash.credit;
  const closingCash = openingCash + operating + investing + financing;
  const balanced = totalAssets === totalLiabilities + totalEquity && trialDebit === trialCredit;
  return {
    ok: balanced,
    error: balanced ? null : "Accounting integrity error: the books do not balance.",
    trialDebit,
    trialCredit,
    revenue,
    cogs,
    opex,
    depreciation,
    interest,
    tax,
    totalRevenue,
    grossProfit,
    ebitda,
    ebit,
    profitBeforeTax,
    netProfit,
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    currentEarnings,
    openingCash,
    operating,
    investing,
    financing,
    closingCash,
  };
}

export const METRIC_HELP: Record<string, string> = {
  "Gross Profit": "Revenue minus the direct cost of goods sold.",
  EBITDA: "Earnings before interest, tax, depreciation, and amortization.",
  EBIT: "Earnings before interest and tax. EBITDA minus depreciation.",
  "Profit Before Tax": "EBIT minus interest.",
  "Net Profit": "Profit after tax. This is not the same as cash.",
};
