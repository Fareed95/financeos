import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, fromCents, toCents } from "@/lib/money";
import { METRIC_HELP } from "@/lib/ledger";
import { simulateRound } from "@/lib/cap-table";
import {
  createBusinessApiKey,
  getBusiness,
  postBusinessCapital,
  postBusinessExpense,
  postBusinessInvoice,
  postBusinessPayment,
  postBusinessShares,
  revokeBusinessApiKey,
  SCOPES,
} from "@/lib/server/business";
import { todayISO } from "@/lib/utils";
import { InvoiceDesk } from "@/components/finance/invoice-desk";
import { DeveloperPortal } from "@/components/finance/developer-portal";
import { BusinessSetup } from "@/components/finance/business-setup";
import { BusinessOps } from "@/components/finance/business-ops";
import { BusinessTeam } from "@/components/finance/business-team";
import { LearnButton, LearnPanel, dismissLearnTip, learnTipVisible } from "@/components/finance/learn-panel";
import type { LearnSnapshot } from "@/lib/learn-explain";
import { useEffect } from "react";

type Section = "home" | "invoices" | "expenses" | "reports" | "equity" | "team" | "developer" | "guide" | "vendors" | "bills" | "money" | "budgets" | "loans" | "assets";

export function BusinessWorkspace({ projectId, projectName, currency }: { projectId: string; projectName: string; currency: string }) {
  const today = todayISO();
  const qc = useQueryClient();
  const [section, setSection] = useState<Section>("home");
  const [more, setMore] = useState(false);
  const [add, setAdd] = useState(false);
  const [period, setPeriod] = useState("month");
  const [money, setMoney] = useState(false);
  const [learn, setLearn] = useState<string | null>(null);
  const [focusConcept, setFocusConcept] = useState<string | null>(null);
  const [showTip, setShowTip] = useState(false);
  const q = useQuery({
    queryKey: ["business", projectId, today, period],
    queryFn: () => getBusiness({ data: { projectId, today, period } }),
  });

  useEffect(() => {
    document.documentElement.dataset.hideQuickAdd = "1";
    setShowTip(learnTipVisible());
    return () => {
      delete document.documentElement.dataset.hideQuickAdd;
    };
  }, []);

  async function reload() {
    await qc.invalidateQueries({ queryKey: ["business", projectId] });
  }

  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading your business…</p>;
  if (q.error || !q.data) return <p className="text-sm text-expense">Couldn't load this business.</p>;
  const data = q.data;
  if (!data.setupDone) {
    if (data.role !== "owner" && data.role !== "admin") {
      return <p className="text-sm text-muted-foreground">The owner is still setting this business up.</p>;
    }
    return <BusinessSetup projectId={projectId} name={projectName} onDone={reload} />;
  }
  const books = data.statements;
  const snapshot: LearnSnapshot = {
    name: projectName,
    currency,
    periodLabel: data.range.label,
    revenue: books.totalRevenue,
    grossProfit: books.grossProfit,
    ebitda: books.ebitda,
    depreciation: books.depreciation,
    interest: books.interest,
    tax: books.tax,
    netProfit: books.netProfit,
    cash: data.cash,
    receivable: data.receivable,
    payable: data.payable,
    gstPayable: data.gstPayable,
    ownerFunding: data.ownerFunding,
    totalAssets: books.totalAssets,
    totalLiabilities: books.totalLiabilities,
    totalEquity: books.totalEquity,
    operating: books.operating,
    investing: books.investing,
    financing: books.financing,
    invoices: data.invoices.map((invoice) => ({
      number: invoice.number,
      customer: invoice.customer_name,
      status: invoice.status,
      taxable: invoice.taxable_total,
      cgst: invoice.cgst_total,
      sgst: invoice.sgst_total,
      igst: invoice.igst_total,
      total: invoice.total,
      paid: invoice.amount_paid,
    })),
    holders: data.holders,
    change: data.change,
    runwayNote: data.runway.note,
  };
  function openLearn(page: string, concept?: string) {
    setFocusConcept(concept ?? null);
    setLearn(page);
  }
  const canEquity = data.role === "owner" || data.role === "admin";
  const canDev = data.role === "owner";
  const canWrite = data.role !== "viewer";
  const quiet = books.totalRevenue === "0.00" && data.expenses.length === 0;

  function open(next: Section) {
    setSection(next);
    setMore(false);
    setAdd(false);
  }

  return (
    <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
      <aside className="mb-4 hidden lg:block">
        <p className="px-3 text-[11px] tracking-wide text-muted-foreground uppercase">Business</p>
        <div className="mt-2 grid gap-1">
          <Side label="Overview" active={section === "home"} onClick={() => open("home")} />
          <Side label="Invoices" active={section === "invoices"} onClick={() => open("invoices")} />
          <Side label="Expenses" active={section === "expenses"} onClick={() => open("expenses")} />
          <Side label="Reports" active={section === "reports"} onClick={() => open("reports")} />
          {canEquity && <Side label="Equity" active={section === "equity"} onClick={() => open("equity")} />}
          <Side label="Money" active={section === "money"} onClick={() => open("money")} />
          <Side label="Vendors" active={section === "vendors"} onClick={() => open("vendors")} />
          <Side label="Bills" active={section === "bills"} onClick={() => open("bills")} />
          <Side label="Budgets" active={section === "budgets"} onClick={() => open("budgets")} />
          <Side label="Loans" active={section === "loans"} onClick={() => open("loans")} />
          <Side label="Assets" active={section === "assets"} onClick={() => open("assets")} />
          <Side label="Team" active={section === "team"} onClick={() => open("team")} />
          <Side label="Guide" active={section === "guide"} onClick={() => open("guide")} />
          {canDev && <Side label="Developer" active={section === "developer"} onClick={() => open("developer")} />}
        </div>
      </aside>
      <div className="min-w-0 space-y-4 pb-24">
        <div className="grid grid-cols-4 gap-2 lg:hidden">
          <Tab label="Overview" active={section === "home"} onClick={() => open("home")} />
          <Tab label="Sales" active={section === "invoices"} onClick={() => open("invoices")} />
          <Tab label="Expenses" active={section === "expenses"} onClick={() => open("expenses")} />
          <Tab label="More" active={more} onClick={() => setMore((value) => !value)} />
        </div>
        {more && (
          <div className="grid gap-2 rounded-xl bg-card p-3 lg:hidden">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Sales</p>
            <Tab label="Invoices" active={section === "invoices"} onClick={() => open("invoices")} />
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Business</p>
            <Tab label="Reports" active={section === "reports"} onClick={() => open("reports")} />
            {canEquity && <Tab label="Equity" active={section === "equity"} onClick={() => open("equity")} />}
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Manage</p>
            <Tab label="Money" active={section === "money"} onClick={() => open("money")} />
            <Tab label="Vendors" active={section === "vendors"} onClick={() => open("vendors")} />
            <Tab label="Bills" active={section === "bills"} onClick={() => open("bills")} />
            <Tab label="Budgets" active={section === "budgets"} onClick={() => open("budgets")} />
            <Tab label="Loans" active={section === "loans"} onClick={() => open("loans")} />
            <Tab label="Assets" active={section === "assets"} onClick={() => open("assets")} />
            <Tab label="Team" active={section === "team"} onClick={() => open("team")} />
            <Tab label="Guide" active={section === "guide"} onClick={() => open("guide")} />
            {canDev && <Tab label="Developer" active={section === "developer"} onClick={() => open("developer")} />}
          </div>
        )}
        {books.error && <p className="rounded-xl bg-card p-4 text-sm text-expense">{books.error}</p>}
        {section === "home" && (
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs tracking-wide text-muted-foreground uppercase">Business</p>
                <h2 className="font-display text-2xl">Here's how {projectName} is doing</h2>
              </div>
              <div className="flex items-center gap-2">
                <LearnButton compact onClick={() => openLearn("home")} />
                <select className="h-11 rounded-md bg-card px-3 text-sm" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Period">
                <option value="month">This month</option>
                <option value="last_month">Last month</option>
                <option value="quarter">This quarter</option>
                <option value="year">This financial year</option>
                </select>
              </div>
            </div>
            {showTip && (
              <p className="text-sm text-muted-foreground">
                New to business finance? Tap Learn anytime to understand a number.{" "}
                <button type="button" className="underline" onClick={() => { dismissLearnTip(); setShowTip(false); }}>Dismiss</button>
              </p>
            )}
            <div className="rounded-xl bg-card p-4">
              <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Cash available</p>
              <p className="mt-1 font-display text-3xl tabular">{formatMoney(data.cash, currency)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Money currently in cash and bank. Not the same as this period's sales.</p>
            </div>
            {quiet ? (
              <div className="rounded-xl bg-card p-4">
                <p className="font-medium">No sales yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Revenue {formatMoney(books.totalRevenue, currency)} · Profit {formatMoney(books.netProfit, currency)}. Starting money is not revenue.</p>
                <Button type="button" className="mt-3 h-11" onClick={() => open("invoices")}>Create your first invoice</Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Card label="Revenue" value={formatMoney(books.totalRevenue, currency)} hint="Money earned from sales this period, before expenses." onLearn={() => openLearn("home", "revenue")} />
                <Card label="Profit" value={formatMoney(books.netProfit, currency)} hint="What remains after business expenses, interest and taxes." onLearn={() => openLearn("home", "profit")} />
                <Card label="Money to collect" value={formatMoney(data.receivable, currency)} hint="Accounts receivable" onLearn={() => openLearn("home", "receivable")} />
                <Card label="Money to pay" value={formatMoney(data.payable, currency)} hint="Accounts payable" onLearn={() => openLearn("home", "payable")} />
              </div>
            )}
            {canWrite && (
              <Button type="button" variant="secondary" className="h-11" onClick={() => setMoney((value) => !value)}>Add money to business</Button>
            )}
            <p className="text-sm text-muted-foreground">{data.runway.note}{data.runway.months ? ` About ${data.runway.months} months.` : ""}</p>
            <Button type="button" variant="ghost" className="h-11 px-0" onClick={() => openLearn("home", "profit")}>Why did this change?</Button>
            {money && <AddMoney projectId={projectId} date={today} onSaved={reload} />}
          </div>
        )}
        {section === "invoices" && (
          <div className="space-y-3">
            <LearnButton onClick={() => openLearn("invoices")} />
            <InvoiceDesk projectId={projectId} currency={currency} />
          </div>
        )}
        {section === "expenses" && (
          <div className="space-y-3">
            <LearnButton onClick={() => openLearn("expenses")} />
            {data.expenses.length === 0 && (
              <div className="rounded-xl bg-card p-4">
                <p className="font-medium">No expenses yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Record money your business spends.</p>
              </div>
            )}
            {canWrite && <ExpensePanel projectId={projectId} date={today} currency={currency} accounts={data.expenseAccounts} expenses={data.expenses} onSaved={reload} />}
            {!canWrite && data.expenses.length > 0 && (
              <ul className="space-y-2">
                {data.expenses.map((row) => (
                  <li key={row.id} className="rounded-xl bg-card p-4 text-sm">{row.memo || "Expense"} · {formatMoney(row.amount, currency)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {section === "reports" && (
          <div className="space-y-3">
            <LearnButton onClick={() => openLearn("reports")} />
            <Reports books={books} currency={currency} onLearn={(concept) => openLearn("reports", concept)} />
          </div>
        )}
        {section === "equity" && canEquity && (
          <div className="space-y-3">
            <LearnButton onClick={() => openLearn("equity")} />
            <EquityPanel projectId={projectId} date={today} currency={currency} holders={data.holders} onSaved={reload} />
          </div>
        )}
        {(section === "vendors" || section === "bills" || section === "money" || section === "budgets" || section === "loans" || section === "assets") && (
          <div className="space-y-3">
            <LearnButton onClick={() => openLearn(section === "budgets" ? "reports" : "expenses")} />
            <BusinessOps projectId={projectId} mode={section} currency={currency} today={today} openingDone={data.openingDone} />
          </div>
        )}
        {section === "team" && (
          <div className="space-y-3">
            <LearnButton onClick={() => openLearn("team")} />
            <BusinessTeam projectId={projectId} name={projectName} />
          </div>
        )}
        {section === "guide" && (
          <div className="space-y-3">
            <h2 className="font-display text-2xl">Kharcha Business Guide</h2>
            <p className="text-sm text-muted-foreground">Search a term in plain language. Numbers in the panel come from this business.</p>
            <LearnButton onClick={() => openLearn("guide")} />
          </div>
        )}
        {section === "developer" && canDev && (
          <div className="space-y-3">
            <LearnButton onClick={() => openLearn("developer")} />
            <DeveloperPortal projectId={projectId} />
          </div>
        )}
        {canWrite && (
          <button type="button" className="fixed right-4 bottom-20 z-30 grid size-14 place-items-center rounded-full bg-foreground text-2xl text-background lg:bottom-8" onClick={() => setAdd(true)} aria-label="Add">
            +
          </button>
        )}
        {add && (
          <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl bg-card p-4 pb-8 shadow-[var(--elev-shadow)]">
            <p className="text-sm font-medium">Add</p>
            <div className="mt-3 grid gap-2">
              <Button type="button" variant="secondary" className="h-11" onClick={() => open("invoices")}>Create invoice</Button>
              <Button type="button" variant="secondary" className="h-11" onClick={() => open("expenses")}>Record expense</Button>
              <Button type="button" variant="secondary" className="h-11" onClick={() => { setMoney(true); open("home"); }}>Add money to business</Button>
            </div>
            <Button type="button" variant="ghost" className="mt-2 h-11 w-full" onClick={() => setAdd(false)}>Close</Button>
          </div>
        )}
        {learn && <LearnPanel page={learn} snapshot={snapshot} focusConcept={focusConcept} onClose={() => setLearn(null)} />}
      </div>
    </div>
  );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`h-11 rounded-md px-2 text-sm ${active ? "bg-foreground text-background" : "bg-card text-muted-foreground"}`}>
      {label}
    </button>
  );
}

function Side({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`h-11 rounded-md px-3 text-left text-sm ${active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-card"}`}>
      {label}
    </button>
  );
}

function AddMoney({ projectId, date, onSaved }: { projectId: string; date: string; onSaved: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [place, setPlace] = useState("bank");
  const [origin, setOrigin] = useState("founder");
  const [open, setOpen] = useState(false);
  return (
    <form
      className="grid gap-3 rounded-xl bg-card p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await postBusinessCapital({ data: { projectId, amount, date, place, origin, kind: "contribution" } });
          toast.success("Money added. It was not recorded as revenue.");
          setAmount("");
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't add that");
        }
      }}
    >
      <p className="text-sm font-medium">Add money to the business</p>
      <p className="text-sm text-muted-foreground">This is a new contribution, not the original starting balance.</p>
      <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" />
      <select className="h-11 rounded-md bg-secondary px-3" value={place} onChange={(event) => setPlace(event.target.value)}>
        <option value="bank">Bank account</option>
        <option value="cash">Cash</option>
        <option value="other">Other cash</option>
      </select>
      <select className="h-11 rounded-md bg-secondary px-3" value={origin} onChange={(event) => setOrigin(event.target.value)}>
        <option value="founder">Founder / owner investment</option>
        <option value="existing">Existing business balance</option>
        <option value="loan">Business loan</option>
        <option value="other">Other</option>
      </select>
      <button type="button" className="text-left text-sm text-muted-foreground underline" onClick={() => setOpen((value) => !value)}>View accounting details</button>
      {open && <p className="text-sm text-muted-foreground">The cash account increases. Owner capital, retained earnings, or a loan increases by the same amount. Sales do not.</p>}
      <Button type="submit" className="h-11">Add money</Button>
    </form>
  );
}

function Card({ label, value, hint, onLearn }: { label: string; value: string; hint?: string; onLearn?: () => void }) {
  return (
    <div className="rounded-xl bg-card p-4" title={hint}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
        {onLearn && (
          <button type="button" className="text-xs text-muted-foreground" aria-label={`Learn about ${label}`} onClick={onLearn}>💡</button>
        )}
      </div>
      <p className="mt-1 font-display text-xl tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function InvoicePanel({
  projectId,
  date,
  currency,
  invoices,
  onSaved,
}: {
  projectId: string;
  date: string;
  currency: string;
  invoices: { id: string; number: string; customer_name: string; total: string; amount_paid: string; status: string }[];
  onSaved: () => Promise<void>;
}) {
  const [customer, setCustomer] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <form
        className="grid gap-3 rounded-xl bg-card p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await postBusinessInvoice({ data: { projectId, customer, subtotal: amount, date } });
            setCustomer("");
            setAmount("");
            toast.success("Invoice issued. Revenue and receivable posted once.");
            await onSaved();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't invoice");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Label htmlFor="cust">Customer</Label>
        <Input id="cust" value={customer} onChange={(event) => setCustomer(event.target.value)} />
        <Label htmlFor="inv-amt">Amount</Label>
        <Input id="inv-amt" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Button type="submit" disabled={busy}>Issue invoice</Button>
      </form>
      {invoices.map((invoice) => (
        <div key={invoice.id} className="rounded-xl bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-medium">{invoice.number}</p>
            <p className="text-xs capitalize text-muted-foreground">{invoice.status.replaceAll("_", " ")}</p>
          </div>
          <p className="text-sm text-muted-foreground">{invoice.customer_name}</p>
          <p className="mt-1 tabular">{formatMoney(invoice.total, currency)}</p>
          {invoice.status !== "paid" && invoice.status !== "void" && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3 h-11"
              onClick={async () => {
                const open = fromCents(toCents(invoice.total) - toCents(invoice.amount_paid));
                try {
                  await postBusinessPayment({ data: { projectId, invoiceId: invoice.id, amount: open, date } });
                  toast.success("Payment posted to cash. Revenue was not counted again.");
                  await onSaved();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Couldn't collect");
                }
              }}
            >
              Mark paid
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function ExpensePanel({
  projectId,
  date,
  currency,
  accounts,
  expenses,
  onSaved,
}: {
  projectId: string;
  date: string;
  currency: string;
  accounts: { code: string; name: string }[];
  expenses: { id: string; account_code: string; amount: string; memo: string | null; paid: boolean }[];
  onSaved: () => Promise<void>;
}) {
  const [code, setCode] = useState("5400");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <form
        className="grid gap-3 rounded-xl bg-card p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await postBusinessExpense({ data: { projectId, code, amount, date, memo, paid: true } });
            setAmount("");
            setMemo("");
            toast.success("Expense posted against the bank");
            await onSaved();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't post");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Label>Account</Label>
        <select className="h-11 rounded-md bg-secondary px-3" value={code} onChange={(event) => setCode(event.target.value)}>
          {accounts.map((account) => (
            <option key={account.code} value={account.code}>{account.code} {account.name}</option>
          ))}
        </select>
        <Label htmlFor="exp-amt">Amount</Label>
        <Input id="exp-amt" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Label htmlFor="exp-memo">Note</Label>
        <Input id="exp-memo" value={memo} onChange={(event) => setMemo(event.target.value)} />
        <Button type="submit" disabled={busy}>Post paid expense</Button>
      </form>
      {expenses.map((expense) => (
        <p key={expense.id} className="rounded-xl bg-card p-4 text-sm">
          {expense.account_code} · {formatMoney(expense.amount, currency)} {expense.memo ? `· ${expense.memo}` : ""}
        </p>
      ))}
    </div>
  );
}

function Reports({
  books,
  currency,
  onLearn,
}: {
  books: {
    ok: boolean;
    totalRevenue: string;
    grossProfit: string;
    ebitda: string;
    ebit: string;
    profitBeforeTax: string;
    netProfit: string;
    opex: { name: string; amount: string }[];
    totalAssets: string;
    totalLiabilities: string;
    totalEquity: string;
    openingCash: string;
    operating: string;
    investing: string;
    financing: string;
    closingCash: string;
    trialDebit: string;
    trialCredit: string;
    assets: { name: string; amount: string }[];
    liabilities: { name: string; amount: string }[];
    equity: { name: string; amount: string }[];
    currentEarnings: string;
  };
  currency: string;
  onLearn?: (concept: string) => void;
}) {
  const money = (value: string) => formatMoney(value, currency);
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <p className="text-sm text-muted-foreground">Business performance. Profit and loss is what you earned and spent. The balance sheet is what the business owns and owes.</p>
      <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Profit and loss</h2>
        <Line label="Revenue" value={money(books.totalRevenue)} hint="Money earned from sales before expenses." />
        <Line label="Gross profit" value={money(books.grossProfit)} hint={METRIC_HELP["Gross Profit"]} />
        {books.opex.map((row) => (
          <Line key={row.name} label={row.name} value={money(row.amount)} />
        ))}
        <Line label="Operating profit" value={money(books.ebitda)} hint="Profit from normal operations before interest, tax and depreciation. Also called EBITDA." onLearn={onLearn ? () => onLearn("ebitda") : undefined} />
        <Line label="EBIT" value={money(books.ebit)} hint={METRIC_HELP.EBIT} />
        <Line label="Profit before tax" value={money(books.profitBeforeTax)} hint={METRIC_HELP["Profit Before Tax"]} />
        <Line label="Net profit" value={money(books.netProfit)} hint={METRIC_HELP["Net Profit"]} />
      </section>
      <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Balance sheet</h2>
        {books.assets.map((row) => <Line key={row.name} label={row.name} value={money(row.amount)} />)}
        <Line label="Total assets" value={money(books.totalAssets)} />
        {books.liabilities.map((row) => <Line key={row.name} label={row.name} value={money(row.amount)} />)}
        <Line label="Total liabilities" value={money(books.totalLiabilities)} />
        {books.equity.map((row) => <Line key={row.name} label={row.name} value={money(row.amount)} />)}
        <Line label="Current earnings" value={money(books.currentEarnings)} />
        <Line label="Total equity" value={money(books.totalEquity)} />
        <p className="mt-2 text-xs text-muted-foreground">{books.ok ? "Assets equal liabilities plus equity." : "Out of balance."}</p>
      </section>
      <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Cash flow</h2>
        <Line label="Opening cash" value={money(books.openingCash)} />
        <Line label="Operating" value={money(books.operating)} />
        <Line label="Investing" value={money(books.investing)} />
        <Line label="Financing" value={money(books.financing)} />
        <Line label="Closing cash" value={money(books.closingCash)} />
        <p className="mt-2 text-xs text-muted-foreground">Profit is not cash. Collections move cash. Unpaid invoices do not.</p>
      </section>
      <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Trial balance</h2>
        <Line label="Debits" value={money(books.trialDebit)} />
        <Line label="Credits" value={money(books.trialCredit)} />
      </section>
    </div>
  );
}

function Line({ label, value, hint, onLearn }: { label: string; value: string; hint?: string; onLearn?: () => void }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm" title={hint}>
      <span>
        {label}
        {onLearn && (
          <button type="button" className="ml-2 text-xs text-muted-foreground" aria-label={`Learn about ${label}`} onClick={onLearn}>💡</button>
        )}
      </span>
      <span className="tabular">{value}</span>
    </div>
  );
}

function EquityPanel({
  projectId,
  date,
  holders,
  onSaved,
  currency,
}: {
  projectId: string;
  date: string;
  currency: string;
  holders: { name: string; shares: string; bps: string }[];
  onSaved: () => Promise<void>;
}) {
  const [holder, setHolder] = useState("");
  const [shares, setShares] = useState("");
  const [amount, setAmount] = useState("");
  const [investment, setInvestment] = useState("5000000");
  const [preMoney, setPreMoney] = useState("45000000");
  const [sim, setSim] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-card p-4">
        {holders.length === 0 ? <p className="text-sm text-muted-foreground">No shares issued yet.</p> : holders.map((row) => (
          <p key={row.name} className="flex justify-between py-1 text-sm">
            <span>{row.name}</span>
            <span className="tabular">{row.shares} · {(Number(row.bps) / 100).toFixed(2)}%</span>
          </p>
        ))}
      </div>
      <form
        className="grid gap-3 rounded-xl bg-card p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await postBusinessShares({ data: { projectId, holder, shares: Number(shares), amount: amount || null, date } });
            setHolder("");
            setShares("");
            setAmount("");
            toast.success("Issuance recorded");
            await onSaved();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't issue");
          }
        }}
      >
        <Label htmlFor="holder">Shareholder</Label>
        <Input id="holder" value={holder} onChange={(event) => setHolder(event.target.value)} />
        <Label htmlFor="shares">Shares</Label>
        <Input id="shares" inputMode="numeric" value={shares} onChange={(event) => setShares(event.target.value)} />
        <Label htmlFor="paid-in">Amount paid in, optional</Label>
        <Input id="paid-in" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Button type="submit">Issue shares</Button>
      </form>
      <form
        className="grid gap-3 rounded-xl bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const round = simulateRound(
              holders.map((row) => ({ name: row.name, shares: BigInt(row.shares) })),
              toCents(investment),
              toCents(preMoney),
            );
            setSim(`${round.holders.map((row) => `${row.name} ${(Number(row.bps) / 100).toFixed(2)}%`).join(" · ")}. Post-money ${formatMoney(fromCents(round.postMoney), currency)}. Not saved.`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Can't simulate");
          }
        }}
      >
        <p className="text-sm font-medium">Dilution simulator</p>
        <p className="text-sm text-muted-foreground">This does not change the cap table.</p>
        <Label htmlFor="invest">Investment</Label>
        <Input id="invest" value={investment} onChange={(event) => setInvestment(event.target.value)} />
        <Label htmlFor="pre">Pre-money valuation</Label>
        <Input id="pre" value={preMoney} onChange={(event) => setPreMoney(event.target.value)} />
        <Button type="submit" variant="secondary">Simulate</Button>
        {sim && <p className="text-sm">{sim}</p>}
      </form>
    </div>
  );
}

