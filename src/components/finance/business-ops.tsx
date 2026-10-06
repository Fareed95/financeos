import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import {
  buyAsset,
  createRecurringDraft,
  getOpsDesk,
  payBill,
  postAssetDepreciation,
  postFullOpening,
  receiveLoan,
  repayLoan,
  saveBill,
  saveBudget,
  saveRecurring,
  saveVendor,
} from "@/lib/server/ops";

type Desk = NonNullable<Awaited<ReturnType<typeof getOpsDesk>>>;

export function BusinessOps({
  projectId,
  mode,
  currency,
  today,
  openingDone,
}: {
  projectId: string;
  mode: "vendors" | "bills" | "money" | "budgets" | "loans" | "assets";
  currency: string;
  today: string;
  openingDone: boolean;
}) {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState("");
  async function load() {
    const next = await getOpsDesk({ data: { projectId, today } });
    setDesk(next);
  }
  useEffect(() => {
    let live = true;
    getOpsDesk({ data: { projectId, today } }).then((next) => {
      if (live) setDesk(next);
    }).catch((err: Error) => setError(err.message));
    return () => {
      live = false;
    };
  }, [projectId, today]);
  if (!desk) return <p className="text-sm text-muted-foreground">{error || "Loading…"}</p>;
  const money = (value: string) => formatMoney(value, currency);
  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {mode === "vendors" && <Vendors desk={desk} projectId={projectId} money={money} onSaved={load} />}
      {mode === "bills" && <Bills desk={desk} projectId={projectId} today={today} money={money} onSaved={load} />}
      {mode === "money" && <Money desk={desk} currency={currency} projectId={projectId} today={today} openingDone={openingDone} onSaved={load} />}
      {mode === "budgets" && <Budgets desk={desk} projectId={projectId} today={today} money={money} onSaved={load} />}
      {mode === "loans" && <Loans desk={desk} projectId={projectId} today={today} money={money} onSaved={load} />}
      {mode === "assets" && <Assets desk={desk} projectId={projectId} today={today} money={money} onSaved={load} />}
    </div>
  );
}

function Vendors({ desk, projectId, money, onSaved }: { desk: Desk; projectId: string; money: (value: string) => string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [legal, setLegal] = useState("");
  const [type, setType] = useState("company");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [terms, setTerms] = useState("30");
  const [state, setState] = useState("MH");
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Who does the business pay?</h2>
      {desk.vendors.length === 0 && <p className="text-sm text-muted-foreground">No vendors yet.</p>}
      {desk.vendors.map((vendor) => (
        <article key={vendor.id} className="rounded-xl bg-card p-4">
          <p className="font-medium">{vendor.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">Spent {money(vendor.spent)} · Due {money(vendor.due)} · Overdue {money(vendor.overdue)}</p>
        </article>
      ))}
      {desk.canVendors && (
        <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
          event.preventDefault();
          await saveVendor({ data: { projectId, displayName: name, legalName: legal, vendorType: type, email, phone, gstin, paymentTerms: terms, stateCode: state } });
          setName("");
          await onSaved();
        }}>
          <Input className="h-11" placeholder="Display name" value={name} onChange={(event) => setName(event.target.value)} required />
          <Input className="h-11" placeholder="Legal name" value={legal} onChange={(event) => setLegal(event.target.value)} />
          <select className="h-11 rounded-md bg-secondary px-3" value={type} onChange={(event) => setType(event.target.value)} aria-label="Vendor type">
            {["individual", "company", "contractor", "supplier", "other"].map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <Input className="h-11" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <Input className="h-11" placeholder="Phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
          <Input className="h-11" placeholder="GSTIN" value={gstin} onChange={(event) => setGstin(event.target.value)} />
          <select className="h-11 rounded-md bg-secondary px-3" value={terms} onChange={(event) => setTerms(event.target.value)} aria-label="Payment terms">
            {["0", "7", "15", "30", "45", "60"].map((option) => <option key={option} value={option}>{option === "0" ? "Due on receipt" : `${option} days`}</option>)}
          </select>
          <Input className="h-11" placeholder="State code" value={state} onChange={(event) => setState(event.target.value)} aria-label="State code" />
          <Button type="submit" className="h-11">Add vendor</Button>
        </form>
      )}
    </div>
  );
}

