import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { archiveAccount, deleteAccountRecord, getAccountDetail } from "@/lib/server/accounts";
import { useAppData } from "@/components/data-provider";
import { TxnRow } from "@/components/finance/txn-row";
import { TxnEditSheet } from "@/components/finance/txn-edit-sheet";
import { Button } from "@/components/ui/button";
import { AccountSheet } from "@/routes/_app/accounts/index";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS } from "@/lib/constants";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import type { Transaction } from "@/lib/types";

export const Route = createFileRoute("/_app/accounts/$id")({ component: AccountDetail });

function AccountDetail() {
  const { id } = Route.useParams();
  const { currency, refresh } = useAppData();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const [txn, setTxn] = useState<Transaction | null>(null);
  const q = useQuery({
    queryKey: ["account", id],
    queryFn: () => getAccountDetail({ data: { id } }),
  });

  if (q.isPending) return <p className="pt-8 text-sm text-muted-foreground">Loading account…</p>;
  if (q.error || !q.data) return <p className="pt-8 text-sm text-expense">Couldn't load this account.</p>;

  const { account, income, expense, recent } = q.data;

  return (
    <div className="space-y-6 pt-4">
      <div>
        <Link to="/accounts" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Accounts
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl tracking-tight">{account.name}</h1>
            <p className="text-sm text-muted-foreground">
              {ACCOUNT_TYPE_LABELS[account.type]}
              {!account.isActive ? " · Archived" : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
            Edit
          </Button>
        </div>
      </div>

      <p className="font-display text-5xl tracking-tight tabular">{formatMoney(account.currentBalance, currency)}</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Income</p>
          <p className="mt-1 font-display text-xl tabular text-income">{formatMoney(income, currency)}</p>
        </div>
        <div className="rounded-xl bg-card p-3 shadow-[var(--elev-shadow)]">
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Expenses</p>
          <p className="mt-1 font-display text-xl tabular text-expense">{formatMoney(expense, currency)}</p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Recent</h2>
        <div className="rounded-xl bg-card px-3 py-1 shadow-[var(--elev-shadow)]">
          {recent.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">No movements yet.</p>
          ) : (
            recent.map((t) => (
              <TxnRow key={t.id} txn={t} currency={currency} onClick={() => setTxn(t)} />
            ))
          )}
        </div>
      </section>

      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            await archiveAccount({ data: { id: account.id, isActive: !account.isActive } });
            await q.refetch();
            await refresh();
            toast.success(account.isActive ? "Archived" : "Restored");
          }}
        >
          {account.isActive ? "Archive account" : "Restore account"}
        </Button>
        <Button variant="ghost" className="text-expense" onClick={() => setRemove(true)}>
          Delete account
        </Button>
      </div>

      <TxnEditSheet txn={txn} onClose={() => setTxn(null)} />

      <AccountSheet
        open={edit}
        onOpenChange={setEdit}
        initial={account}
        onSaved={async () => {
          setEdit(false);
          await q.refetch();
          await refresh();
        }}
      />

      <AlertDialog open={remove} onOpenChange={setRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {account.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Accounts with transactions can't be deleted — archive them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await deleteAccountRecord({ data: { id: account.id } });
                  await refresh();
                  toast.success("Deleted");
                  void navigate({ to: "/accounts" });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Couldn't delete");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
