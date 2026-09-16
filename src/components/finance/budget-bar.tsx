import { Progress } from "@/components/ui/progress";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export function BudgetBar({
  spent,
  amount,
  percent,
  currency,
  className,
}: {
  spent: string;
  amount: string;
  percent: number;
  currency: string;
  className?: string;
}) {
  const tone = percent >= 100 ? "bg-expense" : percent >= 90 ? "bg-warn" : percent >= 70 ? "bg-warn" : "bg-primary";
  const label = percent >= 100 ? "Exceeded" : percent >= 90 ? "Near limit" : percent >= 70 ? "Approaching" : null;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="tabular text-foreground">
          {formatMoney(spent, currency)}
          <span className="text-muted-foreground"> / {formatMoney(amount, currency)}</span>
        </span>
        {label && (
          <span className={cn("text-xs", percent >= 100 ? "text-expense" : "text-warn")}>{label}</span>
        )}
      </div>
      <Progress value={percent} indicatorClassName={tone} />
    </div>
  );
}