function Bills({ desk, projectId, today, money, onSaved }: { desk: Desk; projectId: string; today: string; money: (value: string) => string; onSaved: () => Promise<void> }) {
  const [vendorId, setVendorId] = useState(desk.vendors[0]?.id || "");
  const [rate, setRate] = useState("");
  const [gst, setGst] = useState(18);
  const [paid, setPaid] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payId, setPayId] = useState("");
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Bills</h2>
      <p className="text-sm text-muted-foreground">Already paid is an expense now. Pay later becomes money you owe. Input GST is tracked, not a guaranteed credit.</p>
      {desk.bills.map((bill) => (
        <article key={String(bill.id)} className="rounded-xl bg-card p-4 text-sm">
          <p className="font-medium">{String(bill.vendor)}</p>
          <p className="text-muted-foreground">{String(bill.status)} · {money(String(bill.total))} · paid {money(String(bill.amount_paid))}</p>
        </article>
      ))}
      {desk.canBills && (
        <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
          event.preventDefault();
          const saved = await saveBill({ data: { projectId, vendorId, billDate: today, dueDate: today, placeOfSupply: desk.sellerState, expenseCode: "5400", description: "Software", quantity: "1", rate, gstRate: gst, post: true } });
          if (paid && saved && "total" in saved) {
            await payBill({ data: { projectId, billId: saved.id, amount: saved.total, date: today, method: "bank", accountCode: "1010" } });
          }
          setRate("");
          await onSaved();
        }}>
          <select className="h-11 rounded-md bg-secondary px-3" value={vendorId} onChange={(event) => setVendorId(event.target.value)} aria-label="Vendor">
            {desk.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
          </select>
          <Input className="h-11" inputMode="decimal" placeholder="Taxable amount" value={rate} onChange={(event) => setRate(event.target.value)} required />
          <select className="h-11 rounded-md bg-secondary px-3" value={gst} onChange={(event) => setGst(Number(event.target.value))} aria-label="GST rate">
            {[0, 5, 12, 18, 28].map((rateOption) => <option key={rateOption} value={rateOption}>{rateOption}%</option>)}
          </select>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> Already paid</label>
          <Button type="submit" className="h-11">{paid ? "Record paid expense" : "I need to pay later"}</Button>
        </form>
      )}
      {desk.canPay && (
        <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
          event.preventDefault();
          await payBill({ data: { projectId, billId: payId, amount: payAmount, date: today, method: "bank", accountCode: "1010" } });
          setPayAmount("");
          await onSaved();
        }}>
          <select className="h-11 rounded-md bg-secondary px-3" value={payId} onChange={(event) => setPayId(event.target.value)} aria-label="Bill to pay">
            <option value="">Choose a bill</option>
            {desk.bills.map((bill) => <option key={String(bill.id)} value={String(bill.id)}>{String(bill.vendor)} {String(bill.status)}</option>)}
          </select>
          <Input className="h-11" inputMode="decimal" placeholder="Amount to pay" value={payAmount} onChange={(event) => setPayAmount(event.target.value)} required />
          <Button type="submit" className="h-11" variant="secondary">Record payment</Button>
        </form>
      )}
      {desk.canBills && <Recurring projectId={projectId} desk={desk} today={today} onSaved={onSaved} />}
    </div>
  );
}

function Recurring({ projectId, desk, today, onSaved }: { projectId: string; desk: Desk; today: string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
      event.preventDefault();
      await saveRecurring({ data: { projectId, name, amount, expenseCode: "5400", frequency: "monthly", nextDate: today, kind: "bill" } });
      setName("");
      await onSaved();
    }}>
      <p className="text-sm font-medium">Upcoming costs</p>
      <p className="text-xs text-muted-foreground">Creating the next one makes a draft. Nothing is posted until you post the bill.</p>
      {(desk.recurring as { id: string; name: string; next_date: string; amount: string }[]).map((rule) => (
        <div key={rule.id} className="flex items-center justify-between gap-2 text-sm">
          <span>{rule.name} · {rule.next_date.slice(0, 10)}</span>
          {desk.vendors[0] && (
            <Button type="button" variant="secondary" className="h-9" onClick={async () => {
              await createRecurringDraft({ data: { projectId, id: rule.id, vendorId: desk.vendors[0]!.id } });
              await onSaved();
            }}>Create draft</Button>
          )}
        </div>
      ))}
      <Input className="h-11" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} required />
      <Input className="h-11" inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} required />
      <Button type="submit" variant="secondary" className="h-11">Save monthly reminder</Button>
    </form>
  );
}

