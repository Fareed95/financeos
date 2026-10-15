import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAppData } from "@/components/data-provider";
import { formatMoney } from "@/lib/money";
import { listBusinessPortfolio } from "@/lib/server/family";

export const Route = createFileRoute("/_app/business")({ component: BusinessHome });

function BusinessHome() {
  const { currency } = useAppData();
  const q = useQuery({ queryKey: ["business-portfolio"], queryFn: () => listBusinessPortfolio() });
  return (
    <div className="space-y-5 pt-4">
      <header>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Business</p>
        <h1 className="font-display text-3xl tracking-tight">Your businesses</h1>
      </header>
      {q.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {(q.data ?? []).map((business) => (
        <Link key={business.id} to="/projects/$id" params={{ id: business.id }} className="flex items-center justify-between rounded-xl bg-card p-4">
          <div>
            <p className="font-medium">{business.name}</p>
            <p className="text-sm capitalize text-muted-foreground">{business.role}</p>
          </div>
          <div className="text-right">
            <p className="tabular text-sm">{formatMoney(business.cash, currency)}</p>
            <p className="text-xs text-muted-foreground">Cash</p>
          </div>
        </Link>
      ))}
      {!q.isPending && (q.data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">No business yet. Create one from Projects and choose Business.</p>
      )}
      <Link to="/projects" className="inline-flex h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        + New business
      </Link>
    </div>
  );
}