function ApiPanel({
  projectId,
  keys,
  onSaved,
}: {
  projectId: string;
  keys: { id: string; name: string; prefix: string; environment: string; revoked: boolean }[];
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["invoices:create", "payments:create", "reports:read"]);
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <form
        className="grid gap-3 rounded-xl bg-card p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const saved = await createBusinessApiKey({ data: { projectId, name, environment: "test", scopes } });
            setToken(saved?.token ?? null);
            setName("");
            toast.success("Copy the key now. It will not be shown again.");
            await onSaved();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't create a key");
          }
        }}
      >
        <p className="text-sm font-medium">API key</p>
        <p className="text-sm text-muted-foreground">Only a hash is stored. Equity and team changes are not available on the API.</p>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Crodlin Production" />
        <div className="grid gap-2">
          {SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(event) => {
                  setScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope));
                }}
              />
              {scope}
            </label>
          ))}
        </div>
        <Button type="submit">Create test key</Button>
        {token && <p className="break-all rounded-md bg-secondary p-3 text-xs">{token}</p>}
      </form>
      {keys.map((key) => (
        <div key={key.id} className="flex items-center justify-between gap-3 rounded-xl bg-card p-4">
          <div>
            <p className="text-sm font-medium">{key.name}</p>
            <p className="text-xs text-muted-foreground">{key.prefix}… · {key.environment}{key.revoked ? " · revoked" : ""}</p>
          </div>
          {!key.revoked && (
            <Button type="button" variant="ghost" className="text-expense" onClick={async () => {
              await revokeBusinessApiKey({ data: { projectId, keyId: key.id } });
              await onSaved();
            }}>Revoke</Button>
          )}
        </div>
      ))}
    </div>
  );
}
