import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ASSET_KINDS, type AssetKind } from "@/lib/depreciation";
import { formatMoney } from "@/lib/money";
import { ordinal } from "@/lib/month-plan";
import { allowCutReminders } from "@/lib/bill-reminders";
import {
  BILL_KINDS,
  defaultUsefulYears,
  deleteAsset,
  deleteBill,
  saveAsset,
  saveBill,
  setAssetActive,
  setBillActive,
  type AssetView,
  type BillKind,
  type BillRow,
} from "@/lib/server/commitments";
import { cn, todayISO } from "@/lib/utils";
import type { Account } from "@/lib/types";

const BILL_LABEL: Record<BillKind, string> = {
  emi: "EMI",
  rent: "Rent",
  subscription: "Subscription",
  bill: "Bill",
  other: "Other",
};

const ASSET_LABEL: Record<AssetKind, string> = {
  vehicle: "Vehicle",
  property: "Property",
  gadget: "Gadget",
  other: "Other",
};

export function CommitmentsPanel({
  accounts,
  bills,
  assets,
  bookValue,
  paperDrop,
  currency,
  onChanged,
}: {
  accounts: Account[];
  bills: BillRow[];
  assets: AssetView[];
  bookValue: string;
  paperDrop: string;
  currency: string;
  onChanged: () => Promise<void>;
}) {
  return (
    <>
      <BillsBlock accounts={accounts} bills={bills} currency={currency} onChanged={onChanged} />
      <AssetsBlock
        assets={assets}
        bookValue={bookValue}
        paperDrop={paperDrop}
        currency={currency}
        onChanged={onChanged}
      />
    </>
  );
}

