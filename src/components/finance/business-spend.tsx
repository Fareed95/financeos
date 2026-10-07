import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, isZero, subMoney, toCents } from "@/lib/money";
import { getReimbursementDesk, payReimbursement, recordBusinessSpend, transferBusinessMoney } from "@/lib/server/reimburse";
import { BusinessEmptyState, BusinessListRow, BusinessMetric, BusinessPageHeader, BusinessSection, BusinessStatusBadge } from "@/components/finance/business-ui";

type Source = "business" | "personal" | "unpaid";
type Place = "bank" | "cash" | "petty";

export function SpendForm({
  projectId,
  date,
  accounts,
  people,
  selfId,
  canRecordPersonal,
  canRecordBusiness,
  preset,
  onSaved,
}: {
  projectId: string;
  date: string;
  accounts: { code: string; name: string }[];
  people: { userId: string; name: string; role: string }[];
  selfId: string;
  canRecordPersonal: boolean;
  canRecordBusiness: boolean;
  preset?: Source;
  onSaved: () => Promise<void>;
}) {
  const [code, setCode] = useState(accounts.find((account) => account.code === "5400")?.code || accounts[0]?.code || "5400");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [source, setSource] = useState<Source>(preset || (canRecordBusiness ? "business" : "personal"));
  const [place, setPlace] = useState<Place>("bank");
  const [payer, setPayer] = useState(selfId);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await recordBusinessSpend({
            data: {
              projectId,
              code,
              amount,
              date,
              memo,
              source,
              place: source === "business" ? place : null,
              payerUserId: source === "personal" ? (source === "personal" && payer ? payer : selfId) : null,
            },
          });
          setAmount("");
          setMemo("");
          toast.success(source === "personal" ? "Recorded. The business owes this back. Ownership did not change." : source === "unpaid" ? "Recorded as still to pay." : "Expense recorded from the business account.");
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't record that");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="grid gap-1 text-sm">What was it?
        <Input value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Domain, AWS, travel…" />
      </label>
      <label className="grid gap-1 text-sm">Amount
        <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
      </label>
      <fieldset className="grid gap-2">
        <legend className="text-sm">How was this paid?</legend>
        {canRecordBusiness && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="pay-source" checked={source === "business"} onChange={() => setSource("business")} />
            Business account
          </label>
        )}
        {canRecordPersonal && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="pay-source" checked={source === "personal" && payer === selfId} onChange={() => { setSource("personal"); setPayer(selfId); }} />
            Paid personally by me
          </label>
        )}
        {canRecordBusiness && people.length > 1 && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="pay-source" checked={source === "personal" && payer !== selfId} onChange={() => { setSource("personal"); setPayer(people.find((person) => person.userId !== selfId)?.userId || selfId); }} />
            Paid personally by a team member
          </label>
        )}
        {canRecordBusiness && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="pay-source" checked={source === "unpaid"} onChange={() => setSource("unpaid")} />
            Not paid yet
          </label>
        )}
      </fieldset>
      {source === "business" && (
        <select className="h-11 rounded-md bg-secondary px-3 text-sm" value={place} onChange={(event) => setPlace(event.target.value as Place)} aria-label="Business account">
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
          <option value="petty">Petty cash</option>
        </select>
      )}
      {source === "personal" && payer !== selfId && (
        <select className="h-11 rounded-md bg-secondary px-3 text-sm" value={payer} onChange={(event) => setPayer(event.target.value)} aria-label="Team member">
          {people.filter((person) => person.userId !== selfId).map((person) => (
            <option key={person.userId} value={person.userId}>{person.name}</option>
          ))}
        </select>
      )}
      {source === "unpaid" && <p className="text-xs text-muted-foreground">This sits with money to pay. For a named vendor, use a bill instead.</p>}
      {source === "personal" && <p className="text-xs text-muted-foreground">The business will owe this person. It does not change shares.</p>}
      <button type="button" className="text-left text-sm text-muted-foreground underline" onClick={() => setMore((value) => !value)}>Accounting category</button>
      {more && (
        <select className="h-11 rounded-md bg-secondary px-3 text-sm" value={code} onChange={(event) => setCode(event.target.value)} aria-label="Category">
          {accounts.map((account) => <option key={account.code} value={account.code}>{account.name}</option>)}
        </select>
      )}
      <Button type="submit" className="h-11" disabled={busy}>Save expense</Button>
    </form>
  );
}

