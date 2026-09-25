import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  FolderKanban,
  LayoutGrid,
  MoreHorizontal,
  PieChart,
  Settings,
  Sparkles,
  Wallet,
} from "lucide-react";
import { OfflineBanner } from "@/components/offline-banner";
import { UserButton } from "@/lib/auth/gates";
import { cn } from "@/lib/utils";
import { QuickAddFab, QuickAddSheet } from "@/components/finance/quick-add";
import { useVisualKeyboard } from "@/hooks/use-visual-keyboard";

const DESKTOP = [
  { to: "/", label: "Home", icon: LayoutGrid },
  { to: "/assistant", label: "Ask", icon: Sparkles },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/budgets", label: "Budgets", icon: Wallet },
  { to: "/reports", label: "Reports", icon: PieChart },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const MOBILE = [
  { to: "/", label: "Home", icon: LayoutGrid },
  { to: "/transactions", label: "Txns", icon: ArrowLeftRight },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/reports", label: "Reports", icon: PieChart },
  { to: "/more", label: "More", icon: MoreHorizontal },
] as const;

function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const kb = useVisualKeyboard();
  const isAssistant = pathname === "/assistant";
  const hideTabbar = kb > 80;

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-border px-3 py-6 md:flex">
        <Link to="/" className="mb-8 px-3 font-display text-2xl tracking-tight">
          Kharcha
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {DESKTOP.map((item) => {
            const active = isActive(pathname, item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                  active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-2 pt-4">
          <UserButton />
        </div>
      </aside>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          isAssistant && "h-dvh min-h-0 overflow-hidden md:h-auto md:min-h-dvh",
        )}
      >
        {!isAssistant && (
          <header className="flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-2 md:hidden">
            <Link to="/" className="font-display text-xl tracking-tight">
              Kharcha
            </Link>
            <Link
              to="/assistant"
              aria-label="Ask the ledger"
              className="grid size-11 place-items-center rounded-full text-muted-foreground"
            >
              <Sparkles className="size-5" />
            </Link>
          </header>
        )}
        <OfflineBanner />
        <main
          className={cn(
            "mx-auto w-full flex-1",
            isAssistant
              ? "flex min-h-0 max-w-3xl flex-col px-0 pb-0"
              : "max-w-5xl px-4 pb-28 md:px-8 md:pb-12",
          )}
        >
          <Outlet />
        </main>
      </div>

      <nav
        className={cn(
          "fos-tabbar fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur md:hidden pb-[env(safe-area-inset-bottom)]",
          hideTabbar && "pointer-events-none translate-y-full",
        )}
      >
        <ul className="grid grid-cols-5">
          {MOBILE.map((item) => {
            const active = isActive(pathname, item.to);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <item.icon className="size-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {pathname !== "/assistant" && <QuickAddFab />}
      <QuickAddSheet />
    </div>
  );
}
