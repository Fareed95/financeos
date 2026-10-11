import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { goalProgress } from "@/lib/family";
import { toCents } from "@/lib/money";
import {
  addFamilyAccount,
  addFamilyPerson,
  contributeFromPersonal,
  getFamily,
  inviteFamilyMember,
  markFamilyBillPaid,
  moveToFamilyGoal,
  payFamilyBack,
  postFamilyEntry,
  revokeFamilyInvite,
  saveFamilyBill,
  saveFamilyBudget,
  saveFamilyGoal,
  saveFamilyInvestment,
  saveFamilyLiability,
} from "@/lib/server/family";
import { listAccounts } from "@/lib/server/accounts";
import { todayISO } from "@/lib/utils";

type Section = "overview" | "activity" | "budget" | "goals" | "more";

function line(kind: string, name: string | null, category: string | null, note: string | null, paidFrom?: string) {
  const who = name || "Someone";
  if (kind === "contribution") return `${who} added money`;
  if (kind === "payback") return `Paid ${who} back`;
  if (kind === "goal_move") return note || "Moved to a goal";
  if (paidFrom === "family") return `Paid ${category || note || "a household expense"}`;
  return `${who} paid ${category || note || "a household expense"}`;
}

export function FamilyWorkspace({ familyId, currency }: { familyId: string; currency: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["family", familyId], queryFn: () => getFamily({ data: { familyId } }) });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => listAccounts() });
  const [section, setSection] = useState<Section>("overview");
  const today = todayISO();

  useEffect(() => {
    document.documentElement.dataset.hideQuickAdd = "1";
    return () => {
      delete document.documentElement.dataset.hideQuickAdd;
    };
  }, []);

  async function reload() {
    await qc.invalidateQueries({ queryKey: ["family", familyId] });
    await qc.invalidateQueries({ queryKey: ["bootstrap"] });
  }

  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading family…</p>;
  if (!q.data?.family) return <p className="text-sm text-expense">Couldn't open this family.</p>;
  const data = q.data;
  const cash = data.accounts.reduce((sum, account) => sum + Number(account.balance), 0);
  const month = today.slice(0, 7);
  const monthEntries = data.entries.filter((row) => row.entry_date.slice(0, 7) === month);
  const added = monthEntries.filter((row) => row.kind === "contribution").reduce((sum, row) => sum + Number(row.amount), 0);
  const spent = monthEntries.filter((row) => row.kind === "expense").reduce((sum, row) => sum + Number(row.amount), 0);
  const saved = data.goals.reduce((sum, goal) => sum + Number(goal.saved), 0);
  const invested = data.investments.reduce((sum, row) => sum + Number(row.current_value), 0);
  const owedOut = data.liabilities.reduce((sum, row) => sum + Number(row.balance), 0);
  const showWorth = data.investments.length > 0 || data.liabilities.length > 0;
  const empty = data.accounts.length === 0 && data.entries.length === 0 && data.people.length <= 1;

  return (
    <div className="space-y-5 pt-4 md:max-w-xl">
      <header>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Family</p>
        <h1 className="font-display text-3xl tracking-tight">{data.family.name}</h1>
      </header>
      <div className="flex flex-wrap gap-2">
        {(["overview", "activity", "budget", "goals", "more"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setSection(item)}
            className={`h-10 rounded-full px-3 text-sm capitalize ${section === item ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}
          >
            {item}
          </button>
        ))}
      </div>

      {section === "overview" && (
        <div className="space-y-4">
          {empty && (
            <div className="rounded-xl bg-card p-4">
              <p className="font-medium">Let's set up your household money.</p>
              <p className="mt-1 text-sm text-muted-foreground">Add a family account, a person, or a bill. You can skip all of it.</p>
            </div>
          )}
          <p className="font-display text-4xl tabular">{formatMoney(cash.toFixed(2), currency)}</p>
          <p className="text-sm text-muted-foreground">Family money. Personal accounts are not included.</p>
          <div className="grid grid-cols-3 gap-2">
            <Mini label="Added" value={formatMoney(added.toFixed(2), currency)} />
            <Mini label="Spent" value={formatMoney(spent.toFixed(2), currency)} />
            <Mini label="Saved" value={formatMoney(saved.toFixed(2), currency)} />
          </div>
          {showWorth && (
            <p className="text-sm text-muted-foreground">
              Family net worth {formatMoney((cash + saved + invested - owedOut).toFixed(2), currency)}. Investment values are typed in by you, not live prices.
            </p>
          )}
          {data.due.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Money to return</p>
              {data.due.map((row) => (
                <p key={row.person_id} className="text-sm text-muted-foreground">{row.display_name} · {formatMoney(row.open, currency)}</p>
              ))}
            </div>
          )}
          <ContributionForm familyId={familyId} people={data.people} accounts={data.accounts} today={today} can={data.canRecord} onSaved={reload} />
          <ExpenseForm familyId={familyId} people={data.people} accounts={data.accounts} today={today} can={data.canRecord} onSaved={reload} />
          <TransferForm
            familyId={familyId}
            accounts={data.accounts}
            personal={(accounts.data ?? []).filter((account) => account.isActive)}
            today={today}
            can={data.canRecord}
            onSaved={reload}
          />
        </div>
      )}

      {section === "activity" && (
        <div className="space-y-3">
          {data.entries.length === 0 && <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>}
          {data.entries.map((row) => (
            <div key={row.id} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{line(row.kind, row.display_name, row.category, row.note, row.paid_from)}</p>
                <p className="text-xs text-muted-foreground">{row.entry_date.slice(0, 10)}{row.paid_from === "personal" ? (row.reimburse ? " · to be paid back" : " · their contribution") : ""}</p>
              </div>
              <p className="tabular text-sm">{formatMoney(row.amount, currency)}</p>
            </div>
          ))}
          {data.canMoney && data.due.map((row) => (
            <Payback key={row.person_id} familyId={familyId} personId={row.person_id} name={row.display_name} accounts={data.accounts} today={today} onSaved={reload} />
          ))}
        </div>
      )}

      {section === "budget" && (
        <BudgetPanel familyId={familyId} budgets={data.budgets} entries={data.entries} currency={currency} can={data.canMoney} month={month} onSaved={reload} />
      )}
      {section === "goals" && (
        <GoalsPanel familyId={familyId} goals={data.goals} accounts={data.accounts} currency={currency} today={today} can={data.canMoney} onSaved={reload} />
      )}
      {section === "more" && (
        <MorePanel familyId={familyId} data={data} currency={currency} today={today} onSaved={reload} />
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm tabular">{value}</p>
    </div>
  );
}

function ContributionForm({ familyId, people, accounts, today, can, onSaved }: {
  familyId: string;
  people: { id: string; display_name: string }[];
  accounts: { id: string; name: string }[];
  today: string;
  can: boolean;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  if (!can) return null;
  return (
    <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
      event.preventDefault();
      try {
        await postFamilyEntry({ data: { familyId, kind: "contribution", amount, date: today, personId, accountId: accountId || undefined } });
        setAmount("");
        toast.success("Added to the family");
        await onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save");
      }
    }}>
      <p className="text-sm font-medium">Money added</p>
      <Input inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={personId} onChange={(event) => setPersonId(event.target.value)} aria-label="From">
        {people.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}
      </select>
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Into">
        <option value="">Not in a family account yet</option>
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <Button type="submit" className="h-11">Add</Button>
    </form>
  );
}

function ExpenseForm({ familyId, people, accounts, today, can, onSaved }: {
  familyId: string;
  people: { id: string; display_name: string }[];
  accounts: { id: string; name: string }[];
  today: string;
  can: boolean;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Groceries");
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [paidFrom, setPaidFrom] = useState<"family" | "personal">("family");
  const [reimburse, setReimburse] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  if (!can) return null;
  return (
    <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
      event.preventDefault();
      try {
        await postFamilyEntry({
          data: { familyId, kind: "expense", amount, date: today, category, personId, paidFrom, reimburse: paidFrom === "personal" && reimburse, accountId: paidFrom === "family" ? accountId : undefined },
        });
        setAmount("");
        toast.success("Expense saved");
        await onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save");
      }
    }}>
      <p className="text-sm font-medium">Household expense</p>
      <Input inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <Input placeholder="What for" value={category} onChange={(event) => setCategory(event.target.value)} />
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={personId} onChange={(event) => setPersonId(event.target.value)} aria-label="Who">
        {people.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}
      </select>
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={paidFrom} onChange={(event) => setPaidFrom(event.target.value as "family" | "personal")} aria-label="Paid from">
        <option value="family">Paid from family money</option>
        <option value="personal">Paid personally</option>
      </select>
      {paidFrom === "family" && accounts.length > 0 && (
        <select className="h-11 rounded-md bg-secondary px-3 text-base" value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Family account">
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      )}
      {paidFrom === "family" && accounts.length === 0 && (
        <p className="text-sm text-muted-foreground">Add a family account in More before paying from family money.</p>
      )}
      {paidFrom === "personal" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={reimburse} onChange={(event) => setReimburse(event.target.checked)} />
          Family should pay this person back
        </label>
      )}
      <Button type="submit" className="h-11">Save expense</Button>
    </form>
  );
}

function TransferForm({ familyId, accounts, personal, today, can, onSaved }: {
  familyId: string;
  accounts: { id: string; name: string }[];
  personal: { id: string; name: string }[];
  today: string;
  can: boolean;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [personalAccountId, setPersonalAccountId] = useState(personal[0]?.id ?? "");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  if (!can || personal.length === 0 || accounts.length === 0) return null;
  return (
    <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
      event.preventDefault();
      try {
        await contributeFromPersonal({ data: { familyId, amount, date: today, personalAccountId, accountId } });
        setAmount("");
        toast.success("Moved into the family. This is not an expense.");
        await onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't move");
      }
    }}>
      <p className="text-sm font-medium">Move from personal</p>
      <p className="text-sm text-muted-foreground">This leaves your account and arrives in the family. It is not counted twice.</p>
      <Input inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={personalAccountId} onChange={(event) => setPersonalAccountId(event.target.value)} aria-label="Personal account">
        {personal.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Family account">
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <Button type="submit" className="h-11">Move</Button>
    </form>
  );
}

function Payback({ familyId, personId, name, accounts, today, onSaved }: {
  familyId: string; personId: string; name: string; accounts: { id: string; name: string }[]; today: string; onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  if (accounts.length === 0) return <p className="text-sm text-muted-foreground">Add a family account before paying {name} back.</p>;
  return (
    <form className="grid gap-2" onSubmit={async (event) => {
      event.preventDefault();
      try {
        await payFamilyBack({ data: { familyId, personId, amount, accountId, date: today } });
        toast.success(`Paid ${name} back`);
        await onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't pay");
      }
    }}>
      <p className="text-sm">Pay {name} back</p>
      <Input inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <Button type="submit" variant="secondary" className="h-11">Pay back</Button>
    </form>
  );
}

function BudgetPanel({ familyId, budgets, entries, currency, can, month, onSaved }: {
  familyId: string;
  budgets: { id: string; category: string; amount: string }[];
  entries: { kind: string; category: string | null; amount: string; entry_date: string }[];
  currency: string;
  can: boolean;
  month: string;
  onSaved: () => Promise<void>;
}) {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <div className="space-y-3">
      {budgets.map((budget) => {
        const used = entries
          .filter((row) => row.kind === "expense" && row.entry_date.slice(0, 7) === month && (row.category || "").toLowerCase() === budget.category.toLowerCase())
          .reduce((sum, row) => sum + Number(row.amount), 0);
        const left = Number(budget.amount) - used;
        return (
          <div key={budget.id} className="border-b border-border/60 py-3">
            <p className="text-sm font-medium">{budget.category}</p>
            <p className="text-sm text-muted-foreground">
              {formatMoney(used.toFixed(2), currency)} of {formatMoney(budget.amount, currency)} · {formatMoney(left.toFixed(2), currency)} left
            </p>
          </div>
        );
      })}
      {can && (
        <form className="grid gap-2" onSubmit={async (event) => {
          event.preventDefault();
          try {
            await saveFamilyBudget({ data: { familyId, category, amount } });
            setCategory("");
            setAmount("");
            await onSaved();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't save");
          }
        }}>
          <Input placeholder="Groceries" value={category} onChange={(event) => setCategory(event.target.value)} />
          <Input inputMode="decimal" placeholder="Monthly amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <Button type="submit" className="h-11">Add budget</Button>
        </form>
      )}
    </div>
  );
}

function GoalsPanel({ familyId, goals, accounts, currency, today, can, onSaved }: {
  familyId: string;
  goals: { id: string; name: string; target: string; saved: string }[];
  accounts: { id: string; name: string }[];
  currency: string;
  today: string;
  can: boolean;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [goalId, setGoalId] = useState(goals[0]?.id ?? "");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const selectedGoal = goals.some((goal) => goal.id === goalId) ? goalId : (goals[0]?.id ?? "");
  const selectedAccount = accounts.some((account) => account.id === accountId) ? accountId : (accounts[0]?.id ?? "");
  return (
    <div className="space-y-3">
      {goals.map((goal) => {
        const pct = goalProgress(toCents(goal.saved), toCents(goal.target));
        return (
          <div key={goal.id}>
            <p className="text-sm font-medium">{goal.name}</p>
            <p className="text-sm text-muted-foreground">{formatMoney(goal.saved, currency)} of {formatMoney(goal.target, currency)} · {pct}%</p>
          </div>
        );
      })}
      {can && (
        <>
          <form className="grid gap-2" onSubmit={async (event) => {
            event.preventDefault();
            try {
              await saveFamilyGoal({ data: { familyId, name, target } });
              setName("");
              setTarget("");
              await onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't save");
            }
          }}>
            <Input placeholder="Emergency fund" value={name} onChange={(event) => setName(event.target.value)} />
            <Input inputMode="decimal" placeholder="Target" value={target} onChange={(event) => setTarget(event.target.value)} />
            <Button type="submit" className="h-11">Add goal</Button>
          </form>
          {goals.length > 0 && accounts.length > 0 && (
            <form className="grid gap-2" onSubmit={async (event) => {
              event.preventDefault();
              try {
                await moveToFamilyGoal({ data: { familyId, goalId: selectedGoal, accountId: selectedAccount, amount, date: today } });
                setAmount("");
                await onSaved();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't move");
              }
            }}>
              <select className="h-11 rounded-md bg-secondary px-3 text-base" value={selectedGoal} onChange={(event) => setGoalId(event.target.value)}>
                {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}
              </select>
              <select className="h-11 rounded-md bg-secondary px-3 text-base" value={selectedAccount} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
              <Input inputMode="decimal" placeholder="Move amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
              <Button type="submit" variant="secondary" className="h-11">Move to goal</Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function MorePanel({ familyId, data, currency, today, onSaved }: {
  familyId: string;
  data: NonNullable<Awaited<ReturnType<typeof getFamily>>>;
  currency: string;
  today: string;
  onSaved: () => Promise<void>;
}) {
  const [person, setPerson] = useState("");
  const [role, setRole] = useState("adult");
  const [inviteRole, setInviteRole] = useState("adult");
  const [link, setLink] = useState("");
  const [accountName, setAccountName] = useState("");
  const [opening, setOpening] = useState("");
  const [bill, setBill] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [dueDay, setDueDay] = useState("5");
  const [investName, setInvestName] = useState("");
  const [invested, setInvested] = useState("");
  const [current, setCurrent] = useState("");
  const [loan, setLoan] = useState("");
  const [loanBalance, setLoanBalance] = useState("");
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-medium">People</p>
        {data.people.map((personRow) => (
          <p key={personRow.id} className="text-sm">{personRow.display_name} · <span className="capitalize text-muted-foreground">{personRow.role}</span>{personRow.linked_user_id ? "" : " · no Kharcha login"}</p>
        ))}
        {data.canPeople && (
          <form className="grid gap-2" onSubmit={async (event) => {
            event.preventDefault();
            try {
              await addFamilyPerson({ data: { familyId, name: person, role } });
              setPerson("");
              await onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't add");
            }
          }}>
            <Input placeholder="Dad" value={person} onChange={(event) => setPerson(event.target.value)} />
            <select className="h-11 rounded-md bg-secondary px-3 text-base" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="adult">Adult</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <Button type="submit" className="h-11">Add person</Button>
          </form>
        )}
        {data.canPeople && (
          <form className="grid gap-2" onSubmit={async (event) => {
            event.preventDefault();
            try {
              const saved = await inviteFamilyMember({ data: { familyId, role: inviteRole } });
              const url = `${window.location.origin}${saved?.path ?? ""}`;
              setLink(url);
              toast.success("Invite ready");
              await onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't invite");
            }
          }}>
            <select className="h-11 rounded-md bg-secondary px-3 text-base" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} aria-label="Invite role">
              <option value="adult">Adult</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <Button type="submit" variant="secondary" className="h-11">Invite</Button>
            {link && <p className="break-all text-xs text-muted-foreground">{link}</p>}
          </form>
        )}
        {data.invites.filter((invite) => invite.state === "open").map((invite) => (
          <div key={invite.id} className="flex items-center justify-between text-sm">
            <span className="capitalize text-muted-foreground">{invite.role} invite</span>
            {data.canPeople && <button type="button" className="text-expense" onClick={() => void revokeFamilyInvite({ data: { familyId, inviteId: invite.id } }).then(onSaved)}>Revoke</button>}
          </div>
        ))}
      </section>
      <section className="space-y-2">
        <p className="text-sm font-medium">Family accounts</p>
        {data.accounts.map((account) => (
          <p key={account.id} className="text-sm">{account.name} · {formatMoney(account.balance, currency)}</p>
        ))}
        {data.canMoney && (
          <form className="grid gap-2" onSubmit={async (event) => {
            event.preventDefault();
            try {
              await addFamilyAccount({ data: { familyId, name: accountName, balance: opening || "0" } });
              setAccountName("");
              setOpening("");
              await onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't add");
            }
          }}>
            <Input placeholder="Family cash" value={accountName} onChange={(event) => setAccountName(event.target.value)} />
            <Input inputMode="decimal" placeholder="Starting amount" value={opening} onChange={(event) => setOpening(event.target.value)} />
            <Button type="submit" className="h-11">Add account</Button>
          </form>
        )}
      </section>
      <section className="space-y-2">
        <p className="text-sm font-medium">Bills</p>
        <p className="text-sm text-muted-foreground">Reminders only. Marking paid does not create a transaction.</p>
        {data.bills.map((billRow) => (
          <div key={billRow.id} className="flex items-center justify-between text-sm">
            <span>{billRow.name} · day {billRow.due_day} · {formatMoney(billRow.amount, currency)}{billRow.last_paid ? " · paid" : " · due"}</span>
            {data.canRecord && !billRow.last_paid?.startsWith(today.slice(0, 7)) && (
              <button type="button" className="text-muted-foreground underline" onClick={() => void markFamilyBillPaid({ data: { familyId, billId: billRow.id, date: today } }).then(onSaved)}>Paid</button>
            )}
          </div>
        ))}
        {data.canRecord && (
          <form className="grid gap-2" onSubmit={async (event) => {
            event.preventDefault();
            try {
              await saveFamilyBill({ data: { familyId, name: bill, amount: billAmount, dueDay: Number(dueDay) || 5 } });
              setBill("");
              setBillAmount("");
              await onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't save");
            }
          }}>
            <Input placeholder="Electricity" value={bill} onChange={(event) => setBill(event.target.value)} />
            <Input inputMode="decimal" placeholder="Amount" value={billAmount} onChange={(event) => setBillAmount(event.target.value)} />
            <Input inputMode="numeric" placeholder="Due day (1–28)" aria-label="Due day" value={dueDay} onChange={(event) => setDueDay(event.target.value)} />
            <Button type="submit" variant="secondary" className="h-11">Add bill</Button>
          </form>
        )}
      </section>
      <section className="space-y-2">
        <p className="text-sm font-medium">Investments</p>
        <p className="text-sm text-muted-foreground">Values are what you type. Kharcha does not fetch market prices.</p>
        {data.investments.map((row) => (
          <p key={row.id} className="text-sm">{row.name} · {row.kind} · {formatMoney(row.current_value, currency)}</p>
        ))}
        {data.canMoney && (
          <form className="grid gap-2" onSubmit={async (event) => {
            event.preventDefault();
            try {
              await saveFamilyInvestment({ data: { familyId, name: investName, kind: "Other", invested, current: current || invested, date: today } });
              setInvestName("");
              setInvested("");
              setCurrent("");
              await onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't save");
            }
          }}>
            <Input placeholder="Family FD" value={investName} onChange={(event) => setInvestName(event.target.value)} />
            <Input inputMode="decimal" placeholder="Invested" value={invested} onChange={(event) => setInvested(event.target.value)} />
            <Input inputMode="decimal" placeholder="Value today" value={current} onChange={(event) => setCurrent(event.target.value)} />
            <Button type="submit" variant="secondary" className="h-11">Add investment</Button>
          </form>
        )}
      </section>
      <section className="space-y-2">
        <p className="text-sm font-medium">Loans</p>
        {data.liabilities.map((row) => (
          <p key={row.id} className="text-sm">{row.name} · {formatMoney(row.balance, currency)}</p>
        ))}
        {data.canMoney && (
          <form className="grid gap-2" onSubmit={async (event) => {
            event.preventDefault();
            try {
              await saveFamilyLiability({ data: { familyId, name: loan, kind: "Home loan", balance: loanBalance } });
              setLoan("");
              setLoanBalance("");
              await onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't save");
            }
          }}>
            <Input placeholder="Home loan" value={loan} onChange={(event) => setLoan(event.target.value)} />
            <Input inputMode="decimal" placeholder="Still owed" value={loanBalance} onChange={(event) => setLoanBalance(event.target.value)} />
            <Button type="submit" variant="secondary" className="h-11">Add loan</Button>
          </form>
        )}
      </section>
      <p className="text-sm text-muted-foreground">Money given to a business is not a family transfer. Open that business and record a loan or equity there.</p>
    </div>
  );
}
