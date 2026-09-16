import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategoryIcon } from "@/components/finance/icons";
import { useAppData } from "@/components/data-provider";
import { compressReceipt } from "@/lib/receipt";
import { parseMoney } from "@/lib/money";
import { cn, todayISO } from "@/lib/utils";
import type { Transaction, TxnType } from "@/lib/types";
import type { TxnInput } from "@/lib/server/transactions";
import { toast } from "sonner";

const TYPES: { id: TxnType; label: string }[] = [
  { id: "expense", label: "Expense" },
  { id: "income", label: "Income" },
  { id: "transfer", label: "Transfer" },
  { id: "refund", label: "Refund" },
];

export type TxnFormDefaults = {
  type?: TxnType;
  categoryName?: string;
  projectId?: string;
  accountId?: string;
  isPrepaid?: boolean;
};

export function TxnForm({
  initial,
  defaults,
  onSaved,
  onCancel,
}: {
  initial?: Transaction | null;
  defaults?: TxnFormDefaults;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const { data, saveTxn, today } = useAppData();
  const accounts = (data?.accounts ?? []).filter((a) => a.isActive);
  const categories = data?.categories ?? [];
  const projects = (data?.projects ?? []).filter((p) => p.status !== "archived");

  const [type, setType] = useState<TxnType>(initial?.type ?? defaults?.type ?? "expense");
  const [amount, setAmount] = useState(initial ? initial.amount.replace(/\.00$/, "") : "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaults?.accountId ?? accounts[0]?.id ?? "");
  const [destId, setDestId] = useState(initial?.counterpartyAccountId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? defaults?.projectId ?? "");
  const [date, setDate] = useState(initial?.transactionDate ?? todayISO());
  const [description, setDescription] = useState(initial?.description ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [prepaid, setPrepaid] = useState(initial?.isPrepaid ?? defaults?.isPrepaid ?? false);
  const [committed, setCommitted] = useState(initial?.isCommitted ?? true);
  const [receipt, setReceipt] = useState<{ fileName: string; mimeType: string; dataUrl: string } | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(Boolean(initial));

  useEffect(() => {
    if (defaults?.categoryName && !initial) {
      const match = categories.find(
        (c) => c.name.toLowerCase() === defaults.categoryName!.toLowerCase() && c.type === (defaults.type ?? "expense"),
      );
      if (match) setCategoryId(match.id);
    }
  }, [defaults?.categoryName, defaults?.type, categories, initial]);

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accountId, accounts]);

  const visibleCats = useMemo(() => {
    const want = type === "income" || type === "refund" ? "income" : "expense";
    return categories.filter((c) => c.isActive && c.type === want);
  }, [categories, type]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accounts.length) {
      toast.error("Add an account first");
      return;
    }
    let parsed: string;
    try {
      parsed = parseMoney(amount);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enter a valid amount");
      return;
    }
    setBusy(true);
    try {
      const payload: TxnInput = {
        id: initial?.id,
        accountId,
        categoryId: type === "transfer" ? null : categoryId || null,
        projectId: projectId || null,
        counterpartyAccountId: type === "transfer" ? destId : null,
        type,
        amount: parsed,
        transactionDate: date,
        description: description.trim() || null,
        notes: notes.trim() || null,
        isPrepaid: prepaid,
        isCommitted: committed,
        receipt,
        removeReceipt,
      };
      await saveTxn(payload);
      toast.success(initial ? "Transaction updated" : "Saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const compressed = await compressReceipt(file);
      setReceipt(compressed);
      setRemoveReceipt(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't attach receipt");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div>
        <input
          inputMode="decimal"
          autoComplete="off"
          autoFocus={!initial}
          aria-label="Amount"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          className="w-full bg-transparent font-display text-5xl tracking-tight tabular outline-none placeholder:text-muted-foreground/40"
        />
      </div>

      <div className="flex gap-1 rounded-lg bg-secondary p-1">
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setType(t.id)}
            className={cn(
              "h-9 flex-1 rounded-md text-xs font-medium transition-colors",
              type === t.id ? "bg-card text-foreground shadow-[var(--elev-shadow)]" : "text-muted-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {type !== "transfer" && (
        <div className="space-y-2">
          <Label>Category</Label>
          <div className="flex flex-wrap gap-1.5">
            {visibleCats.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                  categoryId === c.id ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
                )}
              >
                <CategoryIcon name={c.icon} className="size-3.5" />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>{type === "transfer" ? "From" : "Account"}</Label>
        <div className="flex flex-wrap gap-1.5">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAccountId(a.id)}
              className={cn(
                "inline-flex h-9 items-center rounded-full px-3 text-xs font-medium",
                accountId === a.id ? "bg-primary text-primary-foreground" : "bg-secondary",
              )}
            >
              {a.name}
            </button>
          ))}
        </div>
      </div>

      {type === "transfer" && (
        <div className="space-y-2">
          <Label>To</Label>
          <div className="flex flex-wrap gap-1.5">
            {accounts
              .filter((a) => a.id !== accountId)
              .map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setDestId(a.id)}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full px-3 text-xs font-medium",
                    destId === a.id ? "bg-primary text-primary-foreground" : "bg-secondary",
                  )}
                >
                  {a.name}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Project</Label>
        <Select value={projectId || "none"} onValueChange={(v) => setProjectId(v === "none" ? "" : v)}>
          <SelectTrigger>
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No project</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <button
        type="button"
        className="self-start text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
        onClick={() => setMore((m) => !m)}
      >
        {more ? "Less detail" : "Date, notes, receipt"}
      </button>

      {more && (
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="txn-date">Date</Label>
            <Input id="txn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="txn-desc">Description</Label>
            <Input id="txn-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="txn-notes">Notes</Label>
            <Textarea id="txn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Prepaid
            <Switch checked={prepaid} onCheckedChange={setPrepaid} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Committed
            <Switch checked={committed} onCheckedChange={setCommitted} />
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="txn-receipt">Receipt</Label>
            <Input
              id="txn-receipt"
              type="file"
              accept="image/*"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {(receipt || (initial?.hasReceipt && !removeReceipt)) && (
              <button
                type="button"
                className="text-left text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  setReceipt(null);
                  setRemoveReceipt(true);
                }}
              >
                Remove receipt
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={busy}>
          {busy ? "Saving…" : initial ? "Update" : "Save"}
        </Button>
      </div>
    </form>
  );
}
