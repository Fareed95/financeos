import { CategoryIcon } from "@/components/finance/icons";
import { formatMoney } from "@/lib/money";
import { formatShortDate } from "@/lib/utils";
import type { Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TxnRow({
  txn,
  currency,
  onClick,
}: {
  txn: Transaction;
  currency: string;
  onClick?: () => void;
}) {
  const signed =
    txn.type === "income" || txn.type === "refund"
      ? txn.amount
      : txn.type === "transfer"
        ? txn.amount
        : `-${txn.amount}`;
  const color =
    txn.type === "income" || txn.type === "refund"
      ? "text-income"
      : txn.type === "expense"
        ? "text-expense"
        : "text-foreground";
  const prefix = txn.type === "income" || txn.type === "refund" ? "+" : txn.type === "expense" ? "−" : "";
  const title =
    txn.description ||
    (txn.type === "transfer"
      ? `${txn.accountName} → ${txn.counterpartyAccountName}`
      : txn.categoryName || txn.type);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition-colors hover:bg-secondary"
    >
      <div className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
        <CategoryIcon name={txn.categoryIcon} className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {formatShortDate(txn.transactionDate)}
          {txn.accountName ? ` · ${txn.accountName}` : ""}
          {txn.projectName ? ` · ${txn.projectName}` : ""}
          {txn.visibility && txn.visibility !== "personal" ? ` · ${txn.visibility}` : ""}
          {txn.visibility && txn.visibility !== "personal" && txn.paidByName ? ` · ${txn.paidByName} paid` : ""}
        </p>
      </div>
      <p className={cn("tabular shrink-0 text-sm font-medium", color)}>
        {prefix}
        {formatMoney(txn.type === "transfer" ? signed : txn.amount, currency, { sign: "never" })}
      </p>
    </button>
  );
}
