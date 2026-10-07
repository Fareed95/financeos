import { addMoney, formatMoney, isZero, subMoney } from "./money.ts";

export type InvoiceFact = {
  number: string;
  customer: string;
  status: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  paid: string;
};

export type HolderFact = { name: string; shares: string; bps: string };

export type LearnSnapshot = {
  name: string;
  currency: string;
  periodLabel: string;
  revenue: string;
  grossProfit: string;
  ebitda: string;
  depreciation: string;
  interest: string;
  tax: string;
  netProfit: string;
  cash: string;
  receivable: string;
  payable: string;
  gstPayable: string;
  ownerFunding: string;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  operating: string;
  investing: string;
  financing: string;
  invoices: InvoiceFact[];
  holders: HolderFact[];
  change?: { explained: boolean; delta: string; parts: { label: string; amount: string }[] } | null;
  runwayNote?: string | null;
  reimbursement?: string | null;
};

export type ExplainRow = { label: string; value: string };
export type ExplainBlock = {
  heading: string;
  body: string;
  rows?: ExplainRow[];
  hypothetical?: boolean;
};

const money = (amount: string, currency: string) => formatMoney(amount, currency);

function balanceOf(invoice: InvoiceFact) {
  return subMoney(invoice.total, invoice.paid);
}

export function explainCapital(snapshot: LearnSnapshot): ExplainBlock {
  const { name, currency } = snapshot;
  const rows: ExplainRow[] = [
    { label: "Cash available now", value: money(snapshot.cash, currency) },
    { label: "Recorded owner funding", value: money(snapshot.ownerFunding, currency) },
    { label: `Revenue (${snapshot.periodLabel})`, value: money(snapshot.revenue, currency) },
    { label: `Profit (${snapshot.periodLabel})`, value: money(snapshot.netProfit, currency) },
  ];
  const sameCash =
    snapshot.cash === snapshot.ownerFunding && isZero(snapshot.revenue) && isZero(snapshot.netProfit) && !isZero(snapshot.ownerFunding);
  const body = isZero(snapshot.ownerFunding)
    ? "No owner funding has been posted, so this page will not invent a starting-money story."
    : sameCash
      ? `${name} currently has ${money(snapshot.cash, currency)} available. That ${money(snapshot.cash, currency)} came from owner funding, so it increased cash but did not increase revenue or profit.`
      : `${name} has recorded ${money(snapshot.ownerFunding, currency)} as money put into the business. Cash available is ${money(snapshot.cash, currency)}. Revenue this period is ${money(snapshot.revenue, currency)}. Funding is not a sale.`;
  return { heading: "Your numbers", body, rows };
}

export function explainProfitWaterfall(snapshot: LearnSnapshot): ExplainBlock {
  const cogs = subMoney(snapshot.revenue, snapshot.grossProfit);
  const opex = subMoney(snapshot.grossProfit, snapshot.ebitda);
  const currency = snapshot.currency;
  return {
    heading: `Profit for ${snapshot.periodLabel}`,
    body: isZero(snapshot.revenue) && isZero(snapshot.netProfit)
      ? "There is no sales activity in this period, so profit is zero. Cash you put in is not included here."
      : "Each row is taken from the books for this period. Nothing below is an example.",
    rows: [
      { label: "Revenue", value: money(snapshot.revenue, currency) },
      { label: "Cost of sales", value: money(cogs, currency) },
      { label: "Gross profit", value: money(snapshot.grossProfit, currency) },
      { label: "Operating expenses", value: money(opex, currency) },
      { label: "Operating profit (EBITDA)", value: money(snapshot.ebitda, currency) },
      { label: "Depreciation", value: money(snapshot.depreciation, currency) },
      { label: "Interest", value: money(snapshot.interest, currency) },
      { label: "Tax expense", value: money(snapshot.tax, currency) },
      { label: "Net profit", value: money(snapshot.netProfit, currency) },
    ],
  };
}

