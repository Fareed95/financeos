import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  changeBusinessKind,
  changeBusinessRole,
  getBusinessTeam,
  inviteBusinessMember,
  removeBusinessMember,
  revokeBusinessInvite,
} from "@/lib/server/biz-team";
import { formatOwnershipPercent } from "@/lib/ownership-decision";
import { parsePercentBps, planPercentGrant } from "@/lib/cap-table";
import { giveBusinessPercent } from "@/lib/server/business";
import { todayISO } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

const ROLES = ["member", "admin", "accountant", "viewer"] as const;
const ROLE_LABEL: Record<string, string> = {
  owner: "Runs this",
  admin: "Can manage",
  member: "Can add records",
  accountant: "Can see the books",
  viewer: "Can only look",
};
const KINDS = [
  { id: "cofounder", label: "Co-founder" },
  { id: "team", label: "Team member" },
  { id: "investor", label: "Investor" },
] as const;

function kindLabel(kind: string) {
  return KINDS.find((item) => item.id === kind)?.label ?? "Team member";
}

function PercentGrant({
  projectId,
  holder,
  userId,
  founderName,
  holders,
  onSaved,
}: {
  projectId: string;
  holder: string;
  userId: string;
  founderName: string;
  holders: { name: string; shares: string }[];
  onSaved: () => Promise<void>;
}) {
  const [percent, setPercent] = useState("");
  const current = holders.map((row) => ({ name: row.name, shares: BigInt(row.shares) }));
  let preview = "";
  let error = "";
  if (percent.trim()) {
    try {
      const plan = planPercentGrant({
        holders: current,
        holder,
        targetBps: parsePercentBps(percent),
        founderName,
      });
      preview = plan.after.map((row) => `${row.name} ${formatOwnershipPercent(row.bps)}`).join(" · ");
    } catch (err) {
      error = err instanceof Error ? err.message : "Enter a percent like 33";
    }
  }
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          if (!preview) throw new Error(error || "Enter a percent");
          await giveBusinessPercent({
            data: { projectId, holder, percent, date: todayISO(), linkUserId: userId },
          });
          setPercent("");
          toast.success(preview);
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't save that percent");
        }
      }}
    >
      <Input
        inputMode="decimal"
        placeholder="His percent, like 33"
        aria-label={`Percent for ${holder}`}
        value={percent}
        onChange={(event) => setPercent(event.target.value)}
      />
      {preview && <p className="text-sm text-muted-foreground">After this: {preview}</p>}
      {error && <p className="text-sm text-expense">{error}</p>}
      <Button type="submit" className="h-11" disabled={!preview}>Save percent</Button>
    </form>
  );
}

