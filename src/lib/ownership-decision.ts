import { assertInviteRole, can } from "./biz-access.ts";

/** Access and ownership are different records. Nothing here creates share events. */

export type OwnershipDecision = "none" | "later";

export type OwnershipPerson = {
  id: string;
  userId: string;
  name: string;
  role: string;
  /** Explicit stakeholder link. A matching display name is not a link. */
  linked: boolean;
  shares: bigint;
  bps: bigint;
  decision: OwnershipDecision | null;
};

export type OwnershipKind = "percent" | "none" | "undecided";

const PROMPT_ROLES = new Set(["admin", "member"]);

export function recordedDecision(value: string | null | undefined): OwnershipDecision | null {
  return value === "none" || value === "later" ? value : null;
}

/** Basis points are out of 10,000. 3000 → 30%. A stored percent is never the source. */
export function formatOwnershipPercent(bps: bigint): string {
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const text = frac === 0n ? `${whole}` : `${whole}.${frac.toString().padStart(2, "0")}`;
  return `${negative ? "-" : ""}${text}%`;
}

export function memberOwnership(person: OwnershipPerson): { kind: OwnershipKind; label: string; shares: bigint } {
  const shares = person.linked ? person.shares : 0n;
  const bps = person.linked ? person.bps : 0n;
  if (shares > 0n) return { kind: "percent", label: formatOwnershipPercent(bps), shares };
  if (person.role === "accountant" || person.role === "viewer" || person.role === "owner" || person.decision === "none" || person.linked) {
    return { kind: "none", label: "No shares", shares: 0n };
  }
  if (person.role === "admin" || person.role === "member") return { kind: "undecided", label: "Undecided", shares: 0n };
  return { kind: "none", label: "No shares", shares: 0n };
}

/** Owner/admin/member invites only. Accountant and viewer are not prompted. */
export function needsOwnershipPrompt(person: OwnershipPerson): boolean {
  if (!PROMPT_ROLES.has(person.role)) return false;
  if (person.linked) return false;
  if (person.decision !== null) return false;
  return true;
}

export function undecidedReminder(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return "1 team member has ownership undecided";
  return `${count} team members have ownership undecided`;
}

export function buildOwnershipView(input: { businessName: string; viewerRole: string; members: OwnershipPerson[] }) {
  const members = input.members.map((member) => {
    const ownership = memberOwnership(member);
    return { ...member, ownershipKind: ownership.kind, ownershipLabel: ownership.label };
  });
  const showEquity = can(input.viewerRole, "view_equity");
  const undecided = showEquity ? members.filter((member) => member.ownershipKind === "undecided").length : 0;
  const next = can(input.viewerRole, "manage_equity") ? input.members.find((member) => needsOwnershipPrompt(member)) ?? null : null;
  return {
    members,
    undecided,
    reminder: undecidedReminder(undecided),
    prompt: next
      ? {
          memberId: next.id,
          userId: next.userId,
          name: next.name,
          title: `Set ownership for ${next.name}?`,
          body: `${next.name} has joined ${input.businessName} as a team member, but no company ownership has been assigned.`,
        }
      : null,
  };
}

/** Opens the existing share-issuance flow. Does not write a percent or a share event. */
export function assignOwnershipIntent(person: { name: string; userId: string }) {
  return {
    type: "open-equity" as const,
    holder: person.name.trim(),
    linkUserId: person.userId,
    shareEvents: [] as const,
  };
}

/** Connect a login to shares that already exist. Does not issue or change a percent. */
export function linkExistingHolder(input: { holder: string; linkUserId: string }) {
  const holder = input.holder.trim();
  if (!holder) throw new Error("Choose a shareholder");
  if (!input.linkUserId) throw new Error("Choose a team member");
  return { holder, linkUserId: input.linkUserId, shareEvents: [] as const };
}

/** Invite acceptance grants a login role only. */
export function accessGrantFromInvite(role: string) {
  return { role: assertInviteRole(role), shares: 0n as const, decision: null, shareEvents: [] as const };
}

/** "No shares" and "Decide later" record a review. They do not issue shares. */
export function ownershipDecisionWrite(decision: string) {
  const recorded = recordedDecision(decision);
  if (!recorded) throw new Error("Choose no shares or decide later");
  return { decision: recorded, shareEvents: [] as const };
}

/**
 * Headcount, role, reimbursements, and personally paid expenses are not cap-table inputs.
 * Callers must not turn this result into share events.
 */
export function sharesFromActivity(_input: { teamCount: number; role: string; personalPaid: bigint; reimbursement: bigint }) {
  return { shares: 0n as const, decision: null, shareEvents: [] as const };
}