export function ReimbursementDesk({
  projectId,
  currency,
  date,
  accounts,
  onSaved,
}: {
  projectId: string;
  currency: string;
  date: string;
  accounts: { bank: string; cash: string; petty: string };
  onSaved: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["reimburse", projectId], queryFn: () => getReimbursementDesk({ data: { projectId } }) });
  const [openId, setOpenId] = useState<string | null>(null);
  const money = (value: string) => formatMoney(value, currency, { compact: true });
  async function reload() {
    await qc.invalidateQueries({ queryKey: ["reimburse", projectId] });
    await onSaved();
  }
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading reimbursements…</p>;
  if (!q.data) return <p className="text-sm text-expense">Couldn't load reimbursements.</p>;
  const data = q.data;
  const person = data.people.find((row) => row.userId === openId) ?? null;
  if (person) {
    return (
      <MemberReimburse
        person={person}
        currency={currency}
        projectId={projectId}
        date={date}
        canPay={data.canPay}
        accounts={accounts}
        onBack={() => setOpenId(null)}
        onSaved={reload}
      />
    );
  }
  return (
    <div className="space-y-4">
      <BusinessPageHeader title="Reimbursements" context="Money" />
      <p className="text-sm text-muted-foreground">Business expenses paid personally by your team.</p>
      {isZero(data.totalDue) && data.people.length === 0 ? (
        <BusinessEmptyState title="Nothing to reimburse" body="When someone pays a business expense with their own money, it will show here. That is not a share and not a split." />
      ) : (
        <>
          {!isZero(data.totalDue) && (
            <div className="rounded-xl bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">To reimburse</p>
              <p className="text-2xl font-medium tabular">{money(data.totalDue)}</p>
            </div>
          )}
          <div>
            {data.people.filter((row) => !isZero(row.due)).map((row) => (
              <BusinessListRow
                key={row.userId}
                title={row.name}
                meta={`${money(row.due)} due · ${row.expenses.filter((item) => !isZero(item.open)).length} expense${row.expenses.filter((item) => !isZero(item.open)).length === 1 ? "" : "s"}`}
                action={<Button type="button" variant="secondary" className="h-9" onClick={() => setOpenId(row.userId)}>View</Button>}
              />
            ))}
            {data.people.some((row) => isZero(row.due)) && (
              <p className="pt-3 text-xs text-muted-foreground">Already returned: {data.people.filter((row) => isZero(row.due)).map((row) => row.name).join(", ")}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MemberReimburse({
  person,
  currency,
  projectId,
  date,
  canPay,
  accounts,
  onBack,
  onSaved,
}: {
  person: {
    userId: string;
    name: string;
    due: string;
    reimbursed: string;
    expenses: { id: string; memo: string; date: string; amount: string; open: string }[];
  };
  currency: string;
  projectId: string;
  date: string;
  canPay: boolean;
  accounts: { bank: string; cash: string; petty: string };
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const money = (value: string) => formatMoney(value, currency, { compact: true });
  const open = person.expenses.filter((row) => !isZero(row.open));
  const [picked, setPicked] = useState<string[]>(open.map((row) => row.id));
  const [place, setPlace] = useState<Place>("bank");
  const [amount, setAmount] = useState(person.due);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef("");
  const selectedOpen = person.expenses
    .filter((row) => picked.includes(row.id))
    .reduce((sum, row) => sum + toCents(row.open), 0n);
  const paying = amount.trim() ? amount : person.due;
  const placeBalance = place === "cash" ? accounts.cash : place === "petty" ? accounts.petty : accounts.bank;
  let after = placeBalance;
  try {
    after = subMoney(placeBalance, paying);
  } catch {
    after = placeBalance;
  }
  return (
    <div className="space-y-4">
      <button type="button" className="min-h-11 text-sm text-muted-foreground" onClick={onBack}>Back</button>
      <BusinessPageHeader title={person.name} context="Reimbursement" />
      <div className="grid grid-cols-2 gap-2">
        <BusinessMetric label="Outstanding" value={money(person.due)} />
        <BusinessMetric label="Already returned" value={money(person.reimbursed)} />
      </div>
      <BusinessSection title="Expenses">
        {person.expenses.length === 0 && <p className="text-sm text-muted-foreground">No personal payments.</p>}
        {person.expenses.map((row) => (
          <label key={row.id} className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-0">
            {canPay && !isZero(row.open) && (
              <input
                type="checkbox"
                checked={picked.includes(row.id)}
                onChange={(event) => setPicked((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))}
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{row.memo}</span>
              <span className="block text-xs text-muted-foreground">{row.date} · Paid personally</span>
            </span>
            <span className="text-sm tabular">{money(isZero(row.open) ? row.amount : row.open)}</span>
            {isZero(row.open) && <BusinessStatusBadge tone="paid">Returned</BusinessStatusBadge>}
          </label>
        ))}
      </BusinessSection>
      {canPay && !isZero(person.due) && !confirm && (
        <Button type="button" className="h-11" onClick={() => { idempotencyKey.current = crypto.randomUUID(); setAmount(formatPlain(selectedOpen || toCents(person.due))); setConfirm(true); }}>Reimburse</Button>
      )}
      {canPay && confirm && (
        <form
          className="grid gap-3 rounded-xl bg-card p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await payReimbursement({
                data: {
                  projectId,
                  payerUserId: person.userId,
                  amount: paying,
                  date,
                  place,
                  expenseIds: picked,
                  idempotencyKey: idempotencyKey.current,
                },
              });
              toast.success("Reimbursed. The original expense was not posted again.");
              setConfirm(false);
              await onSaved();
              onBack();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't reimburse");
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="font-medium">Reimburse {person.name}</p>
          <p className="text-sm text-muted-foreground">Outstanding {money(person.due)}</p>
          <label className="grid gap-1 text-sm">Pay now
            <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">From
            <select className="h-11 rounded-md bg-secondary px-3" value={place} onChange={(event) => setPlace(event.target.value as Place)}>
              <option value="bank">Bank · {money(accounts.bank)}</option>
              <option value="cash">Cash · {money(accounts.cash)}</option>
              <option value="petty">Petty cash · {money(accounts.petty)}</option>
            </select>
          </label>
          <p className="text-sm">Cash in this account before {money(placeBalance)}</p>
          <p className="text-sm">Cash after {money(after)}</p>
          <p className="text-xs text-muted-foreground">This pays back money already spent. It does not create another expense.</p>
          <Button type="submit" className="h-11" disabled={busy}>Confirm reimbursement</Button>
          <Button type="button" variant="ghost" className="h-11" onClick={() => setConfirm(false)}>Cancel</Button>
        </form>
      )}
      {!canPay && !isZero(person.due) && <p className="text-sm text-muted-foreground">An owner, admin, or accountant has to send this reimbursement.</p>}
    </div>
  );
}

function formatPlain(cents: bigint) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
}

export function MoneyHub({
  currency,
  cash,
  bank,
  cashBox,
  petty,
  receivable,
  payable,
  reimbursement,
  onOpen,
}: {
  currency: string;
  cash: string;
  bank: string;
  cashBox: string;
  petty: string;
  receivable: string;
  payable: string;
  reimbursement: string;
  onOpen: (section: "invoices" | "bills" | "reimbursements" | "vendors") => void;
}) {
  const money = (value: string) => formatMoney(value, currency, { compact: true });
  return (
    <div className="space-y-4">
      <BusinessPageHeader title="Money" context="Business" />
      <div className="rounded-xl bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">Cash available</p>
        <p className="text-2xl font-medium tabular">{money(cash)}</p>
      </div>
      <div className="divide-y divide-border/60">
        <button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left" onClick={() => onOpen("invoices")}>
          <span><span className="block text-sm font-medium">Money to collect</span><span className="block text-xs text-muted-foreground">Customers owe you</span></span>
          <span className="text-sm tabular">{money(receivable)}</span>
        </button>
        <button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left" onClick={() => onOpen("bills")}>
          <span><span className="block text-sm font-medium">Money to pay</span><span className="block text-xs text-muted-foreground">Vendor bills</span></span>
          <span className="text-sm tabular">{money(payable)}</span>
        </button>
        <button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left" onClick={() => onOpen("reimbursements")}>
          <span><span className="block text-sm font-medium">Team reimbursements</span><span className="block text-xs text-muted-foreground">Money owed back to team members</span></span>
          <span className="text-sm tabular">{isZero(reimbursement) ? "—" : money(reimbursement)}</span>
        </button>
      </div>
      <BusinessSection title="Accounts">
        <BusinessListRow title="Bank" value={money(bank)} />
        <BusinessListRow title="Cash" value={money(cashBox)} />
        <BusinessListRow title="Petty cash" value={money(petty)} />
      </BusinessSection>
    </div>
  );
}

export function TransferForm({ projectId, date, onSaved }: { projectId: string; date: string; onSaved: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("bank");
  const [to, setTo] = useState("cash");
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await transferBusinessMoney({ data: { projectId, amount, date, from, to } });
          setAmount("");
          toast.success("Moved between business accounts. This is not an expense.");
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't transfer");
        }
      }}
    >
      <p className="text-sm font-medium">Transfer money</p>
      <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" />
      <div className="grid grid-cols-2 gap-2">
        <select className="h-11 rounded-md bg-secondary px-3 text-sm" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From">
          <option value="bank">From bank</option>
          <option value="cash">From cash</option>
          <option value="petty">From petty cash</option>
        </select>
        <select className="h-11 rounded-md bg-secondary px-3 text-sm" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To">
          <option value="bank">To bank</option>
          <option value="cash">To cash</option>
          <option value="petty">To petty cash</option>
        </select>
      </div>
      <Button type="submit" variant="secondary" className="h-11">Transfer</Button>
    </form>
  );
}
