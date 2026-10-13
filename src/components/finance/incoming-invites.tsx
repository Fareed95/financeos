import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acceptInvite, previewInvite } from "@/lib/server/collab";
import { acceptMyFamilyInvite, listMyFamilyInvites } from "@/lib/server/family";

const TOKEN_KEY = "kharcha-invite-token";

export function IncomingFamilyInvites() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState("");
  const emailInvites = useQuery({ queryKey: ["my-family-invites"], queryFn: () => listMyFamilyInvites() });
  const token = typeof window === "undefined" ? "" : sessionStorage.getItem(TOKEN_KEY) || "";
  const linked = useQuery({
    queryKey: ["invite", token],
    enabled: Boolean(token),
    queryFn: () => previewInvite({ data: { token } }),
  });
  const link = linked.data?.kind === "family" && (linked.data.state === "open" || linked.data.state === "member") ? linked.data : null;
  const rows = (emailInvites.data ?? []).filter((row) => row.family_id !== link?.projectId);
  if (!link && rows.length === 0) return null;

  async function joined(familyId: string) {
    sessionStorage.removeItem(TOKEN_KEY);
    await qc.invalidateQueries({ queryKey: ["families"] });
    await qc.invalidateQueries({ queryKey: ["my-family-invites"] });
    toast.success("Joined");
    void navigate({ to: "/family/$familyId", params: { familyId } });
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Family invitations</h2>
      {link && (
        <article className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
          <p className="text-sm text-muted-foreground">{link.invitedBy} invited you</p>
          <p className="font-medium">{link.projectName}</p>
          <Button
            className="mt-3 h-11"
            disabled={busy === "link"}
            onClick={() => {
              setBusy("link");
              void (link.state === "member"
                ? joined(link.projectId)
                : acceptInvite({ data: { token } }).then((res) => joined(res?.projectId ?? link.projectId))
              ).catch((err: unknown) => {
                setBusy("");
                toast.error(err instanceof Error ? err.message : "Couldn't join");
              });
            }}
          >
            {link.state === "member" ? "Open family" : "Join family"}
          </Button>
        </article>
      )}
      {rows.map((row) => (
        <article key={row.id} className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
          <p className="text-sm text-muted-foreground">{row.invited_by || "Someone"} invited you</p>
          <p className="font-medium">{row.name}</p>
          <Button
            className="mt-3 h-11"
            disabled={busy === row.id}
            onClick={() => {
              setBusy(row.id);
              void acceptMyFamilyInvite({ data: { inviteId: row.id } })
                .then((res) => joined(res?.projectId ?? row.family_id))
                .catch((err: unknown) => {
                  setBusy("");
                  toast.error(err instanceof Error ? err.message : "Couldn't join");
                });
            }}
          >
            Join family
          </Button>
        </article>
      ))}
    </section>
  );
}
