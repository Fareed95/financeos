import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { getTransaction, searchLedger } from "@/lib/server/transactions";
import { TxnEditSheet } from "@/components/finance/txn-edit-sheet";
import { formatMoney } from "@/lib/money";
import { formatShortDate } from "@/lib/utils";
import { useAppData } from "@/components/data-provider";
import type { Transaction } from "@/lib/types";

export function AppSearch() {
  const { currency } = useAppData();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [edit, setEdit] = useState<Transaction | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: ["ledger-search", debounced],
    queryFn: () => searchLedger({ data: { query: debounced } }),
    enabled: open && debounced.length >= 2,
  });

  const personal = results.data?.personal ?? [];
  const family = results.data?.family ?? [];

  return (
    <>
      <button type="button" aria-label="Search" className="grid size-11 place-items-center rounded-full text-muted-foreground" onClick={() => setOpen(true)}>
        <Search className="size-5" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Search</SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 px-5 pb-8">
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Hall, SBI, coffee…"
              aria-label="Search the ledger"
            />
            {debounced.length >= 2 && personal.length === 0 && family.length === 0 && !results.isPending && (
              <p className="text-sm text-muted-foreground">Nothing matches.</p>
            )}
            {personal.length > 0 && (
              <section className="space-y-1">
                <p className="text-xs text-muted-foreground">Personal</p>
                {personal.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 py-2 text-left"
                    onClick={() => {
                      void getTransaction({ data: { id: row.id } }).then((result) => {
                        setOpen(false);
                        setEdit(result.transaction);
                      });
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{row.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{formatShortDate(row.date.slice(0, 10))}{row.account ? ` · ${row.account}` : ""}</span>
                    </span>
                    <span className="tabular shrink-0 text-sm">{formatMoney(row.amount, currency)}</span>
                  </button>
                ))}
              </section>
            )}
            {family.length > 0 && (
              <section className="space-y-1">
                <p className="text-xs text-muted-foreground">Family</p>
                {family.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 py-2 text-left"
                    onClick={() => {
                      setOpen(false);
                      void navigate({ to: "/family", search: { list: undefined, entry: row.id } });
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{row.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{row.familyName} · {formatShortDate(row.date.slice(0, 10))}{row.account ? ` · ${row.account}` : ""}</span>
                    </span>
                    <span className="tabular shrink-0 text-sm">{formatMoney(row.amount, currency)}</span>
                  </button>
                ))}
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <TxnEditSheet txn={edit} onClose={() => setEdit(null)} />
    </>
  );
}
