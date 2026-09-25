import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  acceptInvite,
  addProjectExpense,
  createProjectInvite,
  createSettlement,
  getProjectBalances,
  leaveProject,
  listProjectInvites,
  listProjectMembers,
  removeProjectMember,
  revokeInvite,
} from "@/lib/server/collab";
import { formatMoney, isNegative, isZero } from "@/lib/money";
import { allocateSplits, type SplitMethod } from "@/lib/split";
import { todayISO } from "@/lib/utils";
import { toast } from "sonner";

export function ProjectCollab({ projectId }: { projectId: string }) {
  const { currency, data, refresh } = useAppData();
  const qc = useQueryClient();
  const [membersOpen, setMembersOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => listProjectMembers({ data: { projectId } }),
  });
  const balances = useQuery({
    queryKey: ["project-balances", projectId],
    queryFn: () => getProjectBalances({ data: { projectId } }),
    refetchInterval: 20_000,
  });

  const rawPeople = members.data?.members ?? [];
  const seen = new Set<string>();
  const people = rawPeople.filter((person) => {
    if (seen.has(person.userId)) return false;
    seen.add(person.userId);
    return true;
  });
  const isOwner = members.data?.role === "owner";
  const invites = useQuery({
    queryKey: ["project-invites", projectId],
    queryFn: () => listProjectInvites({ data: { projectId } }),
    enabled: isOwner,
  });
  const you = balances.data?.you ?? "0.00";
  const settled = isZero(you);
  const owed = !isNegative(you) && !settled;
  const spend = balances.data?.spend;

  async function reload() {
    await Promise.all([
      members.refetch(),
      balances.refetch(),
      invites.refetch(),
      qc.invalidateQueries({ queryKey: ["project", projectId] }),
      refresh(),
    ]);
  }

  if (members.data && members.data.collaboration !== "collaborative") {
    return (
      <section className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
        <p className="text-sm font-medium">Split this project</p>
        <p className="mt-1 text-sm text-muted-foreground">Invite friends. Your existing expenses stay personal.</p>
        <Button
          className="mt-3 h-11"
          onClick={async () => {
            const res = await createProjectInvite({ data: { projectId } });
            const url = `${window.location.origin}${res?.path ?? ""}`;
            setLink(url);
            await navigator.clipboard?.writeText(url).catch(() => undefined);
            toast.success("Invite link copied");
            await reload();
          }}
        >
          Invite friend
        </Button>
        {link && <p className="mt-2 break-all text-xs text-muted-foreground">{link}</p>}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Group</h2>
        <button type="button" className="inline-flex h-11 items-center text-sm text-muted-foreground" onClick={() => setMembersOpen(true)}>
          {isOwner ? "Invite" : "Members"}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {people.map((person) => (
          <button
            key={person.userId}
            type="button"
            onClick={() => setMembersOpen(true)}
            className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-card py-1 pr-3 pl-1 shadow-[var(--elev-shadow)]"
          >
            <span className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-medium">
              {(person.name.trim()[0] || "?").toUpperCase()}
            </span>
            <span className="text-sm">{person.name}</span>
          </button>
        ))}
      </div>
      {spend && !isZero(spend.sharedSpend) && (
        <div className="grid grid-cols-3 gap-2">
          <Mini label="Shared" value={formatMoney(spend.sharedSpend, currency)} />
          <Mini label="You paid" value={formatMoney(spend.youPaid, currency)} />
          <Mini label="Your share" value={formatMoney(spend.yourShare, currency)} />
        </div>
      )}
      <BalanceCard
        settled={settled}
        owed={owed}
        you={you}
        currency={currency}
        payments={balances.data?.payments ?? []}
        privatePayments={balances.data?.privatePayments ?? []}
        quiet={settled && (balances.data?.payments ?? []).length === 0 && (balances.data?.privatePayments ?? []).length === 0 && (!spend || isZero(spend.sharedSpend))}
        onAdd={() => setExpenseOpen(true)}
        onSettle={() => setSettleOpen(true)}
      />
      {(balances.data?.history ?? []).length > 0 && (
        <div className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
          <p className="text-sm font-medium">Settlements</p>
          <div className="mt-2 space-y-2">
            {balances.data?.history.map((item) => (
              <p key={item.id} className="text-sm text-muted-foreground">
                {item.fromName} paid {item.toName} {formatMoney(item.amount, currency)} · {item.method}
              </p>
            ))}
          </div>
        </div>
      )}

      <Sheet open={membersOpen} onOpenChange={setMembersOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Members</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6">
            {people.map((p) => (
              <div key={p.userId} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs capitalize text-muted-foreground">{p.role}</p>
                </div>
                {isOwner && p.role !== "owner" && (
                  <Button
                    variant="ghost"
                    className="text-expense"
                    onClick={async () => {
                      await removeProjectMember({ data: { projectId, userId: p.userId } });
                      toast.success("Removed");
                      await reload();
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            {isOwner && (invites.data?.invites ?? []).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs tracking-wide text-muted-foreground uppercase">Open invites</p>
                {invites.data?.invites.map((invite) => (
                  <div key={invite.id} className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">Link expires {invite.expiresAt.slice(0, 10)}</p>
                    <Button
                      variant="ghost"
                      className="text-expense"
                      onClick={async () => {
                        await revokeInvite({ data: { inviteId: invite.id } });
                        toast.success("Invite revoked");
                        await reload();
                      }}
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {isOwner ? (
              <Button
                className="h-11 w-full"
                onClick={async () => {
                  const res = await createProjectInvite({ data: { projectId } });
                  const path = res?.path ?? "";
                  const url = `${window.location.origin}${path}`;
                  setLink(url);
                  await navigator.clipboard?.writeText(url).catch(() => undefined);
                  toast.success("Invite link copied");
                  await reload();
                }}
              >
                Invite friend
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="h-11 w-full"
                onClick={async () => {
                  await leaveProject({ data: { projectId } });
                  toast.success("You left the project");
                  window.location.href = "/projects";
                }}
              >
                Leave project
              </Button>
            )}
            {link && <p className="break-all text-xs text-muted-foreground">{link}</p>}
          </div>
        </SheetContent>
      </Sheet>

      <ExpenseSheet
        key={people.map((p) => p.userId).join(",")}
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        projectId={projectId}
        people={people}
        accounts={data?.accounts.filter((a) => a.isActive) ?? []}
        categories={data?.categories.filter((c) => c.type === "expense" && c.isActive) ?? []}
        currency={currency}
        onSaved={reload}
      />
      <SettleSheet
        open={settleOpen}
        onOpenChange={setSettleOpen}
        projectId={projectId}
        people={people}
        suggestion={balances.data?.payments[0]}
        onSaved={reload}
      />
    </section>
  );
}

function ExpenseSheet({
  open,
  onOpenChange,
  projectId,
  people,
  accounts,
  categories,
  currency,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  people: { userId: string; name: string }[];
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  currency: string;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [visibility, setVisibility] = useState<"shared" | "personal" | "private">("shared");
  const [paidBy, setPaidBy] = useState(people[0]?.userId ?? "");
  const [picked, setPicked] = useState<string[]>(people.map((p) => p.userId));
  const [method, setMethod] = useState<SplitMethod>("equal");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await addProjectExpense({
        data: {
          projectId,
          accountId,
          categoryId: categoryId || null,
          amount,
          description,
          transactionDate: date,
          visibility,
          paidByUserId: paidBy,
          method,
          parts: picked.map((id) => ({ userId: id, value: values[id] || "1" })),
        },
      });
      toast.success("Expense added");
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add expense</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-8">
          <Field label="Amount">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11" />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-11" />
          </Field>
          <div className="grid grid-cols-3 gap-1 rounded-full bg-secondary p-1">
            {(["shared", "personal", "private"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                className={`h-10 rounded-full text-sm capitalize ${visibility === v ? "bg-card font-medium" : "text-muted-foreground"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <Field label="Account">
            <select className="h-11 w-full rounded-md bg-secondary px-3" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select className="h-11 w-full rounded-md bg-secondary px-3" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
          </Field>
          {visibility !== "personal" && (
            <>
              <Field label="Paid by">
                <select className="h-11 w-full rounded-md bg-secondary px-3" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                  {people.map((p) => (
                    <option key={p.userId} value={p.userId}>{p.name}</option>
                  ))}
                </select>
              </Field>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Split between</p>
                <button type="button" className="text-xs text-muted-foreground" onClick={() => setPicked(picked.length === people.length ? [] : people.map((p) => p.userId))}>
                  {picked.length === people.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {people.map((p) => {
                  const on = picked.includes(p.userId);
                  return (
                    <button
                      key={p.userId}
                      type="button"
                      onClick={() => setPicked(on ? picked.filter((id) => id !== p.userId) : [...picked, p.userId])}
                      className={`h-10 rounded-full px-3 text-sm ${on ? "bg-foreground text-background" : "bg-secondary"}`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(["equal", "exact", "percentage", "shares"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(m)} className={`h-10 rounded-md text-xs capitalize ${method === m ? "bg-foreground text-background" : "bg-secondary"}`}>
                    {m === "percentage" ? "%" : m}
                  </button>
                ))}
              </div>
              {method !== "equal" &&
                picked.map((id) => {
                  const person = people.find((p) => p.userId === id);
                  return (
                    <Field key={id} label={person?.name ?? "Share"}>
                      <Input
                        inputMode="decimal"
                        className="h-11"
                        value={values[id] ?? ""}
                        onChange={(e) => setValues({ ...values, [id]: e.target.value })}
                      />
                    </Field>
                  );
                })}
              <SplitPreview
                amount={amount}
                method={method}
                picked={picked}
                values={values}
                people={people}
                currency={currency}
              />
            </>
          )}
          <Button className="sticky bottom-0 h-12 w-full" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save expense"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SettleSheet({
  open,
  onOpenChange,
  projectId,
  people,
  suggestion,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  people: { userId: string; name: string }[];
  suggestion?: { fromUserId: string; toUserId: string; amount: string };
  onSaved: () => Promise<void>;
}) {
  const [from, setFrom] = useState(suggestion?.fromUserId ?? people[0]?.userId ?? "");
  const [to, setTo] = useState(suggestion?.toUserId ?? people[1]?.userId ?? "");
  const [amount, setAmount] = useState(suggestion?.amount ?? "");
  const [method, setMethod] = useState<"upi" | "cash" | "bank" | "other">("upi");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await createSettlement({
        data: { projectId, fromUserId: from, toUserId: to, amount, paymentMethod: method, note },
      });
      toast.success("Settlement recorded");
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't settle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Settle up</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-8">
          <Field label="From">
            <select className="h-11 w-full rounded-md bg-secondary px-3" value={from} onChange={(e) => setFrom(e.target.value)}>
              {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="To">
            <select className="h-11 w-full rounded-md bg-secondary px-3" value={to} onChange={(e) => setTo(e.target.value)}>
              {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Amount">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11" />
          </Field>
          <Field label="Method">
            <select className="h-11 w-full rounded-md bg-secondary px-3" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-11" />
          </Field>
          <Button className="h-12 w-full" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Mark settled"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

function BalanceCard({
  settled,
  owed,
  you,
  currency,
  payments,
  privatePayments,
  quiet,
  onAdd,
  onSettle,
}: {
  settled: boolean;
  owed: boolean;
  you: string;
  currency: string;
  payments: { fromUserId: string; toUserId: string; fromName: string; toName: string; amount: string }[];
  privatePayments: { fromUserId: string; toUserId: string; fromName: string; toName: string; amount: string }[];
  quiet: boolean;
  onAdd: () => void;
  onSettle: () => void;
}) {
  return (
    <div className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
      {quiet ? (
        <p className="text-sm text-muted-foreground">
          Nothing shared yet. Your own expenses still come out of the budget above.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {settled ? "You're settled" : owed ? "You are owed" : "You owe"}
          </p>
          <p className={`mt-1 font-display text-2xl tabular ${!owed && !settled ? "text-expense" : ""}`}>
            {formatMoney(isNegative(you) ? you.slice(1) : you, currency)}
          </p>
          <div className="mt-3 space-y-2">
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to settle.</p>
            ) : (
              payments.map((payment) => (
                <p key={`${payment.fromUserId}-${payment.toUserId}-${payment.amount}`} className="text-sm">
                  {payment.fromName} pays {payment.toName} {formatMoney(payment.amount, currency)}
                </p>
              ))
            )}
          </div>
          {privatePayments.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-border pt-3">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Private, only the people involved</p>
              {privatePayments.map((payment) => (
                <p key={`p-${payment.fromUserId}-${payment.toUserId}-${payment.amount}`} className="text-sm">
                  {payment.fromName} pays {payment.toName} {formatMoney(payment.amount, currency)}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      <div className="mt-4 flex gap-2">
        <Button className="h-11 flex-1" onClick={onAdd}>
          Add expense
        </Button>
        <Button variant="secondary" className="h-11" onClick={onSettle}>
          Settle up
        </Button>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-sm font-medium tabular">{value}</p>
    </div>
  );
}

function SplitPreview({
  amount,
  method,
  picked,
  values,
  people,
  currency,
}: {
  amount: string;
  method: SplitMethod;
  picked: string[];
  values: Record<string, string>;
  people: { userId: string; name: string }[];
  currency: string;
}) {
  if (!amount || picked.length === 0) return null;
  let rows: { userId: string; allocated: string }[] = [];
  try {
    rows = allocateSplits(
      amount,
      method,
      picked.map((id) => ({ userId: id, value: values[id] || (method === "equal" || method === "shares" ? "1" : "0") })),
    );
  } catch (err) {
    return <p className="text-sm text-expense">{err instanceof Error ? err.message : "Check the split"}</p>;
  }
  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <p key={row.userId} className="flex justify-between text-sm">
          <span>{people.find((person) => person.userId === row.userId)?.name ?? "Member"}</span>
          <span className="tabular">{formatMoney(row.allocated, currency)}</span>
        </p>
      ))}
    </div>
  );
}

export { acceptInvite };
