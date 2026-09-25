import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAppData } from "@/components/data-provider";
import { BudgetBar } from "@/components/finance/budget-bar";
import { EmptyState } from "@/components/finance/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { upsertProject } from "@/lib/server/projects";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS } from "@/lib/constants";
import { percentUsed } from "@/lib/money";
import type { ProjectStatus, ProjectType } from "@/lib/types";
import { FolderKanban } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/projects/")({ component: ProjectsPage });

function ProjectsPage() {
  const { data, currency, refresh } = useAppData();
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const projects = data.projects;

  return (
    <div className="space-y-5 pt-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Trips, weddings, work — tracked beside your books.</p>
        </div>
        <Button onClick={() => setOpen(true)}>New</Button>
      </header>

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          body="Create your first project — a trip is a good start."
          action="Create your first project"
          onAction={() => setOpen(true)}
        />
      ) : (
        <div className="grid gap-2">
          {projects.map((p) => (
            <Link
              key={p.id}
              to="/projects/$id"
              params={{ id: p.id }}
              className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)] transition-colors hover:bg-secondary"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {PROJECT_TYPE_LABELS[p.projectType]} · {PROJECT_STATUS_LABELS[p.status]}
                </p>
              </div>
              <BudgetBar
                className="mt-3"
                spent={p.collaboration === "collaborative" ? p.viewerSpend : p.totalCost}
                amount={p.budget}
                percent={percentUsed(p.collaboration === "collaborative" ? p.viewerSpend : p.totalCost, p.budget)}
                currency={currency}
              />
            </Link>
          ))}
        </div>
      )}

      <ProjectSheet
        open={open}
        onOpenChange={setOpen}
        onSaved={async () => {
          setOpen(false);
          await refresh();
        }}
      />
    </div>
  );
}

export function ProjectSheet({
  open,
  onOpenChange,
  onSaved,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  initial?: {
    id: string;
    name: string;
    description: string | null;
    projectType: ProjectType;
    startDate: string | null;
    endDate: string | null;
    budget: string;
    status: ProjectStatus;
  };
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [projectType, setProjectType] = useState<ProjectType>(initial?.projectType ?? "trip");
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? "active");
  const [budget, setBudget] = useState(initial?.budget.replace(/\.00$/, "") ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (v && !initial) {
          setName("");
          setDescription("");
          setProjectType("trip");
          setStatus("active");
          setBudget("");
          setStartDate("");
          setEndDate("");
        }
      }}
    >
      <SheetContent side="bottom" className="overflow-y-auto pb-8">
        <SheetHeader>
          <SheetTitle>{initial ? "Edit project" : "New project"}</SheetTitle>
        </SheetHeader>
        <form
          className="grid gap-4 px-5 pb-6"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await upsertProject({
                data: {
                  id: initial?.id,
                  name,
                  description: description || null,
                  projectType,
                  status,
                  budget: budget || "0",
                  startDate: startDate || null,
                  endDate: endDate || null,
                },
              });
              toast.success(initial ? "Project updated" : "Project created");
              onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't save");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Bangalore Trip" />
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={projectType} onValueChange={(v) => setProjectType(v as ProjectType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROJECT_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-budget">Budget</Label>
            <Input id="p-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-start">Start</Label>
              <Input id="p-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-end">End</Label>
              <Input id="p-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROJECT_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-desc">Description</Label>
            <Textarea id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save project"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