export function explainEbitda(snapshot: LearnSnapshot): ExplainBlock {
  const cogs = subMoney(snapshot.revenue, snapshot.grossProfit);
  const opex = subMoney(snapshot.grossProfit, snapshot.ebitda);
  return {
    heading: "How Kharcha calculated operating profit",
    body: "EBITDA here is earnings before interest, taxes, depreciation, and amortization. It is the operating profit of the core business.",
    rows: [
      { label: "Revenue", value: money(snapshot.revenue, snapshot.currency) },
      { label: "Cost of sales", value: money(cogs, snapshot.currency) },
      { label: "Operating expenses", value: money(opex, snapshot.currency) },
      { label: "EBITDA", value: money(snapshot.ebitda, snapshot.currency) },
    ],
  };
}

export function explainCashVersusProfit(snapshot: LearnSnapshot): ExplainBlock[] {
  const blocks: ExplainBlock[] = [
    {
      heading: "Cash and profit are different",
      body: `Cash available is ${money(snapshot.cash, snapshot.currency)} right now. Profit for ${snapshot.periodLabel} is ${money(snapshot.netProfit, snapshot.currency)}.`,
      rows: [
        { label: "Cash available", value: money(snapshot.cash, snapshot.currency) },
        { label: "Profit this period", value: money(snapshot.netProfit, snapshot.currency) },
        { label: "Money to collect", value: money(snapshot.receivable, snapshot.currency) },
      ],
    },
  ];
  const issued = snapshot.invoices.filter((invoice) => invoice.status !== "draft" && invoice.status !== "void" && invoice.status !== "cancelled");
  if (issued.length === 0) {
    blocks.push({
      heading: "No issued invoice to walk through",
      body: "When you issue an invoice, revenue can rise before any cash arrives. There is no issued invoice on these books yet, so that story is not filled in with made-up numbers.",
    });
    return blocks;
  }
  for (const invoice of issued.slice(0, 3)) {
    blocks.push(explainOneInvoice(snapshot, invoice));
  }
  return blocks;
}

export function explainOneInvoice(snapshot: LearnSnapshot, invoice: InvoiceFact): ExplainBlock {
  const gst = addMoney(invoice.cgst, invoice.sgst, invoice.igst);
  const owed = balanceOf(invoice);
  if (invoice.status === "draft") {
    return {
      heading: `Invoice ${invoice.number} is a draft`,
      body: "A draft does not change revenue, cash, or money to collect.",
    };
  }
  const taxKind = !isZero(invoice.igst) && isZero(invoice.cgst) ? "IGST" : !isZero(invoice.cgst) || !isZero(invoice.sgst) ? "CGST + SGST" : "No GST recorded";
  return {
    heading: `Invoice ${invoice.number}`,
    body: `${invoice.customer} was billed ${money(invoice.total, snapshot.currency)}. The taxable sale is revenue. GST is tracked separately and is not revenue. A payment increases cash and reduces what they owe. Revenue is not counted again.`,
    rows: [
      { label: "Revenue (taxable)", value: money(invoice.taxable, snapshot.currency) },
      { label: `GST payable (${taxKind})`, value: money(gst, snapshot.currency) },
      { label: "Invoice total", value: money(invoice.total, snapshot.currency) },
      { label: "Cash received on this invoice", value: money(invoice.paid, snapshot.currency) },
      { label: "Still to collect", value: money(owed, snapshot.currency) },
    ],
  };
}

export function explainBalanceSheet(snapshot: LearnSnapshot): ExplainBlock {
  return {
    heading: "What the books say you own and owe",
    body: "Assets should equal liabilities plus equity, including earnings. These totals come from the current statements.",
    rows: [
      { label: "Assets", value: money(snapshot.totalAssets, snapshot.currency) },
      { label: "Liabilities", value: money(snapshot.totalLiabilities, snapshot.currency) },
      { label: "Equity", value: money(snapshot.totalEquity, snapshot.currency) },
    ],
  };
}

