import { useEffect, useId, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { PAGE_LEARN, conceptById, searchConcepts } from "@/lib/learn";
import { blocksFor, type LearnSnapshot } from "@/lib/learn-explain";

const SEEN = "kharcha-learn-seen";
const TIP = "kharcha-learn-tip";

export function learnTipVisible() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TIP) !== "off";
}

export function dismissLearnTip() {
  window.localStorage.setItem(TIP, "off");
}

function markSeen(ids: string[]) {
  const current = new Set((window.localStorage.getItem(SEEN) || "").split(",").filter(Boolean));
  for (const id of ids) current.add(id);
  window.localStorage.setItem(SEEN, [...current].join(","));
}

export function LearnButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Learn about this page"
      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-card px-3 text-xs text-muted-foreground"
    >
      <span aria-hidden="true">💡</span>
      {compact ? "Learn" : "Learn about this page"}
    </button>
  );
}

export function LearnPanel({
  page,
  snapshot,
  focusConcept,
  onClose,
}: {
  page: string;
  snapshot: LearnSnapshot;
  focusConcept?: string | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const config = PAGE_LEARN[page] ?? PAGE_LEARN.guide!;
  const blocks = page === "guide" ? [] : blocksFor(page, snapshot);
  const concepts = (page === "guide" ? searchConcepts(query) : config.concepts.map((id) => conceptById(id)).filter((item) => item !== null)).filter((concept) =>
    focusConcept ? concept.id === focusConcept || page === "guide" : true,
  );

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    markSeen(config.concepts);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>("button, input, a, summary")].filter((item) => !item.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [config.concepts, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl bg-background p-4 shadow-[var(--elev-shadow)] lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-[420px] lg:rounded-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">💡 Learn</p>
            <h2 id={titleId} className="font-display text-2xl">{config.title}</h2>
          </div>
          <button ref={closeRef} type="button" className="h-11 rounded-md px-3 text-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mt-4 space-y-4 overflow-y-auto pb-8">
          {page === "guide" && (
            <input
              className="h-11 w-full rounded-md bg-card px-3 text-sm"
              placeholder="Search a finance term"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search a finance term"
            />
          )}
          {blocks.map((block) => (
            <section key={block.heading} className="rounded-xl bg-card p-4">
              <h3 className="text-sm font-medium">{block.heading}</h3>
              {block.hypothetical && <p className="mt-1 text-xs tracking-wide text-muted-foreground uppercase">Hypothetical example, not your books</p>}
              <p className="mt-2 text-sm text-muted-foreground">{block.body}</p>
              {block.rows && (
                <dl className="mt-3 space-y-1">
                  {block.rows.map((row) => (
                    <div key={row.label} className="flex justify-between gap-3 text-sm">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="tabular">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}
          <div className="space-y-2">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Key concepts</p>
            {concepts.map((concept) => (
              <details key={concept.id} className="rounded-xl bg-card p-4" open={focusConcept === concept.id}>
                <summary className="cursor-pointer text-sm font-medium">{concept.simpleName}</summary>
                <p className="mt-2 text-sm">{concept.simple}</p>
                <p className="mt-2 text-sm text-muted-foreground">{concept.why}</p>
                <p className="mt-3 text-[11px] tracking-wide text-muted-foreground uppercase">Accounting detail</p>
                <p className="mt-1 text-sm text-muted-foreground">{concept.advanced}</p>
                <p className="mt-2 text-xs text-muted-foreground">{concept.accountingName}</p>
                {concept.caution && <p className="mt-2 text-xs text-muted-foreground">{concept.caution}</p>}
              </details>
            ))}
            {concepts.length === 0 && <p className="text-sm text-muted-foreground">No term matches that. Try “customer owes me” or “company worth”.</p>}
          </div>
          <p className="text-xs text-muted-foreground">
            Figures above are from {snapshot.name}. Cash available is {formatMoney(snapshot.cash, snapshot.currency)}. This is how Kharcha models the books, not tax or investment advice.
          </p>
        </div>
      </div>
    </div>
  );
}