export function BusinessTeam({
  projectId,
  name,
  onAssignOwnership,
  also = [],
}: {
  projectId: string;
  name: string;
  onAssignOwnership?: (draft: { holder: string; linkUserId: string }) => void;
  also?: { name: string; note: string }[];
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["biz-team", projectId], queryFn: () => getBusinessTeam({ data: { projectId } }) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("member");
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("team");
  const [days, setDays] = useState(7);
  const [link, setLink] = useState("");
  const [filter, setFilter] = useState<"all" | "members" | "pending">("all");
  async function reload() {
    await qc.invalidateQueries({ queryKey: ["biz-team", projectId] });
  }
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading team…</p>;
  if (!q.data) return <p className="text-sm text-expense">Couldn't load the team.</p>;
  const data = q.data;
  const known = new Set(data.members.map((member) => member.name.trim().toLowerCase()));
  const extra = also.filter((person) => person.name.trim() && !known.has(person.name.trim().toLowerCase()));
  const count = data.members.length + extra.length;
  const pending = data.invites.filter((invite) => invite.state === "open" || invite.state === "expired");
  const showMembers = filter !== "pending";
  const showInvites = filter !== "members";
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">Business</p>
        <h2 className="font-display text-[1.65rem] leading-tight">Team</h2>
        <p className="mt-1 text-sm text-muted-foreground">Who can open {name}. A percent of the company is separate.</p>
      </div>
      <p className="text-sm text-muted-foreground">{count} member{count === 1 ? "" : "s"} · {pending.filter((invite) => invite.state === "open").length} pending invite{pending.filter((invite) => invite.state === "open").length === 1 ? "" : "s"}</p>
      <p className="text-sm text-muted-foreground">Inviting someone does not give them a percent.</p>
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
              const saved = await inviteBusinessMember({ data: { projectId, role, email, days, kind } });
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
          <p className="text-sm text-muted-foreground">Who they are</p>
          <select className="h-11 rounded-md bg-secondary px-3 text-base" value={kind} onChange={(event) => setKind(event.target.value as (typeof KINDS)[number]["id"])} aria-label="Who they are">
            {KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <p className="text-sm text-muted-foreground">What they can do</p>
          <select className="h-11 rounded-md bg-secondary px-3 text-base" value={role} onChange={(event) => setRole(event.target.value as (typeof ROLES)[number])} aria-label="What they can do">
            {ROLES.map((item) => <option key={item} value={item}>{ROLE_LABEL[item]}</option>)}
          </select>
          <p className="text-sm text-muted-foreground">{kindLabel(kind)}. {data.roleCopy[role]} No percent is given.</p>
          <select className="h-11 rounded-md bg-secondary px-3" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={1}>24 hours</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
          </select>
          <Button type="submit" className="h-11">Create invite</Button>
          {link && <p className="break-all text-xs text-muted-foreground">{link}</p>}
        </form>
      )}
      {data.canViewEquity && (data.holders ?? []).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Who owns the company</p>
          {(data.holders ?? []).map((holder) => (
            <p key={holder.name} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm">{holder.name}</span>
              <span className="font-display text-2xl tabular">{holder.percent}</span>
            </p>
          ))}
        </div>
      )}
      {showMembers && count === 1 && data.members.every((member) => (member.paid ?? []).length === 0) && extra.length === 0 && (
        <div className="rounded-xl bg-card p-4">
          <p className="font-medium">It's just you for now</p>
          <p className="mt-1 text-sm text-muted-foreground">Invite your accountant, co-founder, or team.</p>
        </div>
      )}
      {showMembers && data.members.map((member) => (
        <article key={member.id} className="border-b border-border/60 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{member.name}{member.you ? " · You" : ""}</p>
            {(member.paid ?? []).length > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                Joined. Paid {(member.paid ?? []).map((item) => `${item.memo} ${formatMoney(item.amount)}`).join(", ")} from personal money.
              </p>
            )}
            {data.canViewEquity ? (
              <p className="mt-1 text-sm">
                <span className="text-muted-foreground">{kindLabel(member.kind)} · {ROLE_LABEL[member.role] ?? member.role} · </span>
                <span className="font-medium">{member.ownershipLabel}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{kindLabel(member.kind)} · {ROLE_LABEL[member.role] ?? member.role}</p>
            )}
          </div>
          {data.canDecide && member.role !== "owner" && member.ownershipKind !== "percent" && onAssignOwnership && (
            <PercentGrant
              projectId={projectId}
              holder={member.name}
              userId={member.userId}
              founderName={data.members.find((person) => person.role === "owner")?.name || "Owner"}
              holders={data.holders ?? []}
              onSaved={reload}
            />
          )}
          {data.role === "owner" && member.role !== "owner" && (
            <select
              className="mt-3 h-11 w-full rounded-md bg-secondary px-3 text-base"
              aria-label={`Who ${member.name} is`}
              value={member.kind}
              onChange={async (event) => {
                await changeBusinessKind({ data: { projectId, memberId: member.id, kind: event.target.value } });
                await reload();
              }}
            >
              {KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          )}
          {data.canManage && member.role !== "owner" && (
            <div className="mt-3 flex gap-2">
              <select
                className="h-11 flex-1 rounded-md bg-secondary px-3 text-base"
                aria-label={`What ${member.name} can do`}
                value={member.role}
                onChange={async (event) => {
                  await changeBusinessRole({ data: { projectId, memberId: member.id, role: event.target.value } });
                  await reload();
                }}
              >
                {ROLES.map((item) => <option key={item} value={item}>{ROLE_LABEL[item]}</option>)}
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
      {showMembers && extra.map((person) => (
        <article key={person.name} className="border-b border-border/60 py-3">
          <p className="truncate font-medium">{person.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {person.note ? `Joined. Paid ${person.note} from personal money.` : "Joined this project."} · Team member · No share
          </p>
        </article>
      ))}
      {showInvites && pending.map((invite) => (
        <article key={invite.id} className="rounded-xl bg-card p-4">
          <p className="font-medium">{invite.email || "Link invite"}</p>
          <p className="text-xs capitalize text-muted-foreground">{kindLabel(invite.kind)} · {invite.role} · {invite.state}</p>
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
