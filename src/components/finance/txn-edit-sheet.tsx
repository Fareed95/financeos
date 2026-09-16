import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TxnForm } from "@/components/finance/txn-form";
import { deleteTransaction } from "@/lib/server/transactions";
import { useAppData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import type { Transaction } from "@/lib/types";

export function TxnEditSheet({
  txn,
  onClose,
}: {
  txn: Transaction | null;
  onClose: () => void;
}) {
  const { refresh } = useAppData();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!txn) return;
    setBusy(true);
    try {
      await deleteTransaction({ data: { id: txn.id } });
      toast.success("Transaction deleted");
      setConfirm(false);
      onClose();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet
        open={Boolean(txn)}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent side="bottom" className="overflow-y-auto pb-8">
          <SheetHeader>
            <SheetTitle>Edit transaction</SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-6">
            {txn && (
              <>
                <TxnForm initial={txn} onSaved={onClose} onCancel={onClose} />
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-2 h-11 w-full text-expense"
                  onClick={() => setConfirm(true)}
                >
                  Delete transaction
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes off the ledger, balances, and any project it was on. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
