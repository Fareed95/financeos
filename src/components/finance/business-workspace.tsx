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

const TABS = ["Overview", "Invoices", "Expenses", "Reports", "Equity", "Developer"] as const;

export function BusinessWorkspace({ projectId, currency }: { projectId: string; currency: string }) {
  const today = todayISO();
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const q = useQuery({
    queryKey: ["business", projectId, today],
    queryFn: () => getBusiness({ data: { projectId, today } }),
  });

  async function reload() {
    await qc.invalidateQueries({ queryKey: ["business", projectId] });
  }

  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading the books…</p>;
  if (q.error || !q.data) return <p className="text-sm text-expense">Couldn't load this business.</p>;
  const data = q.data;
  const books = data.statements;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`h-11 shrink-0 rounded-full px-4 text-sm font-medium ${tab === item ? "bg-foreground text-background" : "bg-card text-muted-foreground"}`}
          >
            {item}
          </button>
        ))}
      </div>
      {books.error && <p className="rounded-xl bg-card p-4 text-sm text-expense">{books.error}</p>}
      {tab === "Overview" && (
        <div className="space-y-4">
          {!books.hasActivity ? (
            <p className="rounded-xl bg-card p-4 text-sm text-muted-foreground">Insufficient data. Record opening capital to start the books.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Card label="Revenue" value={formatMoney(books.totalRevenue, currency)} hint="This financial year" />
              <Card label="EBITDA" value={formatMoney(books.ebitda, currency)} hint={METRIC_HELP.EBITDA} />
              <Card label="Net Profit" value={formatMoney(books.netProfit, currency)} hint={METRIC_HELP["Net Profit"]} />
              <Card label="Cash" value={formatMoney(books.closingCash, currency)} hint="Bank and cash accounts" />
            </div>
          )}
          <CapitalForm projectId={projectId} date={today} onSaved={reload} />
        </div>
      )}
      {tab === "Invoices" && <InvoiceDesk projectId={projectId} currency={currency} />}
      {tab === "Expenses" && (
        <ExpensePanel projectId={projectId} date={today} currency={currency} accounts={data.expenseAccounts} expenses={data.expenses} onSaved={reload} />
      )}
      {tab === "Reports" && <Reports books={books} currency={currency} />}
      {tab === "Equity" && <EquityPanel projectId={projectId} date={today} currency={currency} holders={data.holders} onSaved={reload} />}
      {tab === "Developer" && <DeveloperPortal projectId={projectId} />}
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]" title={hint}>
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-display text-xl tabular">{value}</p>
    </div>
  );
}

function CapitalForm({ projectId, date, onSaved }: { projectId: string; date: string; onSaved: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3 rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await postBusinessCapital({ data: { projectId, amount, date } });
          setAmount("");
          toast.success("Capital posted to the bank and share capital");
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't post");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm font-medium">Opening capital</p>
      <p className="text-sm text-muted-foreground">Debit bank, credit share capital. This is not revenue.</p>
      <Label htmlFor="capital">Amount</Label>
      <Input id="capital" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <Button type="submit" disabled={busy}>{busy ? "Posting…" : "Post capital"}</Button>
    </form>
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
}) {
  const money = (value: string) => formatMoney(value, currency);
  return (
    <div className="space-y-3">
      <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Profit and loss</h2>
        <Line label="Revenue" value={money(books.totalRevenue)} />
        <Line label="Gross profit" value={money(books.grossProfit)} hint={METRIC_HELP["Gross Profit"]} />
        {books.opex.map((row) => (
          <Line key={row.name} label={row.name} value={money(row.amount)} />
        ))}
        <Line label="EBITDA" value={money(books.ebitda)} hint={METRIC_HELP.EBITDA} />
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

function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm" title={hint}>
      <span>{label}</span>
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
