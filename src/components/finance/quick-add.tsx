import { createContext, useContext, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TxnForm, type TxnFormDefaults } from "@/components/finance/txn-form";
import { cn } from "@/lib/utils";

const QuickAddCtx = createContext<{
  open: boolean;
  openAdd: (d?: TxnFormDefaults) => void;
  setOpen: (open: boolean) => void;
  defaults?: TxnFormDefaults;
} | null>(null);

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [defaults, setDefaults] = useState<TxnFormDefaults | undefined>();
  return (
    <QuickAddCtx.Provider
      value={{
        open,
        defaults,
        setOpen,
        openAdd: (d) => {
          setDefaults(d);
          setOpen(true);
        },
      }}
    >
      {children}
    </QuickAddCtx.Provider>
  );
}

export function useQuickAdd() {
  const ctx = useContext(QuickAddCtx);
  if (!ctx) throw new Error("useQuickAdd requires QuickAddProvider");
  return ctx;
}

export function QuickAddSheet() {
  const { open, setOpen, defaults } = useQuickAdd();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="bottom" className="overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle>Add transaction</SheetTitle>
        </SheetHeader>
        <div className="px-5 pb-6">
          <TxnForm
            key={`${defaults?.projectId ?? ""}-${defaults?.categoryName ?? ""}-${open}`}
            defaults={defaults}
            onSaved={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function QuickAddFab({ className }: { className?: string }) {
  const { openAdd } = useQuickAdd();
  return (
    <button
      type="button"
      onClick={() => openAdd()}
      aria-label="Add transaction"
      className={cn(
        "fixed z-30 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[var(--elev-shadow)] transition-transform active:scale-95",
        "right-5 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:right-8 md:bottom-8",
        className,
      )}
    >
      <Plus className="size-6" />
    </button>
  );
}
