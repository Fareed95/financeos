import { claimInvite, inviteState, type InviteView } from "./biz-access.ts";

/** Family roles are not Business roles and never grant Personal access. */
export const FAMILY_ROLES = ["owner", "adult", "member", "viewer"] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];

export const FAMILY_PERMISSIONS = [
  "view",
  "record",
  "manage_money",
  "manage_people",
  "manage_settings",
] as const;
export type FamilyPermission = (typeof FAMILY_PERMISSIONS)[number];

const GRANTS: Record<FamilyPermission, readonly FamilyRole[]> = {
  view: ["owner", "adult", "member", "viewer"],
  record: ["owner", "adult", "member"],
  manage_money: ["owner", "adult"],
  manage_people: ["owner"],
  manage_settings: ["owner"],
};

export function canFamily(role: string, permission: FamilyPermission) {
  return (GRANTS[permission] as readonly string[]).includes(role);
}

export function assertFamily(role: string, permission: FamilyPermission) {
  if (!canFamily(role, permission)) throw new Error("You don't have access to do that.");
}

const INVITE_ROLES = ["adult", "member", "viewer"] as const;
export type FamilyInviteRole = (typeof INVITE_ROLES)[number];

export function assertFamilyInviteRole(role: string): FamilyInviteRole {
  if (role === "adult" || role === "member" || role === "viewer") return role;
  throw new Error("Choose a family role");
}

export function assertSameFamily(memberFamilyId: string, requestedFamilyId: string) {
  if (memberFamilyId !== requestedFamilyId) throw new Error("You don't have access to do that.");
}

/** Joining a family never reveals another person's private books. */
export function familySeesPersonal(explicitlyShared: boolean) {
  return explicitlyShared;
}

export function familyInviteView(input: { revokedAt: string | null; acceptedAt: string | null; expiresAt: string; now: number }): InviteView {
  return inviteState(input);
}

export function claimFamilyInvite(state: InviteView) {
  return claimInvite(state);
}
