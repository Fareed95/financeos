import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertInviteRole, claimInvite, inviteState, type InviteRole } from "@/lib/biz-access";
import type { Sql } from "@/lib/db";
import { requireBusiness } from "@/lib/server/business";
import { ensureUser } from "@/lib/server/ensure";
import { publicError } from "@/lib/utils";

async function hashToken(token: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

async function newToken() {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(24).toString("base64url");
}

async function audit(sql: Sql, businessId: string, actorId: string, action: string, entityId: string) {
  await sql`
    insert into biz_audit (id, business_id, actor_id, action, entity, entity_id)
    values (${crypto.randomUUID()}, ${businessId}, ${actorId}, ${action}, 'member', ${entityId})
  `;
}

const ROLE_COPY: Record<InviteRole, string> = {
  admin: "Can manage most business data and the team, except the owner.",
  accountant: "Can manage transactions, invoices, expenses and reports. Not API keys or ownership.",
  member: "Can add day-to-day records. Cannot manage the team, API keys, or equity.",
  viewer: "Can view the business. Cannot change anything.",
};

export async function listTeam(sql: Sql, userId: string, projectId: string) {
  const { businessId, role } = await requireBusiness(sql, userId, projectId, "view_finance");
  const owner = await sql<{ user_id: string; full_name: string | null; email: string | null }>`
    select pr.user_id, p.full_name, u.email
    from projects pr
    join businesses b on b.project_id = pr.id
    left join profiles p on p.id = pr.user_id
    left join "user" u on u.id = pr.user_id
    where b.id = ${businessId}
  `;
  const members = await sql<{ id: string; user_id: string; role: string; full_name: string | null; email: string | null }>`
    select m.id, m.user_id, m.role, p.full_name, u.email
    from biz_members m
    left join profiles p on p.id = m.user_id
    left join "user" u on u.id = m.user_id
    where m.business_id = ${businessId} and m.status = 'active'
    order by m.joined_at
  `;
  const invites = await sql<{ id: string; email: string | null; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }>`
    select id, email, role, expires_at::text as expires_at, accepted_at::text as accepted_at, revoked_at::text as revoked_at
    from biz_invites where business_id = ${businessId}
    order by created_at desc
  `;
  const now = Date.now();
  return {
    role,
    canManage: role === "owner" || role === "admin",
    members: [
      {
        id: "owner",
        userId: owner[0]?.user_id ?? "",
        name: owner[0]?.full_name || "Owner",
        email: owner[0]?.email ?? null,
        role: "owner",
        status: "active",
        you: owner[0]?.user_id === userId,
      },
      ...members.map((member) => ({
        id: member.id,
        userId: member.user_id,
        name: member.full_name || "Member",
        email: member.email,
        role: member.role,
        status: "active",
        you: member.user_id === userId,
      })),
    ],
    invites: invites
      .map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        state: inviteState({ revokedAt: invite.revoked_at, acceptedAt: invite.accepted_at, expiresAt: invite.expires_at, now }),
      }))
      .filter((invite) => invite.state !== "used"),
    roleCopy: ROLE_COPY,
  };
}

export async function createBizInvite(
  sql: Sql,
  userId: string,
  projectId: string,
  input: { role: string; email?: string | null; days?: number },
) {
  const { businessId } = await requireBusiness(sql, userId, projectId, "manage_team");
  const role = assertInviteRole(input.role);
  const days = input.days === 1 || input.days === 14 ? input.days : 7;
  const token = await newToken();
  const id = crypto.randomUUID();
  await sql`
    insert into biz_invites (id, business_id, email, role, token_hash, invited_by, expires_at)
    values (
      ${id}, ${businessId}, ${input.email?.trim() || null}, ${role}, ${await hashToken(token)}, ${userId},
      now() + ${`${days} days`}::interval
    )
  `;
  await audit(sql, businessId, userId, "invite.created", id);
  return { path: `/invite/${token}`, role, days };
}

export async function revokeBizInvite(sql: Sql, userId: string, projectId: string, inviteId: string) {
  const { businessId } = await requireBusiness(sql, userId, projectId, "manage_team");
  await sql`
    update biz_invites set revoked_at = now()
    where id = ${inviteId} and business_id = ${businessId} and accepted_at is null and revoked_at is null
  `;
  await audit(sql, businessId, userId, "invite.revoked", inviteId);
  return { ok: true };
}

export async function setBizRole(sql: Sql, userId: string, projectId: string, memberId: string, role: string) {
  const { businessId } = await requireBusiness(sql, userId, projectId, "manage_team");
  const next = assertInviteRole(role);
  const rows = await sql<{ id: string }>`
    update biz_members set role = ${next}
    where id = ${memberId} and business_id = ${businessId} and status = 'active'
    returning id
  `;
  if (!rows[0]) throw new Error("Member not found");
  await audit(sql, businessId, userId, "member.role_changed", memberId);
  return { ok: true };
}

export async function removeBizMember(sql: Sql, userId: string, projectId: string, memberId: string) {
  const { businessId } = await requireBusiness(sql, userId, projectId, "manage_team");
  const rows = await sql<{ id: string }>`
    update biz_members set status = 'removed'
    where id = ${memberId} and business_id = ${businessId} and status = 'active'
    returning id
  `;
  if (!rows[0]) throw new Error("Member not found");
  await audit(sql, businessId, userId, "member.removed", memberId);
  return { ok: true };
}

