import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { listTransactions } from "@/lib/server/transactions";
import { useAppData } from "@/components/data-provider";
import { TxnRow } from "@/components/finance/txn-row";
import { TxnEditSheet } from "@/components/finance/txn-edit-sheet";
import { EmptyState } from "@/components/finance/empty-state";
import { useQuickAdd } from "@/components/finance/quick-add";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowLeftRight, SlidersHorizontal } from "lucide-react";
import type { Transaction, TxnFilters, TxnType } from "@/lib/types";

export const Route = createFileRoute("/_app/transactions")({ component: TransactionsPage });

function TransactionsPage() {
  const { data, currency, from, to } = useAppData();
  const { openAdd } = useQuickAdd();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<TxnFilters>({ from, to, sort: "newest" });
  const [filterOpen, setFilterOpen] = useState(false);
  const [edit, setEdit] = useState<Transaction | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const queryFilters = useMemo(
    () => ({ ...filters, search: debounced || undefined, limit: 30 }),
    [filters, debounced],
  );

  const list = useInfiniteQuery({
    queryKey: ["transactions", queryFilters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listTransactions({ data: { ...queryFilters, offset: pageParam as number } }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <div className="space-y-5 pt-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">{total} in this view</p>
        </div>
        <Button variant="outline" size="icon" aria-label="Filters" onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal className="size-4" />
        </Button>
      </header>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search descriptions"
        aria-label="Search transactions"
      />

      {items.length === 0 && !list.isPending ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No transactions yet"
          body="Add your first expense — it takes a few seconds."
          action="Add your first expense"
          onAction={() => openAdd()}
        />
      ) : (
        <div className="rounded-xl bg-card px-3 py-1 shadow-[var(--elev-shadow)]">
          {items.map((t) => (
            <TxnRow
              key={t.id}
              txn={t}
              currency={currency}
              onClick={() => setEdit(t)}
            />
          ))}
        </div>
      )}

      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="bottom" className="overflow-y-auto pb-8">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 px-5 pb-6">
            <Field label="From">
              <Input
                type="date"
                value={filters.from ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={filters.to ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))}
              />
            </Field>
            <Field label="Type">
              <Select
                value={filters.type ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, type: v === "all" ? undefined : (v as TxnType) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="refund">Refund</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Account">
              <Select
                value={filters.accountId ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, accountId: v === "all" ? undefined : v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {(data?.accounts ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Category">
              <Select
                value={filters.categoryId ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, categoryId: v === "all" ? undefined : v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {(data?.categories ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Project">
              <Select
                value={filters.projectId ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, projectId: v === "all" ? undefined : v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {(data?.projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Sort">
              <Select
                value={filters.sort ?? "newest"}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, sort: v as NonNullable<TxnFilters["sort"]> }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                  <SelectItem value="highest">Highest amount</SelectItem>
                  <SelectItem value="lowest">Lowest amount</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button onClick={() => setFilterOpen(false)}>Apply</Button>
          </div>
        </SheetContent>
      </Sheet>

      <TxnEditSheet txn={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