function BillsBlock({
  accounts,
  bills,
  currency,
  onChanged,
}: {
  accounts: Account[];
  bills: BillRow[];
  currency: string;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("Bike EMI");
  const [kind, setKind] = useState<BillKind>("emi");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("5");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedAccount = accountId || accounts[0]?.id || "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedAccount) {
      toast.error("Add an account first");
      return;
    }
    setBusy(true);
    try {
      await saveBill({
        data: { id: editing ?? undefined, name, kind, amount, dayOfMonth: Number(day), accountId: selectedAccount },
      });
      toast.success(editing ? "Bill updated" : "Bill saved");
      const cut = ordinal(Number(day) || 1);
      if (!editing) {
        const perm = await allowCutReminders();
        if (perm === "granted") toast.message(`On the ${cut} each month, your phone asks if it was deducted.`);
        else if (perm === "denied") toast.message(`Home will ask on the ${cut}. Phone reminders are off.`);
        else toast.message(`Home will ask on the ${cut}.`);
      }
      setEditing(null);
      setAmount("");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="bills" className="space-y-3 scroll-mt-24">
      <div>
        <h2 className="text-sm font-medium">Money out</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          EMI, rent, subscriptions, bills. Cuts on is the day the money leaves. From that day, home and your phone ask if it was deducted. Until you say yes, the month holds that amount back.
        </p>
      </div>
      {bills.length > 0 && (
        <ul className="space-y-2">
          {bills.map((bill) => (
            <li key={bill.id} className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
              <div className="flex items-baseline justify-between gap-3">
                <p className={cn("font-medium", !bill.isActive && "text-muted-foreground")}>{bill.name}</p>
                <p className="tabular text-sm">{formatMoney(bill.amount, currency)}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {BILL_LABEL[bill.kind]} · cuts the {ordinal(bill.dayOfMonth)} · {bill.accountName}
                {!bill.isActive ? " · Paused" : bill.checkin === "paid" ? " · Paid" : bill.checkin === "skipped" ? " · Skipped" : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    setEditing(bill.id);
                    setName(bill.name);
                    setKind(bill.kind);
                    setAmount(bill.amount.replace(/\.00$/, ""));
                    setDay(String(bill.dayOfMonth));
                    setAccountId(bill.accountId);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() =>
                    void setBillActive({ data: { id: bill.id, isActive: !bill.isActive } })
                      .then(onChanged)
                      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't update"))
                  }
                >
                  {bill.isActive ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    if (!window.confirm(`Remove ${bill.name}? Past payments stay.`)) return;
                    void deleteBill({ data: { id: bill.id } })
                      .then(onChanged)
                      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't remove"));
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {accounts.length > 0 && (
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
          <div className="grid grid-cols-2 gap-2">
            {BILL_KINDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setKind(id);
                  if (!editing) setName(id === "emi" ? "Bike EMI" : id === "rent" ? "House rent" : id === "subscription" ? "Subscriptions" : "");
                }}
                className={cn(
                  "h-11 rounded-md text-sm font-medium",
                  kind === id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                )}
              >
                {BILL_LABEL[id]}
              </button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bill-name">Name</Label>
            <Input id="bill-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bill-amount">Amount</Label>
              <Input
                id="bill-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bill-day">Cuts on</Label>
              <Input
                id="bill-day"
                inputMode="numeric"
                value={day}
                onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Every month on the {ordinal(Math.min(31, Math.max(1, Number(day) || 1)))}: was this deducted, or not yet? Same for EMI, rent, subscriptions and bills. Short months use the last day.
          </p>
          <div className="grid gap-1.5">
            <Label>Leaves</Label>
            <Select value={selectedAccount} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {editing ? "Save changes" : "Save bill"}
            </Button>
            {editing && (
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function AssetsBlock({
  assets,
  bookValue,
  paperDrop,
  currency,
  onChanged,
}: {
  assets: AssetView[];
  bookValue: string;
  paperDrop: string;
  currency: string;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("vehicle");
  const [purchase, setPurchase] = useState("");
  const [salvage, setSalvage] = useState("");
  const [bought, setBought] = useState(todayISO());
  const [years, setYears] = useState("8");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await saveAsset({
        data: {
          id: editing ?? undefined,
          name,
          kind,
          purchaseAmount: purchase,
          salvageAmount: salvage,
          purchaseDate: bought,
          usefulYears: Number(years),
        },
      });
      toast.success(editing ? "Asset updated" : "Asset saved");
      setEditing(null);
      setPurchase("");
      setSalvage("");
      setName("");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="assets" className="space-y-3 scroll-mt-24">
      <div>
        <h2 className="text-sm font-medium">Things you own</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Straight-line drop in value. This is on paper only. It does not reduce the cash you can spend today.
        </p>
      </div>
      {assets.some((asset) => asset.isActive) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">Worth now</p>
            <p className="mt-1 font-display text-lg tracking-tight tabular">{formatMoney(bookValue, currency)}</p>
          </div>
          <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">Drops / month</p>
            <p className="mt-1 font-display text-lg tracking-tight tabular">{formatMoney(paperDrop, currency)}</p>
          </div>
        </div>
      )}
      {assets.length > 0 && (
        <ul className="space-y-2">
          {assets.map((asset) => (
            <li key={asset.id} className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
              <div className="flex items-baseline justify-between gap-3">
                <p className={cn("font-medium", !asset.isActive && "text-muted-foreground")}>{asset.name}</p>
                <p className="tabular text-sm">{formatMoney(asset.bookValue, currency)}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {ASSET_LABEL[asset.kind]}
                {asset.isActive
                  ? asset.finished
                    ? " · Fully written down"
                    : ` · drops ${formatMoney(asset.monthly, currency)} a month · ${asset.monthsUsed} of ${asset.lifeMonths} months`
                  : " · Sold or retired"}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    setEditing(asset.id);
                    setName(asset.name);
                    setKind(asset.kind);
                    setPurchase(asset.purchaseAmount.replace(/\.00$/, ""));
                    setSalvage(asset.salvageAmount === "0.00" ? "" : asset.salvageAmount.replace(/\.00$/, ""));
                    setBought(asset.purchaseDate);
                    setYears(String(asset.usefulYears));
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() =>
                    void setAssetActive({ data: { id: asset.id, isActive: !asset.isActive } })
                      .then(onChanged)
                      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't update"))
                  }
                >
                  {asset.isActive ? "Mark sold" : "Own again"}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    if (!window.confirm(`Remove ${asset.name}?`)) return;
                    void deleteAsset({ data: { id: asset.id } })
                      .then(onChanged)
                      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't remove"));
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
        <div className="grid grid-cols-2 gap-2">
          {ASSET_KINDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setKind(id);
                if (!editing) setYears(String(defaultUsefulYears(id)));
              }}
              className={cn(
                "h-11 rounded-md text-sm font-medium",
                kind === id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
              )}
            >
              {ASSET_LABEL[id]}
            </button>
          ))}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="asset-name">Name</Label>
          <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bike" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="asset-paid">Bought for</Label>
            <Input
              id="asset-paid"
              inputMode="decimal"
              value={purchase}
              onChange={(e) => setPurchase(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-end">Worth at the end</Label>
            <Input
              id="asset-end"
              inputMode="decimal"
              value={salvage}
              onChange={(e) => setSalvage(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="asset-date">Bought on</Label>
            <Input id="asset-date" type="date" value={bought} onChange={(e) => setBought(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-years">Lasts (years)</Label>
            <Input
              id="asset-years"
              inputMode="numeric"
              value={years}
              onChange={(e) => setYears(e.target.value.replace(/\D/g, "").slice(0, 2))}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {editing ? "Save changes" : "Save asset"}
          </Button>
          {editing && (
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