export async function previewBizInvite(sql: Sql, userId: string, token: string) {
  const rows = await sql<{
    id: string;
    project_id: string;
    project_name: string;
    role: string;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
    invited_name: string | null;
    owner_id: string;
  }>`
    select i.id, pr.id as project_id, pr.name as project_name, i.role, i.expires_at::text as expires_at,
           i.accepted_at::text as accepted_at, i.revoked_at::text as revoked_at,
           p.full_name as invited_name, pr.user_id as owner_id
    from biz_invites i
    join businesses b on b.id = i.business_id
    join projects pr on pr.id = b.project_id
    left join profiles p on p.id = i.invited_by
    where i.token_hash = ${await hashToken(token)}
  `;
  const invite = rows[0];
  if (!invite) return null;
  const member = await sql<{ id: string }>`
    select m.id from biz_members m
    join businesses b on b.id = m.business_id
    where b.project_id = ${invite.project_id} and m.user_id = ${userId} and m.status = 'active'
  `;
  let state = inviteState({
    revokedAt: invite.revoked_at,
    acceptedAt: invite.accepted_at,
    expiresAt: invite.expires_at,
    now: Date.now(),
  });
  if (invite.owner_id === userId || member[0]) state = "used";
  return {
    kind: "business" as const,
    inviteId: invite.id,
    projectId: invite.project_id,
    projectName: invite.project_name,
    invitedBy: invite.invited_name || "Someone",
    role: invite.role,
    summary: ROLE_COPY[invite.role as InviteRole] || "",
    state: invite.owner_id === userId || member[0] ? ("member" as const) : state,
  };
}

export async function acceptBizInvite(sql: Sql, userId: string, token: string) {
  const rows = await sql<{
    id: string;
    business_id: string;
    project_id: string;
    role: string;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
    owner_id: string;
  }>`
    select i.id, i.business_id, pr.id as project_id, i.role, i.expires_at::text as expires_at,
           i.accepted_at::text as accepted_at, i.revoked_at::text as revoked_at, pr.user_id as owner_id
    from biz_invites i
    join businesses b on b.id = i.business_id
    join projects pr on pr.id = b.project_id
    where i.token_hash = ${await hashToken(token)}
  `;
  const invite = rows[0];
  if (!invite) return null;
  if (invite.owner_id === userId) return { projectId: invite.project_id };
  const state = inviteState({
    revokedAt: invite.revoked_at,
    acceptedAt: invite.accepted_at,
    expiresAt: invite.expires_at,
    now: Date.now(),
  });
  const active = await sql<{ id: string }>`
    select id from biz_members where business_id = ${invite.business_id} and user_id = ${userId} and status = 'active'
  `;
  if (active[0]) return { projectId: invite.project_id };
  claimInvite(state);
  const claimed = await sql<{ id: string }>`
    update biz_invites set accepted_at = now(), accepted_by = ${userId}
    where id = ${invite.id} and accepted_at is null and revoked_at is null
    returning id
  `;
  if (!claimed[0]) throw new Error("This invite was already used");
  await sql`
    insert into biz_members (id, business_id, user_id, role, status)
    values (${crypto.randomUUID()}, ${invite.business_id}, ${userId}, ${invite.role}, 'active')
  `;
  await audit(sql, invite.business_id, userId, "invite.accepted", invite.id);
  return { projectId: invite.project_id };
}

export const finishBusinessSetup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; legalName?: string; kind?: string; gst?: string; stateCode?: string; gstin?: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const { businessId } = await requireBusiness(sql, context.userId, data.projectId, "manage_settings");
      await sql`
        update businesses set
          legal_name = coalesce(${data.legalName?.trim() || null}, legal_name),
          business_kind = ${data.kind || null},
          gst_registered = ${data.gst || null},
          state_code = coalesce(${data.stateCode?.trim().toUpperCase() || null}, state_code),
          gstin = coalesce(${data.gstin?.trim() || null}, gstin),
          setup_completed_at = coalesce(setup_completed_at, now())
        where id = ${businessId}
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't finish setup.");
    }
  });

export const getBusinessTeam = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      return await listTeam(sql, context.userId, data.projectId);
    } catch (err) {
      publicError(err, "Couldn't load the team.");
    }
  });

export const inviteBusinessMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; role: string; email?: string; days?: number }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      return await createBizInvite(sql, context.userId, data.projectId, data);
    } catch (err) {
      publicError(err, "Couldn't create that invite.");
    }
  });

export const revokeBusinessInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; inviteId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      return await revokeBizInvite(sql, context.userId, data.projectId, data.inviteId);
    } catch (err) {
      publicError(err, "Couldn't revoke that invite.");
    }
  });

export const changeBusinessRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; memberId: string; role: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      return await setBizRole(sql, context.userId, data.projectId, data.memberId, data.role);
    } catch (err) {
      publicError(err, "Couldn't change that role.");
    }
  });

export const removeBusinessMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; memberId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      return await removeBizMember(sql, context.userId, data.projectId, data.memberId);
    } catch (err) {
      publicError(err, "Couldn't remove that person.");
    }
  });
