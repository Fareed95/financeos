import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const ITEMS = [
  { id: "personal", label: "Personal", to: "/" },
  { id: "family", label: "Family", to: "/family" },
  { id: "business", label: "Business", to: "/business" },
] as const;

export function contextFromPath(pathname: string) {
  if (pathname === "/family" || pathname.startsWith("/family/")) return "family" as const;
  if (pathname === "/business" || pathname.startsWith("/business/")) return "business" as const;
  return "personal" as const;
}

export function ContextSwitch() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = contextFromPath(pathname);
  return (
    <div role="tablist" aria-label="Money" className="grid grid-cols-3 rounded-full bg-secondary p-1">
      {ITEMS.map((item) => {
        const active = item.id === current;
        return (
          <Link
            key={item.id}
            to={item.to}
            role="tab"
            aria-selected={active}
            className={cn(
              "flex h-10 items-center justify-center rounded-full text-sm font-medium",
              active ? "bg-background text-foreground shadow-[var(--elev-shadow)]" : "text-muted-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
