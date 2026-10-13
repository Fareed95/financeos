import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Banknote, BedDouble, Car, Folder, GraduationCap, HeartPulse, Receipt, ShoppingBag, Undo2, Utensils, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/finance/empty-state";
import { formatMoney } from "@/lib/money";
import { goalProgress } from "@/lib/family";
import { toCents } from "@/lib/money";
import {
  addFamilyAccount,
  addFamilyPerson,
  contributeFromPersonal,
  getFamily,
  inviteFamilyMember,
  copyFamilyInviteLink,
  setFamilyInvitesVisible,
  markFamilyBillPaid,
  moveToFamilyGoal,
  payFamilyBack,
  postFamilyEntry,
  postFamilySplit,
  removeFamilyPerson,
  revokeFamilyInvite,
  saveFamilyBill,
  saveFamilyBudget,
  saveFamilyGoal,
  saveFamilyInvestment,
  saveFamilyLiability,
  transferFamilyMoney,
} from "@/lib/server/family";
import { cn, formatShortDate, todayISO } from "@/lib/utils";

type Section = "overview" | "activity" | "budget" | "goals" | "more";
type DashAction = "in" | "out" | "move" | null;

const TABS: { id: Section; label: string }[] = [
  { id: "overview", label: "Money" },
  { id: "activity", label: "Activity" },
  { id: "budget", label: "Budget" },
  { id: "goals", label: "Goals" },
  { id: "more", label: "More" },
];

