import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAppData } from "@/components/data-provider";
import { EmptyState } from "@/components/finance/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { upsertAccount } from "@/lib/server/accounts";
import { ACCOUNT_TYPE_LABELS } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import type { Account, AccountType } from "@/lib/types";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/accounts/")({ component: AccountsPage });

function AccountsPage() {
  const { data, currency, refresh } = useAppData();
  const [open, setOpen] = useState(false);
  if (!data) return null;

  return (
    <div className="space-y-5 pt-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">Bank, cash, UPI, cards, wallets.</p>
        </div>
        <Button onClick={() => setOpen(true)}>New</Button>
      </header>

      {data.accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No accounts yet"
          body="Add UPI, cash, or a bank account to start recording."
          action="Add account"
          onAction={() => setOpen(true)}
        />
      ) : (
        <div className="grid gap-2">
          {data.accounts.map((a) => (
            <Link
              key={a.id}
              to="/accounts/$id"
              params={{ id: a.id }}
              className={cn(
                "rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]",
                !a.isActive && "opacity-60",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[a.type]}</p>
              </div>
              <p className="mt-2 font-display text-2xl tabular">{formatMoney(a.currentBalance, currency)}</p>
            </Link>
          ))}
        </div>
      )}

      <AccountSheet
        open={open}
        onOpenChange={setOpen}
        onSaved={async () => {
          setOpen(false);
          await refresh();
        }}
      />
    </div>
  );
}

export function AccountSheet({
  open,
  onOpenChange,
  onSaved,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  initial?: Account;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<AccountType>(initial?.type ?? "upi");
  const [opening, setOpening] = useState(initial?.openingBalance.replace(/\.00$/, "") ?? "0");
  const [busy, setBusy] = useState(false);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (v && !initial) {
          setName("");
          setType("upi");
          setOpening("0");
        }
        if (v && initial) {
          setName(initial.name);
          setType(initial.type);
          setOpening(initial.openingBalance.replace(/\.00$/, ""));
        }
      }}
    >
      <SheetContent side="bottom" className="overflow-y-auto pb-8">
        <SheetHeader>
          <SheetTitle>{initial ? "Edit account" : "New account"}</SheetTitle>
        </SheetHeader>
        <form
          className="grid gap-4 px-5 pb-6"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await upsertAccount({
                data: { id: initial?.id, name, type, openingBalance: opening || "0" },
              });
              toast.success("Account saved");
              onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't save");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="a-name">Name</Label>
            <Input id="a-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="HDFC Bank" />
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="a-open">Opening balance</Label>
            <Input id="a-open" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
