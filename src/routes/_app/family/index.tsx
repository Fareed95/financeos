import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppData } from "@/components/data-provider";
import { FamilyWorkspace } from "@/components/finance/family-workspace";
import { IncomingFamilyInvites } from "@/components/finance/incoming-invites";
import { createFamily, listFamilies } from "@/lib/server/family";

export const Route = createFileRoute("/_app/family/")({
  validateSearch: (search: Record<string, unknown>) => ({
    list: search.list === "1" ? ("1" as const) : undefined,
    entry: typeof search.entry === "string" ? search.entry : undefined,
  }),
  component: FamilyHome,
});

function FamilyHome() {
  const { currency } = useAppData();
  const { list, entry } = Route.useSearch();
  const q = useQuery({ queryKey: ["families"], queryFn: () => listFamilies() });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  if (q.isPending) return <p className="pt-6 text-sm text-muted-foreground">Loading family…</p>;
  const families = q.data ?? [];
  if (families.length === 1 && list !== "1") {
    return (
      <div className="space-y-4">
        <IncomingFamilyInvites />
        <FamilyWorkspace familyId={families[0].id} currency={currency} entryId={entry} />
      </div>
    );
  }
  return (
    <div className="space-y-5 pt-4">
      <header>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Family</p>
        <h1 className="font-display text-3xl tracking-tight">{families.length ? "Your families" : "Family"}</h1>
        {!families.length && <p className="mt-2 text-sm text-muted-foreground">Manage money together with your household.</p>}
      </header>
      <IncomingFamilyInvites />
      {families.map((family) => (
        <Link key={family.id} to="/family/$familyId" params={{ familyId: family.id }} className="block rounded-xl bg-card p-4">
          <p className="font-medium">{family.name}</p>
          <p className="text-sm text-muted-foreground">{family.members} {family.members === 1 ? "person" : "people"} · {family.role}</p>
        </Link>
      ))}
      <form className="grid gap-2" onSubmit={async (event) => {
        event.preventDefault();
        try {
          const created = await createFamily({ data: { name } });
          await qc.invalidateQueries({ queryKey: ["families"] });
          if (created?.id) void navigate({ to: "/family/$familyId", params: { familyId: created.id } });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't create");
        }
      }}>
        <Input placeholder="Another family name" value={name} onChange={(event) => setName(event.target.value)} aria-label="Family name" />
        <Button type="submit" className="h-11">{families.length ? "Create another family" : "Create family"}</Button>
      </form>
    </div>
  );
}