export function FamilyWorkspace({ familyId, currency }: { familyId: string; currency: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["family", familyId], queryFn: () => getFamily({ data: { familyId } }) });
  const [section, setSection] = useState<Section>("overview");
  const [action, setAction] = useState<DashAction>(null);
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
  const shared = data.accounts.filter((account) => !account.person_id);

  return (
    <div className="space-y-5 pt-4 md:max-w-xl">
      <header>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Family</p>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-3xl tracking-tight">{data.family.name}</h1>
          <Link to="/family" search={{ list: "1" }} className="mt-2 shrink-0 text-sm text-muted-foreground">All families</Link>
        </div>
      </header>
      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
            className={`h-10 rounded-full px-3 text-sm ${section === item.id ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {section === "overview" && (
        <div className="space-y-5">
          <div>
            <p className="font-display text-4xl tabular">{formatMoney(cash.toFixed(2), currency)}</p>
            <p className="mt-1 text-sm text-muted-foreground">Family total. Everyone's accounts added together.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This month +{formatMoney(added.toFixed(2), currency)} in · −{formatMoney(spent.toFixed(2), currency)} out
            </p>
          </div>
          {showWorth && (
            <p className="text-sm text-muted-foreground">
              Family net worth {formatMoney((cash + saved + invested - owedOut).toFixed(2), currency)}. Values you type, not live prices.
            </p>
          )}

          {data.canRecord && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAction(action === "in" ? null : "in")} className={`h-12 rounded-2xl text-sm font-medium ${action === "in" ? "bg-foreground text-background" : "bg-card"}`}>
                Money in
              </button>
              <button type="button" onClick={() => setAction(action === "out" ? null : "out")} className={`h-12 rounded-2xl text-sm font-medium ${action === "out" ? "bg-foreground text-background" : "bg-card"}`}>
                Spent
              </button>
            </div>
          )}
          {data.canRecord && data.accounts.length > 1 && (
            <button type="button" className="h-11 text-left text-sm text-muted-foreground" onClick={() => setAction(action === "move" ? null : "move")}>
              {action === "move" ? "Close move" : "Move between us"}
            </button>
          )}
          {(action === "in" || action === "out" || action === "move") && (
            <MoneySheet
              mode={action}
              familyId={familyId}
              wallets={data.accounts}
              today={today}
              onSaved={reload}
              onClose={() => setAction(null)}
            />
          )}

          <section className="space-y-1">
            <p className="text-sm font-medium">Members</p>
            {data.people.map((person) => {
              const wallet = data.accounts.find((account) => account.person_id === person.id);
              const canRemove = data.canPeople && person.id !== data.meId && person.role !== "owner";
              return (
                <div key={person.id} className="flex items-center gap-3 border-b border-border/60 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-sm font-medium">
                    {(person.display_name.trim()[0] || "?").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{person.display_name}</p>
                    {canRemove && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground"
                        onClick={() => {
                          void removeFamilyPerson({ data: { familyId, personId: person.id } })
                            .then(async () => {
                              toast.success("Removed");
                              await reload();
                            })
                            .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't remove"));
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <p className="tabular text-sm">{formatMoney(wallet?.balance ?? "0", currency)}</p>
                </div>
              );
            })}
            {shared.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-3 border-b border-border/60 py-3">
                <p className="text-sm">{account.name}</p>
                <p className="tabular text-sm">{formatMoney(account.balance, currency)}</p>
              </div>
            ))}
            {data.canPeople && data.showInvites && (
              <InviteByEmail familyId={familyId} invites={data.invites} onSaved={reload} canHide />
            )}
          </section>

          {data.due.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">To pay back</p>
              {data.due.map((row) => (
                <p key={row.person_id} className="text-sm">{row.display_name} · {formatMoney(row.open, currency)}</p>
              ))}
              <button type="button" className="h-11 text-sm text-muted-foreground" onClick={() => setSection("activity")}>Pay them back</button>
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-medium">Recent</h2>
            {data.entries.length === 0 ? (
              <EmptyState
                icon={ArrowLeftRight}
                title="No transactions yet"
                body="Add money in, or what the house spent."
                action={data.canRecord ? "Add an expense" : undefined}
                onAction={data.canRecord ? () => setAction("out") : undefined}
              />
            ) : (
              <div className="rounded-xl bg-card px-3 py-1 shadow-[var(--elev-shadow)]">
                {groupFamilyEntries(data.entries).map((row) => (
                  <FamilyTxn key={row.id} row={row} currency={currency} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {section === "activity" && (
        <div className="space-y-3">
          <div className="rounded-xl bg-card px-3 py-1 shadow-[var(--elev-shadow)]">
            {data.entries.length === 0 && <p className="px-1 py-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>}
            {groupFamilyEntries(data.entries).map((row) => (
              <FamilyTxn key={row.id} row={row} currency={currency} />
            ))}
          </div>
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

function groupFamilyEntries<T extends {
  id: string;
  kind: string;
  split_id?: string | null;
  amount: string;
  entry_date: string;
  category: string | null;
  note: string | null;
  account_name?: string | null;
}>(entries: T[]) {
  const seen = new Set<string>();
  const rows: Array<T & { parts?: T[] }> = [];
  const titleOf = (row: T) => (row.category || row.note || row.kind).trim().toLowerCase();
  for (const row of entries) {
    if (seen.has(row.id)) continue;
    const splitParts = row.split_id ? entries.filter((item) => item.split_id === row.split_id) : [];
    const sameThing = row.kind === "expense" || row.kind === "contribution"
      ? entries.filter((item) => item.kind === row.kind && item.entry_date.slice(0, 10) === row.entry_date.slice(0, 10) && titleOf(item) === titleOf(row))
      : [];
    const parts = splitParts.length > 1 ? splitParts : sameThing.length > 1 ? sameThing : [];
    if (parts.length > 1) {
      for (const part of parts) seen.add(part.id);
      const total = parts.reduce((sum, item) => sum + Number(item.amount), 0);
      rows.push({ ...row, amount: total.toFixed(2), parts });
      continue;
    }
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

function familyIcon(row: { kind: string; category: string | null; note: string | null }): LucideIcon {
  if (row.kind === "contribution") return Banknote;
  if (row.kind === "transfer") return ArrowLeftRight;
  if (row.kind === "payback") return Undo2;
  if (row.kind === "goal_move") return Folder;
  const text = `${row.category || ""} ${row.note || ""}`.toLowerCase();
  if (/groc|food|kirana|restaurant|khana|milk/.test(text)) return Utensils;
  if (/rent|house|home|maid/.test(text)) return BedDouble;
  if (/fuel|petrol|uber|cab|auto|travel/.test(text)) return Car;
  if (/medic|hospital|health|doctor/.test(text)) return HeartPulse;
  if (/school|fee|book|tuition/.test(text)) return GraduationCap;
  if (/shop|cloth|amazon|flipkart/.test(text)) return ShoppingBag;
  return Receipt;
}

function familyTitle(row: {
  kind: string;
  display_name: string | null;
  category: string | null;
  note: string | null;
  account_name?: string | null;
  to_name?: string | null;
}) {
  if (row.kind === "transfer") return `${row.account_name || "Someone"} → ${row.to_name || "someone"}`;
  if (row.kind === "contribution") return row.note || "Added money";
  if (row.kind === "payback") return `Paid ${row.display_name || "someone"} back`;
  if (row.kind === "goal_move") return row.note || "Moved to a goal";
  return row.category || row.note || "Spent";
}

function FamilyTxn({
  row,
  currency,
}: {
  row: {
    id: string;
    kind: string;
    display_name: string | null;
    category: string | null;
    note: string | null;
    paid_from: string;
    entry_date: string;
    amount: string;
    reimburse: boolean;
    account_name?: string | null;
    to_name?: string | null;
    parts?: { amount: string; account_name?: string | null }[];
  };
  currency: string;
}) {
  const Icon = familyIcon(row);
  const incoming = row.kind === "contribution";
  const spent = row.kind === "expense" || row.kind === "payback";
  const color = incoming ? "text-income" : spent ? "text-expense" : "text-foreground";
  const prefix = incoming ? "+" : spent ? "−" : "";
  const splitLine = row.parts?.map((part) => `${formatMoney(part.amount, currency, { sign: "never" })} ${part.account_name || ""}`.trim()).join(" · ");
  const account = row.kind === "transfer" ? "" : splitLine ? "" : row.account_name ? ` · ${row.account_name}` : "";
  const extra = row.paid_from === "personal" && row.reimburse ? " · to be paid back" : "";
  return (
    <div className="flex w-full items-center gap-3 px-1 py-2.5">
      <div className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{familyTitle(row)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {formatShortDate(row.entry_date.slice(0, 10))}
          {account}
          {extra}
          {splitLine ? ` · ${splitLine}` : ""}
        </p>
      </div>
      <p className={cn("tabular shrink-0 text-sm font-medium", color)}>
        {prefix}
        {formatMoney(row.amount, currency, { sign: "never" })}
      </p>
    </div>
  );
}

function MoneySheet({
  mode,
  familyId,
  wallets,
  today,
  onSaved,
  onClose,
}: {
  mode: "in" | "out" | "move";
  familyId: string;
  wallets: { id: string; name: string; balance: string }[];
  today: string;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [fromId, setFromId] = useState(wallets[0]?.id ?? "");
  const [toId, setToId] = useState(wallets.find((row) => row.id !== wallets[0]?.id)?.id ?? "");
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<Record<string, string>>({});
  const from = wallets.some((row) => row.id === fromId) ? fromId : (wallets[0]?.id ?? "");
  const to = wallets.some((row) => row.id === toId) && toId !== from ? toId : (wallets.find((row) => row.id !== from)?.id ?? "");
  const totalCents = Math.round(Number(amount.replace(/[,₹\s]/g, "") || "0") * 100);
  const partCents = wallets.reduce((sum, wallet) => sum + Math.round(Number((parts[wallet.id] || "0").replace(/[,₹\s]/g, "")) * 100), 0);
  const leftCents = totalCents - partCents;
  if (wallets.length === 0) return <p className="text-sm text-muted-foreground">Add someone. Their account is created for you.</p>;
  function fillEqual() {
    if (!Number.isFinite(totalCents) || totalCents <= 0) return;
    const base = Math.floor(totalCents / wallets.length);
    let used = 0;
    const next: Record<string, string> = {};
    wallets.forEach((wallet, index) => {
      const cents = index === wallets.length - 1 ? totalCents - used : base;
      used += cents;
      next[wallet.id] = (cents / 100).toFixed(2);
    });
    setParts(next);
  }
  return (
    <form className="grid gap-3 rounded-2xl bg-card p-4" onSubmit={async (event) => {
      event.preventDefault();
      try {
        if (mode === "move") {
          if (!to) throw new Error("Add another person first");
          await transferFamilyMoney({ data: { familyId, fromAccountId: from, toAccountId: to, amount, date: today } });
          toast.success("Moved");
        } else if (mode === "out" && split) {
          if (!what.trim()) throw new Error("Say what it was");
          if (leftCents !== 0) throw new Error("The parts have to add up to the total");
          const chosen = wallets
            .map((wallet) => ({ accountId: wallet.id, amount: parts[wallet.id] || "" }))
            .filter((part) => Number(part.amount) > 0);
          await postFamilySplit({ data: { familyId, date: today, category: what.trim(), parts: chosen } });
          toast.success("Split saved");
        } else {
          await postFamilyEntry({
            data: {
              familyId,
              kind: mode === "in" ? "contribution" : "expense",
              amount,
              date: today,
              accountId: from,
              category: mode === "out" ? what : undefined,
              note: mode === "in" ? (what.trim() || undefined) : undefined,
              paidFrom: "family",
            },
          });
          toast.success(mode === "in" ? "Added" : "Saved");
        }
        await onSaved();
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save");
      }
    }}>
      {!(mode === "out" && split) && (
        <>
          <p className="text-sm font-medium">{mode === "in" ? "Into whose account?" : mode === "out" ? "From whose account?" : "From"}</p>
          <div className="flex flex-wrap gap-2">
            {wallets.map((wallet) => (
              <button key={wallet.id} type="button" onClick={() => setFromId(wallet.id)} className={`h-10 max-w-full truncate rounded-full px-3 text-sm ${from === wallet.id ? "bg-foreground text-background" : "bg-secondary"}`}>
                {wallet.name}
              </button>
            ))}
          </div>
        </>
      )}
      {mode === "move" && (
        <>
          <p className="text-sm font-medium">To</p>
          <div className="flex flex-wrap gap-2">
            {wallets.filter((wallet) => wallet.id !== from).map((wallet) => (
              <button key={wallet.id} type="button" onClick={() => setToId(wallet.id)} className={`h-10 max-w-full truncate rounded-full px-3 text-sm ${to === wallet.id ? "bg-foreground text-background" : "bg-secondary"}`}>
                {wallet.name}
              </button>
            ))}
          </div>
        </>
      )}
      <Input inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Amount" className="h-12 text-lg" />
      {mode !== "move" && (
        <Input placeholder={mode === "out" ? "Fees, groceries, rent…" : "What for, optional"} value={what} onChange={(event) => setWhat(event.target.value)} aria-label="What for" />
      )}
      {mode === "out" && wallets.length > 1 && (
        <button
          type="button"
          className="h-10 text-left text-sm text-muted-foreground"
          onClick={() => {
            setSplit((open) => !open);
          }}
        >
          {split ? "One account instead" : "Split between us"}
        </button>
      )}
      {mode === "out" && split && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">From each account</p>
            <button type="button" className="text-sm text-muted-foreground" onClick={fillEqual}>Equal</button>
          </div>
          {wallets.map((wallet) => (
            <label key={wallet.id} className="grid grid-cols-[1fr_7rem] items-center gap-2">
              <span className="truncate text-sm">{wallet.name}</span>
              <Input
                inputMode="decimal"
                placeholder="0"
                value={parts[wallet.id] || ""}
                onChange={(event) => setParts((current) => ({ ...current, [wallet.id]: event.target.value }))}
                aria-label={`${wallet.name} share`}
              />
            </label>
          ))}
          <p className={`text-xs ${leftCents === 0 ? "text-muted-foreground" : "text-destructive"}`}>
            {leftCents === 0 ? "Adds up." : `Left ${leftCents > 0 ? "" : "over by "}${formatMoney((Math.abs(leftCents) / 100).toFixed(2), "INR", { sign: "never" })}`}
          </p>
        </div>
      )}
      {mode === "move" && <p className="text-xs text-muted-foreground">Family total stays the same. This is not an expense.</p>}
      <Button type="submit" className="h-12">{mode === "in" ? "Add money" : mode === "out" ? "Save expense" : "Move"}</Button>
    </form>
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

function roleWord(role: string) {
  if (role === "owner") return "Owner";
  if (role === "adult") return "Adult";
  if (role === "viewer") return "Can only look";
  return "Member";
}

function ActionButton({ label, open, onClick }: { label: string; open: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`h-11 rounded-xl px-3 text-left text-sm ${open ? "bg-foreground text-background" : "bg-card"}`}>
      {label}
    </button>
  );
}

export function InviteByEmail({
  familyId,
  invites,
  onSaved,
  canHide = false,
}: {
  familyId: string;
  invites: { id: string; email: string | null; state: string; path: string | null }[];
  onSaved: () => Promise<void>;
  canHide?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [menu, setMenu] = useState(false);
  const open = invites.filter((invite) => invite.state === "open");

  async function linkFor(invite: { id: string; path: string | null }) {
    if (invite.path) return `${window.location.origin}${invite.path}`;
    const fresh = await copyFamilyInviteLink({ data: { familyId, inviteId: invite.id } });
    await onSaved();
    return `${window.location.origin}${fresh?.path ?? ""}`;
  }

  async function copy(invite: { id: string; path: string | null }) {
    const url = await linkFor(invite);
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  }

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Invite</p>
        {canHide && (
          <div className="relative">
            <button type="button" aria-label="Invite options" className="grid h-9 w-9 place-items-center rounded-full text-lg text-muted-foreground" onClick={() => setMenu((value) => !value)}>
              ···
            </button>
            {menu && (
              <button
                type="button"
                className="absolute right-0 z-10 w-44 rounded-xl bg-card px-3 py-3 text-left text-sm shadow-[var(--elev-shadow)]"
                onClick={() => {
                  setMenu(false);
                  void setFamilyInvitesVisible({ data: { familyId, show: false } })
                    .then(onSaved)
                    .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't hide"));
                }}
              >
                Hide from this screen
              </button>
            )}
          </div>
        )}
      </div>
      <form className="flex gap-2" onSubmit={async (event) => {
        event.preventDefault();
        try {
          const saved = await inviteFamilyMember({
            data: { familyId, email, origin: window.location.origin, role: "adult" },
          });
          setEmail("");
          if (saved?.emailed) toast.success(`Invite emailed to ${saved.email}`);
          else toast.error(saved?.mailError || "Email didn't send. Use Copy on the invite.");
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't invite");
        }
      }}>
        <Input type="email" placeholder="Their email" value={email} onChange={(event) => setEmail(event.target.value)} aria-label="Invite email" />
        <Button type="submit" className="h-11 shrink-0">Invite</Button>
      </form>
      {open.map((invite) => (
        <div key={invite.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-muted-foreground">{invite.email || "Invite"} · waiting</span>
          <span className="flex shrink-0 gap-3">
            <button type="button" className="text-muted-foreground" onClick={() => void copy(invite).catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't copy"))}>Copy</button>
            <button type="button" className="text-expense" onClick={() => void revokeFamilyInvite({ data: { familyId, inviteId: invite.id } }).then(onSaved)}>Revoke</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function QuickPerson({ familyId, startOpen, onSaved }: { familyId: string; startOpen: boolean; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  if (!open) {
    return <button type="button" className="h-11 text-left text-sm text-muted-foreground" onClick={() => setOpen(true)}>+ Add someone</button>;
  }
  return (
    <form className="flex gap-2 pt-2" onSubmit={async (event) => {
      event.preventDefault();
      try {
        await addFamilyPerson({ data: { familyId, name, role: "adult" } });
        setName("");
        setOpen(false);
        toast.success("Added. Their account is ready.");
        await onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't add");
      }
    }}>
      <Input placeholder="Dad, Mom, or anyone" value={name} onChange={(event) => setName(event.target.value)} aria-label="Person name" />
      <Button type="submit" className="h-11 shrink-0">Add</Button>
    </form>
  );
}

function QuickAccount({ familyId, startOpen, onSaved }: { familyId: string; startOpen: boolean; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  if (!open) {
    return <button type="button" className="h-11 text-left text-sm text-muted-foreground" onClick={() => setOpen(true)}>Add an account</button>;
  }
  return (
    <form className="grid gap-2" onSubmit={async (event) => {
      event.preventDefault();
      try {
        await addFamilyAccount({ data: { familyId, name, balance: opening || "0" } });
        setName("");
        setOpening("");
        toast.success("Account added");
        await onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't add");
      }
    }}>
      <Input placeholder="Family cash" value={name} onChange={(event) => setName(event.target.value)} aria-label="Account name" />
      <Input inputMode="decimal" placeholder="Already in it, optional" value={opening} onChange={(event) => setOpening(event.target.value)} aria-label="Starting amount" />
      <Button type="submit" className="h-11">Add account</Button>
    </form>
  );
}

async function personForEntry(familyId: string, personId: string, newName: string, canPeople: boolean) {
  if (personId !== "__new__") return personId || undefined;
  if (!canPeople) throw new Error("Ask the owner to add that person");
  const created = await addFamilyPerson({ data: { familyId, name: newName, role: "adult" } });
  if (!created?.id) throw new Error("Couldn't add that person");
  return created.id;
}

function ContributionForm({ familyId, people, accounts, today, can, canPeople, onSaved }: {
  familyId: string;
  people: { id: string; display_name: string }[];
  accounts: { id: string; name: string }[];
  today: string;
  can: boolean;
  canPeople: boolean;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const chosen = personId === "__new__" || people.some((person) => person.id === personId) ? personId : (people[0]?.id ?? "");
  if (!can) return null;
  return (
    <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
      event.preventDefault();
      try {
        const id = await personForEntry(familyId, chosen, newName, canPeople);
        await postFamilyEntry({ data: { familyId, kind: "contribution", amount, date: today, personId: id, accountId: accountId || undefined } });
        setAmount("");
        setNewName("");
        setPersonId(id || "");
        toast.success("Added to the family");
        await onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save");
      }
    }}>
      <p className="text-sm font-medium">Who added money</p>
      <Input inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Amount added" />
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={chosen} onChange={(event) => setPersonId(event.target.value)} aria-label="From">
        {people.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}
        {canPeople && <option value="__new__">Add someone new</option>}
      </select>
      {chosen === "__new__" && (
        <Input placeholder="Their name" value={newName} onChange={(event) => setNewName(event.target.value)} aria-label="New person" />
      )}
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Into">
        <option value="">Not in a family account yet</option>
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <Button type="submit" className="h-11">Add</Button>
    </form>
  );
}

function ExpenseForm({ familyId, people, accounts, today, can, canPeople, onSaved }: {
  familyId: string;
  people: { id: string; display_name: string }[];
  accounts: { id: string; name: string }[];
  today: string;
  can: boolean;
  canPeople: boolean;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [paidFrom, setPaidFrom] = useState<"family" | "personal">(accounts.length ? "family" : "personal");
  const [reimburse, setReimburse] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const chosen = personId === "__new__" || people.some((person) => person.id === personId) ? personId : (people[0]?.id ?? "");
  const account = accounts.some((row) => row.id === accountId) ? accountId : (accounts[0]?.id ?? "");
  if (!can) return null;
  return (
    <form className="grid gap-2 rounded-xl bg-card p-4" onSubmit={async (event) => {
      event.preventDefault();
      try {
        if (paidFrom === "family" && !account) throw new Error("Add a shared account above first");
        const id = await personForEntry(familyId, chosen, newName, canPeople);
        await postFamilyEntry({
          data: { familyId, kind: "expense", amount, date: today, category, personId: id, paidFrom, reimburse: paidFrom === "personal" && reimburse, accountId: paidFrom === "family" ? account : undefined },
        });
        setAmount("");
        setNewName("");
        setPersonId(id || "");
        toast.success("Expense saved");
        await onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save");
      }
    }}>
      <p className="text-sm font-medium">What the house spent</p>
      <Input inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Expense amount" />
      <Input placeholder="Groceries, rent, electricity" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="What for" />
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={chosen} onChange={(event) => setPersonId(event.target.value)} aria-label="Who">
        {people.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}
        {canPeople && <option value="__new__">Add someone new</option>}
      </select>
      {chosen === "__new__" && (
        <Input placeholder="Their name" value={newName} onChange={(event) => setNewName(event.target.value)} aria-label="New person" />
      )}
      <select className="h-11 rounded-md bg-secondary px-3 text-base" value={paidFrom} onChange={(event) => setPaidFrom(event.target.value as "family" | "personal")} aria-label="Paid from">
        <option value="family">From family money</option>
        <option value="personal">They paid it themselves</option>
      </select>
      {paidFrom === "family" && accounts.length > 0 && (
        <select className="h-11 rounded-md bg-secondary px-3 text-base" value={account} onChange={(event) => setAccountId(event.target.value)} aria-label="Family account">
          {accounts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      )}
      {paidFrom === "family" && accounts.length === 0 && (
        <p className="text-sm text-muted-foreground">Add a shared account above before paying from family money.</p>
      )}
      {paidFrom === "personal" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={reimburse} onChange={(event) => setReimburse(event.target.checked)} />
          Family should pay this person back
        </label>
      )}
      <Button type="submit" className="h-11">Save</Button>
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
      {budgets.length === 0 && <p className="text-sm text-muted-foreground">No limit yet. Groceries or electricity is a good start.</p>}
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
      {goals.length === 0 && <p className="text-sm text-muted-foreground">No goal yet. An emergency fund or a wedding both fit.</p>}
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
          <p key={personRow.id} className="text-sm">{personRow.display_name} · <span className="capitalize text-muted-foreground">{personRow.role}</span></p>
        ))}
        {data.canPeople && (
          <InviteByEmail familyId={familyId} invites={data.invites} onSaved={onSaved} />
        )}
        {data.canPeople && !data.showInvites && (
          <button type="button" className="h-11 text-left text-sm text-muted-foreground" onClick={() => void setFamilyInvitesVisible({ data: { familyId, show: true } }).then(onSaved)}>
            Show invites on the money screen
          </button>
        )}
      </section>
      <section className="space-y-2">
        <p className="text-sm font-medium">Extra accounts</p>
        <p className="text-sm text-muted-foreground">Each person already has an account, counted in the family total. Add one only for a shared pot.</p>
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