function Money({ desk, projectId, today, openingDone, onSaved }: { desk: Desk; currency: string; projectId: string; today: string; openingDone: boolean; onSaved: () => Promise<void> }) {
  const [cash, setCash] = useState("");
  const [bank, setBank] = useState("");
  const [receivable, setReceivable] = useState("");
  const [payable, setPayable] = useState("");
  const [loan, setLoan] = useState("");
  const buckets = ["current", "1-30", "31-60", "61-90", "90+"] as const;
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Money in and money out</h2>
      <section className="rounded-xl bg-card p-4">
        <p className="text-sm font-medium">Money to collect</p>
        {buckets.map((bucket) => <p key={bucket} className="text-sm text-muted-foreground">{bucket}: {String(desk.money.collect[bucket] ?? "0.00")}</p>)}
        {desk.money.collectRows.map((row) => <p key={row.ref} className="mt-1 text-sm">{row.who} · {row.open} · due {row.due}</p>)}
      </section>
      <section className="rounded-xl bg-card p-4">
        <p className="text-sm font-medium">Money to pay</p>
        <p className="text-xs text-muted-foreground">Accounts payable</p>
        {buckets.map((bucket) => <p key={bucket} className="text-sm text-muted-foreground">{bucket}: {String(desk.money.pay[bucket] ?? "0.00")}</p>)}
        {desk.money.payRows.map((row) => <p key={row.ref} className="mt-1 text-sm">{row.who} · {row.open} · due {row.due}</p>)}
      </section>
      {!openingDone && (
        <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
          event.preventDefault();
          await postFullOpening({ data: { projectId, date: today, cash, bank, receivable, payable, loan, assets: "0" } });
          await onSaved();
        }}>
          <p className="text-sm font-medium">Set up full opening balances</p>
          <p className="text-xs text-muted-foreground">Equity is the amount that makes the books balance. You do not enter debits and credits.</p>
          <Input className="h-11" inputMode="decimal" placeholder="Cash" value={cash} onChange={(event) => setCash(event.target.value)} aria-label="Cash" />
          <Input className="h-11" inputMode="decimal" placeholder="Bank" value={bank} onChange={(event) => setBank(event.target.value)} aria-label="Bank" />
          <Input className="h-11" inputMode="decimal" placeholder="Customers owe you" value={receivable} onChange={(event) => setReceivable(event.target.value)} aria-label="Customers owe you" />
          <Input className="h-11" inputMode="decimal" placeholder="You owe vendors" value={payable} onChange={(event) => setPayable(event.target.value)} aria-label="You owe vendors" />
          <Input className="h-11" inputMode="decimal" placeholder="Loans" value={loan} onChange={(event) => setLoan(event.target.value)} aria-label="Loans" />
          <Button type="submit" className="h-11">Post opening balances</Button>
        </form>
      )}
    </div>
  );
}

function Budgets({ desk, projectId, today, money, onSaved }: { desk: Desk; projectId: string; today: string; money: (value: string) => string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Budget versus actual</h2>
      <p className="text-sm text-muted-foreground">A budget is the plan. Actual is what the books already posted.</p>
      {desk.budgets.map((budget) => (
        <article key={budget.id} className="rounded-xl bg-card p-4 text-sm">
          <p className="font-medium">{budget.name}</p>
          <p>Budget {money(budget.budget)} · Actual {money(budget.actual)} · {budget.over ? "Over" : "Remaining"} {money(budget.remaining)}</p>
        </article>
      ))}
      {desk.canBudgets && (
        <form className="grid gap-2" onSubmit={async (event) => {
          event.preventDefault();
          await saveBudget({ data: { projectId, name, kind: "expense", accountCode: "5400", amount, period: "month", periodStart: today.slice(0, 8) + "01" } });
          setName("");
          await onSaved();
        }}>
          <Input className="h-11" placeholder="Budget name" value={name} onChange={(event) => setName(event.target.value)} required />
          <Input className="h-11" inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          <Button type="submit" className="h-11">Save budget</Button>
        </form>
      )}
    </div>
  );
}

