import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, subMoney } from "@/lib/money";
import { explainPurchaseBill } from "@/lib/learn-explain";
import {
  addBillAttachment,
  buyAsset,
  createRecurringDraft,
  getAssetDetail,
  getLoanDetail,
  getOpsDesk,
  getVendorDetail,
  listBillAttachments,
  payBill,
  postAssetDepreciation,
  postFullOpening,
  readBillAttachment,
  receiveLoan,
  removeBillAttachment,
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
  const [address, setAddress] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"Overview" | "Bills" | "Payments" | "Activity">("Overview");
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getVendorDetail>> | null>(null);
  async function open(id: string) {
    setOpenId(id);
    setTab("Overview");
    setDetail(await getVendorDetail({ data: { projectId, vendorId: id } }));
  }
  if (detail && openId) {
    const tabs = ["Overview", "Bills", "Payments", "Activity"] as const;
    return (
      <div className="space-y-3">
        <button type="button" className="min-h-11 text-sm text-muted-foreground" onClick={() => setDetail(null)}>Back to vendors</button>
        <h2 className="font-display text-2xl">{detail.vendor.display_name}</h2>
        <div className="grid grid-cols-2 gap-2">
          <p className="rounded-xl bg-card p-3 text-sm">Spent<span className="mt-1 block font-medium">{money(detail.spent)}</span></p>
          <p className="rounded-xl bg-card p-3 text-sm">Outstanding<span className="mt-1 block font-medium">{money(detail.due)}</span></p>
          <p className="rounded-xl bg-card p-3 text-sm">Overdue<span className="mt-1 block font-medium">{money(detail.overdue)}</span></p>
          <p className="rounded-xl bg-card p-3 text-sm">Last payment<span className="mt-1 block font-medium">{detail.lastPayment || "None"}</span></p>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {tabs.map((item) => (
            <button key={item} type="button" className={`h-11 shrink-0 rounded-full px-4 text-sm ${tab === item ? "bg-foreground text-background" : "bg-card"}`} onClick={() => setTab(item)}>{item}</button>
          ))}
        </div>
        {tab === "Overview" && (
          <section className="rounded-xl bg-card p-4 text-sm">
            <p>{detail.vendor.legal_name || detail.vendor.display_name} · {detail.vendor.vendor_type}</p>
            <p className="mt-2">GSTIN {detail.vendor.gstin || "Not added"}</p>
            <p className="mt-1">{[detail.vendor.email, detail.vendor.phone].filter(Boolean).join(" · ") || "No contact yet"}</p>
            <p className="mt-1">Payment terms {detail.vendor.payment_terms === "0" ? "Due on receipt" : `${detail.vendor.payment_terms} days`}</p>
            <p className="mt-1">{[detail.vendor.billing_address, detail.vendor.city, detail.vendor.state_code].filter(Boolean).join(", ") || "No address yet"}</p>
          </section>
        )}
        {tab === "Bills" && (
          <section className="space-y-2">
            {detail.bills.length === 0 && <p className="text-sm text-muted-foreground">No bills yet.</p>}
            {detail.bills.map((bill) => (
              <article key={bill.id} className="rounded-xl bg-card p-4 text-sm">
                <p className="font-medium">{bill.vendor_bill_number || bill.id.slice(0, 8)}</p>
                <p>{bill.bill_date} · due {bill.due_date}</p>
                <p>Total {money(bill.total)} · Paid {money(bill.amount_paid)} · Balance {money(bill.balance)} · {bill.status}</p>
              </article>
            ))}
          </section>
        )}
        {tab === "Payments" && (
          <section className="space-y-2">
            {detail.payments.length === 0 && <p className="text-sm text-muted-foreground">No payments yet.</p>}
            {detail.payments.map((payment) => (
              <article key={payment.id} className="rounded-xl bg-card p-4 text-sm">
                <p>{payment.paid_on} · {money(payment.amount)}</p>
                <p className="text-muted-foreground">{payment.method} · {payment.reference || "No reference"} · bill {payment.bill_id.slice(0, 8)}</p>
              </article>
            ))}
          </section>
        )}
        {tab === "Activity" && (
          <section className="rounded-xl bg-card p-4 text-sm">
            {detail.activity.length === 0 && <p className="text-muted-foreground">No activity yet.</p>}
            {detail.activity.map((row) => (
              <p key={row.created_at + row.action} className="py-1">{row.label}{row.actor ? ` · ${row.actor}` : ""}</p>
            ))}
          </section>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Who does the business pay?</h2>
      {desk.vendors.length === 0 && <p className="text-sm text-muted-foreground">No vendors yet.</p>}
      {desk.vendors.map((vendor) => (
        <button key={vendor.id} type="button" className="block w-full rounded-xl bg-card p-4 text-left" onClick={() => open(vendor.id)}>
          <p className="font-medium">{vendor.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">Spent {money(vendor.spent)} · Due {money(vendor.due)} · Overdue {money(vendor.overdue)}</p>
        </button>
      ))}
      {desk.canVendors && (
        <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
          event.preventDefault();
          await saveVendor({ data: { projectId, displayName: name, legalName: legal, vendorType: type, email, phone, gstin, paymentTerms: terms, stateCode: state, billingAddress: address } });
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
          <Input className="h-11" placeholder="Address" value={address} onChange={(event) => setAddress(event.target.value)} />
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
  const [openBill, setOpenBill] = useState<(typeof desk.bills)[number] | null>(null);
  const [files, setFiles] = useState<Awaited<ReturnType<typeof listBillAttachments>>>([]);
  async function open(bill: (typeof desk.bills)[number]) {
    setOpenBill(bill);
    setFiles(await listBillAttachments({ data: { projectId, billId: String(bill.id) } }) ?? []);
  }
  if (openBill) {
    const explain = explainPurchaseBill({
      name: String(openBill.vendor),
      currency: "INR",
      taxable: String(openBill.taxable),
      total: String(openBill.total),
      paid: String(openBill.amount_paid),
    });
    return (
      <div className="space-y-3">
        <button type="button" className="min-h-11 text-sm text-muted-foreground" onClick={() => setOpenBill(null)}>Back to bills</button>
        <h2 className="font-display text-2xl">{String(openBill.vendor)}</h2>
        <p className="text-sm">{String(openBill.status)} · {money(String(openBill.total))} · paid {money(String(openBill.amount_paid))} · due {String(openBill.due_date)}</p>
        <section className="rounded-xl bg-card p-4 text-sm">
          <p className="font-medium">{explain.heading}</p>
          <p className="mt-2 text-muted-foreground">{explain.body}</p>
        </section>
        <section className="rounded-xl bg-card p-4">
          <h3 className="text-sm font-medium">Attachments</h3>
          {files.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No file yet.</p>}
          {files.map((file) => (
            <div key={file.id} className="mt-2 flex items-center justify-between gap-2 text-sm">
              <button type="button" className="min-h-11 text-left" onClick={async () => {
                const saved = await readBillAttachment({ data: { projectId, attachmentId: file.id } });
                if (!saved) return;
                const link = document.createElement("a");
                link.href = saved.data_url;
                link.download = saved.file_name;
                link.click();
              }}>{file.file_name} · {Math.max(1, Math.round(file.size_bytes / 1024))} KB · {file.uploaded_by} · {file.created_at}</button>
              {desk.canBills && <Button type="button" variant="ghost" className="h-11" onClick={async () => {
                await removeBillAttachment({ data: { projectId, attachmentId: file.id } });
                setFiles(await listBillAttachments({ data: { projectId, billId: String(openBill.id) } }) ?? []);
              }}>Remove</Button>}
            </div>
          ))}
          {desk.canBills && (
            <label className="mt-3 flex min-h-11 items-center text-sm">
              Upload bill / receipt
              <input className="ml-2 max-w-full text-xs" type="file" accept="application/pdf,image/jpeg,image/png" onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result));
                  reader.onerror = () => reject(new Error("Couldn't read that file"));
                  reader.readAsDataURL(file);
                });
                await addBillAttachment({ data: { projectId, billId: String(openBill.id), fileName: file.name, mime: file.type, dataUrl } });
                setFiles(await listBillAttachments({ data: { projectId, billId: String(openBill.id) } }) ?? []);
              }} />
            </label>
          )}
        </section>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Bills</h2>
      <p className="text-sm text-muted-foreground">Already paid is an expense now. Pay later becomes money you owe. Input GST is tracked, not a guaranteed credit.</p>
      {desk.bills.map((bill) => (
        <button key={String(bill.id)} type="button" className="block w-full rounded-xl bg-card p-4 text-left text-sm" onClick={() => open(bill)}>
          <p className="font-medium">{String(bill.vendor)}</p>
          <p className="text-muted-foreground">{String(bill.status)} · {money(String(bill.total))} · paid {money(String(bill.amount_paid))}</p>
        </button>
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

function Money({ desk, currency, projectId, today, openingDone, onSaved }: { desk: Desk; currency: string; projectId: string; today: string; openingDone: boolean; onSaved: () => Promise<void> }) {
  const [cash, setCash] = useState("");
  const [bank, setBank] = useState("");
  const [receivable, setReceivable] = useState("");
  const [payable, setPayable] = useState("");
  const [loan, setLoan] = useState("");
  const buckets = ["current", "1-30", "31-60", "61-90", "90+"] as const;
  const [collectBucket, setCollectBucket] = useState<string | null>(null);
  const [payBucket, setPayBucket] = useState<string | null>(null);
  const money = (value: string) => formatMoney(value, currency);
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Money in and money out</h2>
      <section className="rounded-xl bg-card p-4">
        <p className="text-sm font-medium">Money to collect</p>
        {buckets.map((bucket) => (
          <button key={bucket} type="button" className={`mt-1 block min-h-11 text-left text-sm ${collectBucket === bucket ? "text-foreground" : "text-muted-foreground"}`} onClick={() => setCollectBucket(collectBucket === bucket ? null : bucket)}>
            {bucket}: {money(String(desk.money.collect[bucket] ?? "0.00"))}
          </button>
        ))}
        {collectBucket && desk.money.collectRows.filter((row) => row.bucket === collectBucket).map((row) => <p key={row.ref} className="mt-1 text-sm">{row.who} · {row.ref} · {money(row.open)} · due {row.due}</p>)}
        {collectBucket && desk.money.collectRows.every((row) => row.bucket !== collectBucket) && <p className="mt-1 text-sm text-muted-foreground">Nothing in this bucket.</p>}
      </section>
      <section className="rounded-xl bg-card p-4">
        <p className="text-sm font-medium">Money to pay</p>
        <p className="text-xs text-muted-foreground">Accounts payable</p>
        {buckets.map((bucket) => (
          <button key={bucket} type="button" className={`mt-1 block min-h-11 text-left text-sm ${payBucket === bucket ? "text-foreground" : "text-muted-foreground"}`} onClick={() => setPayBucket(payBucket === bucket ? null : bucket)}>
            {bucket}: {money(String(desk.money.pay[bucket] ?? "0.00"))}
          </button>
        ))}
        {payBucket && desk.money.payRows.filter((row) => row.bucket === payBucket).map((row) => <p key={row.ref} className="mt-1 text-sm">{row.who} · {money(row.open)} · due {row.due}</p>)}
        {payBucket && desk.money.payRows.every((row) => row.bucket !== payBucket) && <p className="mt-1 text-sm text-muted-foreground">Nothing in this bucket.</p>}
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
  const [period, setPeriod] = useState("month");
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Budget versus actual</h2>
      <p className="text-sm text-muted-foreground">A budget is the plan. Actual is what the books already posted. Department budgets are not supported.</p>
      {desk.budgets.map((budget) => (
        <article key={budget.id} className="rounded-xl bg-card p-4 text-sm">
          <p className="font-medium">{budget.name}</p>
          <p>Budget {money(budget.budget)} · Actual {money(budget.actual)}</p>
          <p>Remaining {money(budget.remaining)} · Variance {money(budget.variance)} · {budget.percent}% used</p>
          <p>{budget.status === "near_limit" ? "Near limit" : budget.status === "over" ? "Over budget" : "On track"} · {budget.period}</p>
        </article>
      ))}
      {desk.canBudgets && (
        <form className="grid gap-2" onSubmit={async (event) => {
          event.preventDefault();
          await saveBudget({ data: { projectId, name, kind: "expense", accountCode: "5400", amount, period, periodStart: today.slice(0, 8) + "01" } });
          setName("");
          await onSaved();
        }}>
          <Input className="h-11" placeholder="Budget name" value={name} onChange={(event) => setName(event.target.value)} required />
          <Input className="h-11" inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          <select className="h-11 rounded-md bg-secondary px-3" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Budget period">
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly</option>
            <option value="year">Financial year</option>
          </select>
          <Button type="submit" className="h-11">Save budget</Button>
        </form>
      )}
    </div>
  );
}

function Loans({ desk, projectId, today, money, onSaved }: { desk: Desk; projectId: string; today: string; money: (value: string) => string; onSaved: () => Promise<void> }) {
  const [lender, setLender] = useState("");
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [term, setTerm] = useState("");
  const [loanId, setLoanId] = useState("");
  const [payPrincipal, setPayPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  const [open, setOpen] = useState<Awaited<ReturnType<typeof getLoanDetail>> | null>(null);
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Loans</h2>
      <p className="text-sm text-muted-foreground">Money you borrow is not revenue. Only the interest part of a repayment is an expense.</p>
      {open && (
        <article className="rounded-xl bg-card p-4 text-sm">
          <button type="button" className="min-h-11 text-muted-foreground" onClick={() => setOpen(null)}>Back</button>
          <p className="font-medium">{open.loan.lender}</p>
          <p>Original principal {money(open.loan.principal)}</p>
          <p>Outstanding principal {money(open.loan.outstanding)}</p>
          <p>Interest rate {open.loan.interest_rate || "Not set"} · Started {open.loan.start_date}</p>
          <p>Principal repaid {money(open.principalPaid)} · Interest paid {money(open.interestPaid)}</p>
          <p>Payments made {open.payments.length}</p>
          <h3 className="mt-3 font-medium">Payments</h3>
          {open.payments.length === 0 && <p className="text-muted-foreground">No repayments posted.</p>}
          {open.payments.map((payment) => <p key={payment.id}>{payment.paid_on} · principal {money(payment.principal)} · interest {money(payment.interest)}</p>)}
          <h3 className="mt-3 font-medium">Expected schedule</h3>
          <p className="text-muted-foreground">{open.scheduleNote}</p>
          {open.schedule.length === 0 && <p className="text-muted-foreground">Add a rate and a term to preview a schedule.</p>}
          {open.schedule.length > 0 && (
            <div className="mt-1 max-h-48 space-y-1 overflow-y-auto">
              {open.schedule.map((row) => <p key={row.month} className="text-muted-foreground">Month {row.month}: principal {money(row.principal)} · interest {money(row.interest)} · left {money(row.balance)}</p>)}
            </div>
          )}
        </article>
      )}
      {(desk.loans as { id: string; lender: string; outstanding: string; principal: string }[]).map((loan) => (
        <button key={loan.id} type="button" className="block w-full rounded-xl bg-card p-4 text-left text-sm" onClick={async () => setOpen(await getLoanDetail({ data: { projectId, loanId: loan.id } }) ?? null)}>
          <p className="font-medium">{loan.lender}</p>
          <p>Original {money(loan.principal)} · Outstanding {money(loan.outstanding)}</p>
        </button>
      ))}
      {desk.canLoans && (
        <>
          <form className="grid gap-2" onSubmit={async (event) => {
            event.preventDefault();
            await receiveLoan({ data: { projectId, lender, principal, date: today, accountCode: "1010", rate: rate || null, termMonths: term ? Number(term) : null } });
            setLender("");
            await onSaved();
          }}>
            <Input className="h-11" placeholder="Lender" value={lender} onChange={(event) => setLender(event.target.value)} required />
            <Input className="h-11" inputMode="decimal" placeholder="Amount received" value={principal} onChange={(event) => setPrincipal(event.target.value)} required />
            <Input className="h-11" inputMode="decimal" placeholder="Annual interest % (optional)" value={rate} onChange={(event) => setRate(event.target.value)} />
            <Input className="h-11" inputMode="numeric" placeholder="Term in months (optional)" value={term} onChange={(event) => setTerm(event.target.value)} />
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
  const [open, setOpen] = useState<Awaited<ReturnType<typeof getAssetDetail>> | null>(null);
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl">Assets</h2>
      <p className="text-sm text-muted-foreground">Choose asset only when the purchase should not be an expense today. Depreciation is posted when you ask. Disposal is not supported yet.</p>
      {open && (
        <article className="rounded-xl bg-card p-4 text-sm">
          <button type="button" className="min-h-11 text-muted-foreground" onClick={() => setOpen(null)}>Back</button>
          <p className="font-medium">{open.asset.name}</p>
          <p>Purchase cost {money(open.asset.cost)}</p>
          <p>Purchase date {open.asset.purchased_on}</p>
          <p>Useful life {open.asset.life_months} months</p>
          <p>Original cost {money(open.asset.cost)}</p>
          <p>Less accumulated depreciation {money(open.accumulated)}</p>
          <p>Current book value {money(open.bookValue)}</p>
          <h3 className="mt-3 font-medium">Depreciation history</h3>
          {open.entries.length === 0 && <p className="text-muted-foreground">None posted.</p>}
          {open.entries.map((entry) => <p key={entry.id}>{entry.period} · {money(entry.amount)}</p>)}
          {desk.canAssets && <Button type="button" variant="secondary" className="mt-2 h-11" onClick={async () => {
            await postAssetDepreciation({ data: { projectId, assetId: open.asset.id, date: today } });
            setOpen(await getAssetDetail({ data: { projectId, assetId: open.asset.id } }) ?? null);
            await onSaved();
          }}>Post depreciation</Button>}
        </article>
      )}
      {(desk.assets as { id: string; name: string; cost: string; accumulated: string }[]).map((asset) => (
        <button key={asset.id} type="button" className="block w-full rounded-xl bg-card p-4 text-left text-sm" onClick={async () => setOpen(await getAssetDetail({ data: { projectId, assetId: asset.id } }) ?? null)}>
          <p className="font-medium">{asset.name}</p>
          <p>Cost {money(asset.cost)} · Book value {money(subMoney(asset.cost, asset.accumulated))}</p>
        </button>
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
