import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAppData } from "@/components/data-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { updateProfile, deleteAccount } from "@/lib/server/bootstrap";
import { upsertCategory, toggleCategory, deleteCategory } from "@/lib/server/categories";
import { exportData, importTransactions, type ImportRow } from "@/lib/server/io";
import { loadDemoData, removeDemoData } from "@/lib/server/demo";
import { CURRENCY_LABELS } from "@/lib/constants";
import { CURRENCIES } from "@/lib/types";
import { authClient, signOut } from "@/lib/auth/client";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { toast } from "sonner";
import { InstallAppCard } from "@/components/install-app";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

function SettingsPage() {
  const { data, refresh } = useAppData();
  const theme = useTheme();
  const [name, setName] = useState(data?.profile.fullName ?? "");
  const [cur, setCur] = useState(data?.profile.currency ?? "INR");
  const [catName, setCatName] = useState("");
  const [busy, setBusy] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const gate = typeof window !== "undefined" && hasGateSessionMarker();

  if (!data) return null;

  async function saveProfile() {
    setBusy(true);
    try {
      await updateProfile({ data: { fullName: name, currency: cur, theme: theme.theme } });
      await refresh();
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  async function download(format: "csv" | "json") {
    try {
      const file = await exportData({ data: { format } });
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

  return (
    <div className="space-y-8 pt-4 pb-8">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Settings</h1>
      </header>

      <InstallAppCard />

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Profile</h2>
        <div className="grid gap-3 rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
          <div className="grid gap-1.5">
            <Label htmlFor="s-name">Name</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Currency</Label>
            <Select value={cur} onValueChange={setCur}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c} — {CURRENCY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Theme</Label>
            <Select
              value={theme.theme}
              onValueChange={(v) => theme.setTheme(v as "light" | "dark" | "system")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void saveProfile()} disabled={busy}>
            Save profile
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Categories</h2>
        <div className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
          <form
            className="mb-3 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await upsertCategory({ data: { name: catName, icon: "circle", type: "expense" } });
                setCatName("");
                await refresh();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't add");
              }
            }}
          >
            <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="New category" />
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
          <ul className="divide-y divide-border">
            {data.categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className={!c.isActive ? "text-muted-foreground line-through" : ""}>
                  {c.name}
                  <span className="ml-2 text-xs text-muted-foreground">{c.type}</span>
                </span>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={c.isActive}
                    onCheckedChange={async (v) => {
                      await toggleCategory({ data: { id: c.id, isActive: v } });
                      await refresh();
                    }}
                    aria-label={`Toggle ${c.name}`}
                  />
                  {!c.isDefault && (
                    <button
                      type="button"
                      className="text-xs text-expense"
                      onClick={async () => {
                        try {
                          await deleteCategory({ data: { id: c.id } });
                          await refresh();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Couldn't delete");
                        }
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Data</h2>
        <div className="grid gap-2">
          <Button variant="outline" onClick={() => void download("csv")}>
            Export transactions CSV
          </Button>
          <Button variant="outline" onClick={() => void download("json")}>
            Download JSON backup
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await loadDemoData();
                await refresh();
                toast.success("Demo data loaded — Bangalore Trip is ready");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't load demo");
              }
            }}
          >
            Load demo data
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await removeDemoData();
              await refresh();
              toast.success("Demo data removed");
            }}
          >
            Remove demo data
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Security</h2>
        <form
          className="grid gap-3 rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const { error } = await authClient.changePassword({
                currentPassword,
                newPassword,
              });
              if (error) toast.error(error.message ?? "Couldn't change password");
              else {
                toast.success("Password updated");
                setCurrentPassword("");
                setNewPassword("");
              }
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't change password");
            }
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="cur-pass">Current password</Label>
            <Input id="cur-pass" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-pass">New password</Label>
            <Input id="new-pass" type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary">
            Change password
          </Button>
        </form>
        {!gate && (
          <Button variant="outline" onClick={() => void signOut("/login")}>
            Sign out
          </Button>
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-expense">Danger zone</h2>
        <Button variant="destructive" onClick={() => setWipe(true)}>
          Delete account
        </Button>
      </section>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={refresh} />

      <AlertDialog open={wipe} onOpenChange={setWipe}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all of your data?</AlertDialogTitle>
            <AlertDialogDescription>
              Transactions, accounts, projects, and budgets will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await deleteAccount();
                  toast.success("Account data deleted");
                  if (!gate) await signOut("/login");
                  else window.location.href = "/";
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Couldn't delete");
                }
              }}
            >
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, string>>({
    date: "",
    amount: "",
    category: "",
    account: "",
    description: "",
    project: "",
  });

  const fields = useMemo(
    () => [
      ["date", "Date"],
      ["amount", "Amount"],
      ["category", "Category"],
      ["account", "Account"],
      ["description", "Description"],
      ["project", "Project"],
    ],
    [],
  );

  function onFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = parseCsv(text);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      const auto: Record<string, string> = { ...map };
      for (const h of parsed.headers) {
        const n = h.toLowerCase();
        if (n.includes("date")) auto.date = h;
        else if (n.includes("amount") || n === "value") auto.amount = h;
        else if (n.includes("category")) auto.category = h;
        else if (n.includes("account")) auto.account = h;
        else if (n.includes("desc") || n.includes("narration") || n.includes("note")) auto.description = h;
        else if (n.includes("project")) auto.project = h;
      }
      setMap(auto);
    };
    reader.readAsText(file);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-overlay md:place-items-center">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-card p-5 md:rounded-xl">
        <h2 className="font-display text-xl tracking-tight">Import CSV</h2>
        <p className="mt-1 text-sm text-muted-foreground">Map columns, then we'll validate before insert.</p>
        <Input className="mt-4" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        {headers.length > 0 && (
          <div className="mt-4 grid gap-3">
            {fields.map(([key, label]) => (
              <div key={key} className="grid gap-1.5">
                <Label>{label}</Label>
                <Select value={map[key] || "none"} onValueChange={(v) => setMap((m) => ({ ...m, [key]: v === "none" ? "" : v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Not mapped" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not mapped</SelectItem>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{rows.length} rows found</p>
            <Button
              onClick={async () => {
                if (!map.date || !map.amount) {
                  toast.error("Date and amount are required");
                  return;
                }
                const idx = (h: string) => headers.indexOf(h);
                const payload: ImportRow[] = rows.map((row) => ({
                  date: normalizeDate(row[idx(map.date)] ?? ""),
                  amount: (row[idx(map.amount)] ?? "").replace(/[^0-9.-]/g, ""),
                  categoryName: map.category ? row[idx(map.category)] : undefined,
                  accountName: map.account ? row[idx(map.account)] : undefined,
                  description: map.description ? row[idx(map.description)] : undefined,
                  projectName: map.project ? row[idx(map.project)] : undefined,
                  type: "expense",
                }));
                try {
                  const result = await importTransactions({ data: { rows: payload } });
                  toast.success(`Imported ${result.inserted}. Skipped ${result.skipped}.`);
                  if (result.errors[0]) toast.message(result.errors[0]);
                  onOpenChange(false);
                  await onDone();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Import failed");
                }
              }}
            >
              Import
            </Button>
          </div>
        )}
        <Button variant="ghost" className="mt-3 w-full" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    </div>
  );
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim());
  if (!lines[0]) return { headers: [], rows: [] };
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return s;
}