function Loans({ desk, projectId, today, money, onSaved }: { desk: Desk; projectId: string; today: string; money: (value: string) => string; onSaved: () => Promise<void> }) {
  const [lender, setLender] = useState("");
  const [principal, setPrincipal] = useState("");
  const [loanId, setLoanId] = useState("");
  const [payPrincipal, setPayPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Loans</h2>
      <p className="text-sm text-muted-foreground">Money you borrow is not revenue. Only the interest part of a repayment is an expense.</p>
      {(desk.loans as { id: string; lender: string; outstanding: string }[]).map((loan) => (
        <article key={loan.id} className="rounded-xl bg-card p-4 text-sm">{loan.lender} · outstanding {money(loan.outstanding)}</article>
      ))}
      {desk.canLoans && (
        <>
          <form className="grid gap-2" onSubmit={async (event) => {
            event.preventDefault();
            await receiveLoan({ data: { projectId, lender, principal, date: today, accountCode: "1010" } });
            setLender("");
            await onSaved();
          }}>
            <Input className="h-11" placeholder="Lender" value={lender} onChange={(event) => setLender(event.target.value)} required />
            <Input className="h-11" inputMode="decimal" placeholder="Amount received" value={principal} onChange={(event) => setPrincipal(event.target.value)} required />
            <Button type="submit" className="h-11">Record loan received</Button>
          </form>
          <form className="grid gap-2" onSubmit={async (event) => {
            event.preventDefault();
            await repayLoan({ data: { projectId, loanId, date: today, principal: payPrincipal, interest, accountCode: "1010" } });
            await onSaved();
          }}>
            <select className="h-11 rounded-md bg-secondary px-3" value={loanId} onChange={(event) => setLoanId(event.target.value)} aria-label="Loan">
              <option value="">Choose a loan</option>
              {(desk.loans as { id: string; lender: string }[]).map((loan) => <option key={loan.id} value={loan.id}>{loan.lender}</option>)}
            </select>
            <Input className="h-11" inputMode="decimal" placeholder="Principal" value={payPrincipal} onChange={(event) => setPayPrincipal(event.target.value)} />
            <Input className="h-11" inputMode="decimal" placeholder="Interest" value={interest} onChange={(event) => setInterest(event.target.value)} />
            <Button type="submit" variant="secondary" className="h-11">Record repayment</Button>
          </form>
        </>
      )}
    </div>
  );
}

function Assets({ desk, projectId, today, money, onSaved }: { desk: Desk; projectId: string; today: string; money: (value: string) => string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Assets</h2>
      <p className="text-sm text-muted-foreground">Choose asset only when the purchase should not be an expense today. Depreciation is posted when you ask.</p>
      {(desk.assets as { id: string; name: string; cost: string; life_months: number }[]).map((asset) => (
        <article key={asset.id} className="flex items-center justify-between gap-2 rounded-xl bg-card p-4 text-sm">
          <span>{asset.name} · {money(asset.cost)}</span>
          {desk.canAssets && <Button type="button" variant="secondary" className="h-9" onClick={async () => { await postAssetDepreciation({ data: { projectId, assetId: asset.id, date: today } }); await onSaved(); }}>Post depreciation</Button>}
        </article>
      ))}
      {desk.canAssets && (
        <form className="grid gap-2" onSubmit={async (event) => {
          event.preventDefault();
          await buyAsset({ data: { projectId, name, category: "Computer", date: today, cost, residual: "0", lifeMonths: 36, paid: true, accountCode: "1010" } });
          setName("");
          await onSaved();
        }}>
          <Input className="h-11" placeholder="Asset name" value={name} onChange={(event) => setName(event.target.value)} required />
          <Input className="h-11" inputMode="decimal" placeholder="Cost" value={cost} onChange={(event) => setCost(event.target.value)} required />
          <Button type="submit" className="h-11">Record as asset</Button>
        </form>
      )}
    </div>
  );
}