export function explainCashFlow(snapshot: LearnSnapshot): ExplainBlock {
  return {
    heading: `Cash movement for ${snapshot.periodLabel}`,
    body: "Operating is normal business. Investing is long-term assets. Financing is owners, investors, or loans. These are the classified totals, not a story Kharcha guessed.",
    rows: [
      { label: "Operating", value: money(snapshot.operating, snapshot.currency) },
      { label: "Investing", value: money(snapshot.investing, snapshot.currency) },
      { label: "Financing", value: money(snapshot.financing, snapshot.currency) },
    ],
  };
}

export function explainOwnership(snapshot: LearnSnapshot): ExplainBlock {
  if (snapshot.holders.length === 0) {
    return {
      heading: "No shares recorded",
      body: "There is no cap table yet, so no ownership percent is shown. Team access does not create shares.",
    };
  }
  return {
    heading: "Recorded ownership",
    body: "Percents come from shares outstanding. They are not typed in.",
    rows: snapshot.holders.map((holder) => ({
      label: holder.name,
      value: `${holder.shares} shares · ${(Number(holder.bps) / 100).toFixed(2)}%`,
    })),
  };
}

export function hypotheticalDilution(): ExplainBlock {
  return {
    heading: "How dilution works",
    body: "This is a hypothetical example, not your company. You did not lose shares. More shares were issued, so the percentage became smaller. Viewing this does not change the cap table.",
    hypothetical: true,
    rows: [
      { label: "Before · founder", value: "70%" },
      { label: "Before · co-founder", value: "30%" },
      { label: "After · founder", value: "63%" },
      { label: "After · co-founder", value: "27%" },
      { label: "After · investor", value: "10%" },
    ],
  };
}

export function hypotheticalValuation(): ExplainBlock {
  return {
    heading: "Valuation is not cash",
    body: "No valuation is stored for this business, so none is shown as yours. In a hypothetical priced round, pre-money ₹4.5 Cr plus a ₹50 lakh investment is a ₹5 Cr post-money value, and the investor's 10% is that investment divided by post-money. That is not revenue, profit, or the bank balance.",
    hypothetical: true,
  };
}

export function explainPurchaseBill(input: { name: string; currency: string; taxable: string; total: string; paid: string }) {
  const gst = subMoney(input.total, input.taxable);
  const owed = subMoney(input.total, input.paid);
  return {
    heading: `Bill from ${input.name}`,
    body: `${money(input.taxable, input.currency)} is the business expense. ${money(gst, input.currency)} is input GST tracked separately. It is not called a guaranteed tax credit. ${money(input.total, input.currency)} is the total owed. Cash does not move until a payment is recorded. After a payment, what remains is ${money(owed, input.currency)}.`,
    rows: [
      { label: "Expense", value: money(input.taxable, input.currency) },
      { label: "Input GST tracked", value: money(gst, input.currency) },
      { label: "Total owed", value: money(input.total, input.currency) },
      { label: "Paid", value: money(input.paid, input.currency) },
      { label: "Still to pay", value: money(owed, input.currency) },
    ],
  };
}

export function explainChange(snapshot: LearnSnapshot): ExplainBlock {
  if (!snapshot.change) {
    return { heading: "Why did this change?", body: "A previous period is not loaded, so Kharcha will not guess a cause." };
  }
  if (!snapshot.change.explained) {
    return { heading: "Why did this change?", body: "Kharcha could not fully explain this change from categorized records." };
  }
  return {
    heading: "Why did this change?",
    body: `Profit moved ${money(snapshot.change.delta, snapshot.currency)} compared with the previous period. These are ledger differences, not a guessed story.`,
    rows: snapshot.change.parts.map((part) => ({ label: part.label, value: money(part.amount, snapshot.currency) })),
  };
}

