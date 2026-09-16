import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, FileSpreadsheet, LogOut, Settings, Sparkles, UserRound, Wallet } from "lucide-react";
import { useAppData } from "@/components/data-provider";
import { InstallAppCard } from "@/components/install-app";
import { exportData } from "@/lib/server/io";
import { signOut } from "@/lib/auth/client";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/more")({ component: MorePage });

function MorePage() {
  const user = useCurrentUser();
  const { data } = useAppData();
  const gate = typeof window !== "undefined" && hasGateSessionMarker();

  async function downloadCsv() {
    try {
      const file = await exportData({ data: { format: "csv" } });
      const blob = new Blob([file.content], { type: file.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't export");
    }
  }

  const items = [
    { to: "/assistant", label: "Ask the ledger", icon: Sparkles },
    { to: "/accounts", label: "Accounts", icon: Wallet },
    { to: "/budgets", label: "Budgets", icon: Wallet },
    { to: "/settings", label: "Settings", icon: Settings },
  ] as const;

  return (
    <div className="space-y-6 pt-4">
      <header className="flex items-center gap-3">
        <div className="grid size-12 place-items-center rounded-full bg-secondary">
          <UserRound className="size-5" />
        </div>
        <div>
          <p className="font-medium">{data?.profile.fullName || user?.displayName || "You"}</p>
          <p className="text-sm text-muted-foreground">{user?.primaryEmail}</p>
        </div>
      </header>

      <InstallAppCard />

      <ul className="overflow-hidden rounded-xl bg-card shadow-[var(--elev-shadow)]">
        {items.map((item) => (
          <li key={item.to} className="border-b border-border last:border-0">
            <Link to={item.to} className="flex h-14 items-center justify-between px-4 text-sm">
              <span className="inline-flex items-center gap-3">
                <item.icon className="size-4 text-muted-foreground" />
                {item.label}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
        <li className="border-b border-border">
          <button type="button" onClick={() => void downloadCsv()} className="flex h-14 w-full items-center justify-between px-4 text-sm">
            <span className="inline-flex items-center gap-3">
              <FileSpreadsheet className="size-4 text-muted-foreground" />
              Export CSV
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        </li>
        {!gate && (
          <li>
            <button
              type="button"
              onClick={() => void signOut("/login")}
              className="flex h-14 w-full items-center gap-3 px-4 text-sm"
            >
              <LogOut className="size-4 text-muted-foreground" />
              Sign out
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
