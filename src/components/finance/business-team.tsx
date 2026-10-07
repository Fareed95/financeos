import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  changeBusinessRole,
  getBusinessTeam,
  inviteBusinessMember,
  removeBusinessMember,
  revokeBusinessInvite,
} from "@/lib/server/biz-team";
import { assignOwnershipIntent } from "@/lib/ownership-decision";

const ROLES = ["admin", "accountant", "member", "viewer"] as const;

export function BusinessTeam({
  projectId,
  name,
  onAssignOwnership,
}: {
  projectId: string;
  name: string;
  onAssignOwnership?: (draft: { holder: string; linkUserId: string }) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["biz-team", projectId], queryFn: () => getBusinessTeam({ data: { projectId } }) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("accountant");
  const [days, setDays] = useState(7);
  const [link, setLink] = useState("");
  const [filter, setFilter] = useState<"all" | "members" | "pending">("all");
  async function reload() {
    await qc.invalidateQueries({ queryKey: ["biz-team", projectId] });
  }
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading team…</p>;
  if (!q.data) return <p className="text-sm text-expense">Couldn't load the team.</p>;
  const data = q.data;
  const pending = data.invites.filter((invite) => invite.state === "open" || invite.state === "expired");
  const showMembers = filter !== "pending";
  const showInvites = filter !== "members";
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">Business</p>
        <h2 className="font-display text-[1.65rem] leading-tight">Team</h2>
        <p className="mt-1 text-sm text-muted-foreground">People who can access {name}.</p>
      </div>
      <p className="text-sm text-muted-foreground">{data.members.length} member{data.members.length === 1 ? "" : "s"} · {pending.filter((invite) => invite.state === "open").length} pending invite{pending.filter((invite) => invite.state === "open").length === 1 ? "" : "s"}</p>
      <p className="text-sm text-muted-foreground">Access is not company ownership.</p>
      {data.reminder && <p className="text-sm text-muted-foreground">{data.reminder}</p>}
      <div className="grid grid-cols-3 gap-2">
        {(["all", "members", "pending"] as const).map((item) => (
          <button key={item} type="button" className={`h-11 rounded-md text-sm capitalize ${filter === item ? "bg-foreground text-background" : "bg-card"}`} onClick={() => setFilter(item)}>{item}</button>
        ))}
      </div>
      {data.canManage && (
        <form
          className="grid gap-3 rounded-xl bg-card p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const saved = await inviteBusinessMember({ data: { projectId, role, email, days } });
              const url = `${window.location.origin}${saved?.path ?? ""}`;
              setLink(url);
              await navigator.clipboard.writeText(url).catch(() => undefined);
              toast.success("Invite link ready. Email is not sent automatically.");
              setEmail("");
              await reload();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't invite");
            }
          }}
        >
          <p className="text-sm font-medium">Invite to {name}</p>
          <Input type="email" value={email} placeholder="Email" onChange={(event) => setEmail(event.target.value)} />
          <select className="h-11 rounded-md bg-secondary px-3" value={role} onChange={(event) => setRole(event.target.value as (typeof ROLES)[number])} aria-label="Role">
            {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <p className="text-sm text-muted-foreground">{data.roleCopy[role]} Access is not company ownership.</p>
          <select className="h-11 rounded-md bg-secondary px-3" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={1}>24 hours</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
          </select>
          <Button type="submit" className="h-11">Create invite</Button>
          {link && <p className="break-all text-xs text-muted-foreground">{link}</p>}
        </form>
      )}
      {showMembers && data.members.length === 1 && (
        <div className="rounded-xl bg-card p-4">
          <p className="font-medium">It's just you for now</p>
          <p className="mt-1 text-sm text-muted-foreground">Invite your accountant, co-founder, or team.</p>
        </div>
      )}
      {showMembers && data.members.map((member) => (
        <article key={member.id} className="border-b border-border/60 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{member.name}{member.you ? " · You" : ""}</p>
            {data.canViewEquity ? (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Access role</p>
                  <p className="text-sm capitalize">{member.role}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ownership</p>
                  <p className="text-sm">{member.ownershipLabel}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs capitalize text-muted-foreground">{member.role} · Active</p>
            )}
          </div>
          {data.canDecide && member.role !== "owner" && member.ownershipKind !== "percent" && onAssignOwnership && (
            <Button
              type="button"
              variant="ghost"
              className="mt-2 h-11 px-0"
              onClick={() => {
                const intent = assignOwnershipIntent(member);
                onAssignOwnership({ holder: intent.holder, linkUserId: intent.linkUserId });
              }}
            >
              Assign ownership
            </Button>
          )}
          {data.canManage && member.role !== "owner" && (
            <div className="mt-3 flex gap-2">
              <select
                className="h-11 flex-1 rounded-md bg-secondary px-3"
                value={member.role}
                onChange={async (event) => {
                  await changeBusinessRole({ data: { projectId, memberId: member.id, role: event.target.value } });
                  await reload();
                }}
              >
                {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <Button type="button" variant="ghost" className="h-11 text-expense" onClick={async () => {
                await removeBusinessMember({ data: { projectId, memberId: member.id } });
                toast.success("Access removed. Their past records stay.");
                await reload();
              }}>Remove</Button>
            </div>
          )}
        </article>
      ))}
      {showInvites && pending.map((invite) => (
        <article key={invite.id} className="rounded-xl bg-card p-4">
          <p className="font-medium">{invite.email || "Link invite"}</p>
          <p className="text-xs capitalize text-muted-foreground">{invite.role} · {invite.state}</p>
          {data.canManage && invite.state === "open" && (
            <Button type="button" variant="ghost" className="mt-2 h-11 text-expense" onClick={async () => {
              await revokeBusinessInvite({ data: { projectId, inviteId: invite.id } });
              await reload();
            }}>Revoke</Button>
          )}
        </article>
      ))}
      {showInvites && pending.length === 0 && <p className="text-sm text-muted-foreground">No pending invites.</p>}
    </div>
  );
}