export function explainPersonal(snapshot: LearnSnapshot): ExplainBlock {
  const due = snapshot.reimbursement;
  if (!due || isZero(due)) {
    return {
      heading: "Paid personally",
      body: "If someone uses their own money for a business expense, the business owes that person the amount they paid. It does not change who owns the company.",
    };
  }
  return {
    heading: "Paid personally",
    body: `${snapshot.name} owes ${money(due, snapshot.currency)} back to team members who paid business expenses themselves. Returning that money is not a second expense, and it does not change ownership.`,
    rows: [{ label: "To reimburse", value: money(due, snapshot.currency) }],
  };
}

export function explainKeptProfit(snapshot: LearnSnapshot): ExplainBlock {
  return {
    heading: "Profit kept in the business",
    body: `Profit does not move into personal accounts on its own. ${snapshot.name}'s result this period is ${money(snapshot.netProfit, snapshot.currency)}. Unless you deliberately take money out, it stays in the business. In accounting this leftover result is retained earnings.`,
    rows: [
      { label: "Profit this period", value: money(snapshot.netProfit, snapshot.currency) },
      { label: "Cash available", value: money(snapshot.cash, snapshot.currency) },
    ],
  };
}

export function blocksFor(page: string, snapshot: LearnSnapshot): ExplainBlock[] {
  if (page === "home") return [explainCapital(snapshot), explainProfitWaterfall(snapshot), explainEbitda(snapshot), ...explainCashVersusProfit(snapshot), explainChange(snapshot)];
  if (page === "invoices") {
    const issued = snapshot.invoices.filter((invoice) => invoice.status !== "draft");
    return [
      issued.length ? explainOneInvoice(snapshot, issued[0]!) : { heading: "No issued invoice yet", body: "A draft, if you have one, does not affect the books. Issue an invoice before revenue and money to collect change." },
      ...snapshot.invoices.filter((invoice) => invoice.status === "draft").slice(0, 1).map((invoice) => explainOneInvoice(snapshot, invoice)),
      { heading: "GST on the books", body: isZero(snapshot.gstPayable) ? "No GST payable is sitting on the ledger yet." : `GST payable recorded from issued sales is ${money(snapshot.gstPayable, snapshot.currency)}. That balance is tax, not revenue.`, rows: [{ label: "GST payable", value: money(snapshot.gstPayable, snapshot.currency) }] },
      { heading: "Input tax credit", body: "Kharcha does not calculate input tax credit. GST collected is not reduced by purchase GST unless a credit has actually been recorded, and this app does not record that credit." },
    ];
  }
  if (page === "expenses" || page === "reimbursements") {
    return [
      explainPersonal(snapshot),
      explainKeptProfit(snapshot),
      explainProfitWaterfall(snapshot),
      {
        heading: "Money to pay",
        body: isZero(snapshot.payable)
          ? "No vendor bills are waiting. Money owed back to the team is separate from vendor bills."
          : `Vendors are owed ${money(snapshot.payable, snapshot.currency)}. That is not the same as reimbursing the team.`,
        rows: [{ label: "Vendor bills", value: money(snapshot.payable, snapshot.currency) }],
      },
    ];
  }
  if (page === "reports") return [explainProfitWaterfall(snapshot), explainEbitda(snapshot), explainBalanceSheet(snapshot), explainCashFlow(snapshot), explainKeptProfit(snapshot)];
  if (page === "equity") return [explainOwnership(snapshot), hypotheticalDilution(), hypotheticalValuation()];
  if (page === "team") {
    return [
      explainOwnership(snapshot),
      { heading: "Login versus shares", body: "Someone can open this business and hold no shares. Someone can hold shares and have no login. The team list and the cap table are different records." },
    ];
  }
  if (page === "developer") {
    return [{ heading: "Nothing secret is shown here", body: "API keys are passwords for apps. This explanation never includes a key, a hash, or a webhook secret." }];
  }
  return [explainCapital(snapshot)];
}
