import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import { ensureUser } from "@/lib/server/ensure";
import { publicError } from "@/lib/utils";
import { parseMoney } from "@/lib/money";
import {
  assertFamily,
  assertFamilyInviteRole,
  assertSameFamily,
  canFamily,
  claimFamilyInvite,
  familyInviteView,
  type FamilyPermission,
} from "@/lib/family-access";
import { APP_NAME } from "@/lib/constants";
import { inviteMessage, sendInviteSmtp } from "@/lib/server/mail";

async function hashToken(token: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

async function newToken() {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(24).toString("base64url");
}

async function requireFamily(sql: Sql, userId: string, familyId: string, permission: FamilyPermission) {
  const rows = await sql<{ id: string; role: string; family_id: string }>`
    select id, role, family_id from family_people
    where family_id = ${familyId} and linked_user_id = ${userId} and status = 'active'
  `;
  const member = rows[0];
  if (!member) throw new Error("You don't have access to do that.");
  assertSameFamily(member.family_id, familyId);
  assertFamily(member.role, permission);
  return member;
}

function money(value: string | number) {
  const parsed = parseMoney(String(value || "0"));
  if (Number(parsed) <= 0) throw new Error("Enter an amount");
  return parsed;
}

function cleanEmail(raw: string) {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a real email");
  return email;
}

function safeOrigin(input: string | undefined | null) {
  if (!input) return "";
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

async function accountName(sql: Sql, userId: string) {
  const rows = await sql<{ full_name: string | null; name: string | null }>`
    select p.full_name, u.name
    from profiles p
    left join "user" u on u.id = p.id
    where p.id = ${userId}
  `;
  const name = (rows[0]?.full_name || rows[0]?.name || "").replace(/\s+/g, " ").trim();
  return name || "Family member";
}

async function sendFamilyInviteMail(to: string, fromName: string, familyName: string, url: string) {
  const smtp = await sendInviteSmtp(to, fromName, familyName, url);
  if (smtp.ok) return { emailed: true as const, mailError: null };
  const key = process.env.RESEND_API_KEY;
  if (key && url.startsWith("http")) {
    try {
      const message = inviteMessage(fromName, familyName, url);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.MAIL_FROM || `${APP_NAME} <onboarding@resend.dev>`,
          to: [to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (res.ok) return { emailed: true as const, mailError: null };
    } catch {
      /* fall through to the Gmail message */
    }
  }
  return { emailed: false as const, mailError: smtp.error || "Email didn't send" };
}

async function ensureMemberWallets(sql: Sql, familyId: string) {
  const people = await sql<{ id: string; display_name: string }>`
    select id, display_name from family_people where family_id = ${familyId} and status = 'active'
  `;
  const wallets = await sql<{ person_id: string }>`
    select person_id from family_accounts where family_id = ${familyId} and person_id is not null
  `;
  const have = new Set(wallets.map((row) => row.person_id));
  for (const person of people) {
    if (have.has(person.id)) continue;
    await sql`
      insert into family_accounts (id, family_id, name, kind, balance, person_id)
      values (${crypto.randomUUID()}, ${familyId}, ${person.display_name}, 'cash', 0, ${person.id})
    `;
  }
}

export const listFamilies = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      return await sql<{ id: string; name: string; members: number; role: string }>`
        select f.id, f.name, me.role, (
          select count(*)::int from family_people p where p.family_id = f.id and p.status = 'active'
        ) as members
        from families f
        join family_people me on me.family_id = f.id and me.linked_user_id = ${context.userId} and me.status = 'active'
        order by f.created_at
      `;
    } catch (err) {
      publicError(err, "Couldn't load families.");
    }
  });

export const createFamily = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { name: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const name = data.name.trim();
      if (!name) throw new Error("Give the family a name");
      const profile = await sql<{ full_name: string | null }>`select full_name from profiles where id = ${context.userId}`;
      const id = crypto.randomUUID();
      await sql`insert into families (id, name, created_by) values (${id}, ${name}, ${context.userId})`;
      await sql`
        insert into family_people (id, family_id, display_name, linked_user_id, role, status)
        values (${crypto.randomUUID()}, ${id}, ${profile[0]?.full_name || "You"}, ${context.userId}, 'owner', 'active')
      `;
      await ensureMemberWallets(sql, id);
      return { id };
    } catch (err) {
      publicError(err, "Couldn't create that family.");
    }
  });

export const getFamily = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const me = await requireFamily(sql, context.userId, data.familyId, "view");
      await ensureMemberWallets(sql, data.familyId);
      const family = await sql<{ id: string; name: string; show_invites: boolean }>`
        select id, name, show_invites from families where id = ${data.familyId}
      `;
      const people = await sql<{ id: string; display_name: string; role: string; linked_user_id: string | null }>`
        select id, display_name, role, linked_user_id from family_people
        where family_id = ${data.familyId} and status = 'active' order by created_at
      `;
      const accounts = await sql<{ id: string; name: string; kind: string; balance: string; person_id: string | null }>`
        select a.id, a.name, a.kind, a.balance::text as balance, a.person_id
        from family_accounts a
        left join family_people p on p.id = a.person_id
        where a.family_id = ${data.familyId}
          and (a.person_id is null or p.status = 'active')
        order by a.created_at
      `;
      const entries = await sql<{
        id: string; kind: string; amount: string; entry_date: string; category: string | null;
        person_id: string | null; account_id: string | null; to_account_id: string | null; paid_from: string; reimburse: boolean; note: string | null; split_id: string | null; display_name: string | null;
        account_name: string | null; to_name: string | null;
      }>`
        select e.id, e.kind, e.amount::text as amount, e.entry_date::text as entry_date, e.category,
               e.person_id, e.account_id, e.to_account_id, e.paid_from, e.reimburse, e.note, e.split_id, p.display_name,
               a.name as account_name, t.name as to_name
        from family_entries e
        left join family_people p on p.id = e.person_id
        left join family_accounts a on a.id = e.account_id
        left join family_accounts t on t.id = e.to_account_id
        where e.family_id = ${data.familyId}
        order by e.entry_date desc, e.created_at desc
        limit 300
      `;
      const due = await sql<{ person_id: string; display_name: string; open: string }>`
        select r.person_id, p.display_name, sum(r.amount - r.paid)::text as open
        from family_reimbursements r
        join family_people p on p.id = r.person_id
        where r.family_id = ${data.familyId}
        group by r.person_id, p.display_name
        having sum(r.amount - r.paid) > 0
      `;
      const budgets = await sql<{ id: string; category: string; amount: string }>`
        select id, category, amount::text as amount from family_budgets where family_id = ${data.familyId} order by category
      `;
      const goals = await sql<{ id: string; name: string; target: string; saved: string }>`
        select id, name, target::text as target, saved::text as saved from family_goals where family_id = ${data.familyId} order by created_at
      `;
      const investments = await sql<{ id: string; name: string; kind: string; owner_label: string | null; invested: string; current_value: string; as_of: string }>`
        select id, name, kind, owner_label, invested::text as invested, current_value::text as current_value, as_of::text as as_of
        from family_investments where family_id = ${data.familyId} order by created_at
      `;
      const liabilities = await sql<{ id: string; name: string; kind: string; balance: string }>`
        select id, name, kind, balance::text as balance from family_liabilities where family_id = ${data.familyId} order by created_at
      `;
      const bills = await sql<{ id: string; name: string; amount: string; due_day: number; last_paid: string | null }>`
        select id, name, amount::text as amount, due_day, last_paid::text as last_paid from family_bills where family_id = ${data.familyId} order by due_day
      `;
      const invites = canFamily(me.role, "manage_people")
        ? await sql<{ id: string; email: string | null; role: string; token: string | null; expires_at: string; accepted_at: string | null; revoked_at: string | null }>`
            select id, email, role, token, expires_at::text as expires_at, accepted_at::text as accepted_at, revoked_at::text as revoked_at
            from family_invites where family_id = ${data.familyId} order by created_at desc
          `
        : [];
      return {
        family: family[0],
        showInvites: family[0]?.show_invites !== false,
        meId: me.id,
        role: me.role,
        canRecord: canFamily(me.role, "record"),
        canMoney: canFamily(me.role, "manage_money"),
        canPeople: canFamily(me.role, "manage_people"),
        people,
        accounts,
        entries,
        due,
        budgets,
        goals,
        investments,
        liabilities,
        bills,
        invites: invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          path: invite.token ? `/invite/${invite.token}` : null,
          expires_at: invite.expires_at,
          accepted_at: invite.accepted_at,
          revoked_at: invite.revoked_at,
          state: familyInviteView({
            revokedAt: invite.revoked_at,
            acceptedAt: invite.accepted_at,
            expiresAt: invite.expires_at,
            now: Date.now(),
          }),
        })).filter((invite) => invite.state !== "used"),
      };
    } catch (err) {
      publicError(err, "Couldn't load this family.");
    }
  });

export const addFamilyPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; name: string; role: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_people");
      const name = data.name.trim();
      if (!name) throw new Error("Give them a name");
      const role = data.role === "adult" || data.role === "viewer" ? data.role : "member";
      const id = crypto.randomUUID();
      await sql`
        insert into family_people (id, family_id, display_name, role, status)
        values (${id}, ${data.familyId}, ${name}, ${role}, 'active')
      `;
      await ensureMemberWallets(sql, data.familyId);
      return { id };
    } catch (err) {
      publicError(err, "Couldn't add that person.");
    }
  });

export async function createFamilyEmailInvite(
  sql: Sql,
  userId: string,
  input: { familyId: string; email: string; origin?: string; role?: string },
) {
  await requireFamily(sql, userId, input.familyId, "manage_people");
  const email = cleanEmail(input.email);
  const role = input.role ? assertFamilyInviteRole(input.role) : "adult";
  const alreadyUser = await sql<{ id: string }>`
    select id from "user" where lower(email) = ${email} limit 1
  `;
  if (alreadyUser[0]) {
    const member = await sql<{ id: string }>`
      select id from family_people
      where family_id = ${input.familyId} and linked_user_id = ${alreadyUser[0].id} and status = 'active'
    `;
    if (member[0]) throw new Error("They're already in this family");
  }
  const open = await sql<{ id: string }>`
    select id from family_invites
    where family_id = ${input.familyId} and lower(email) = ${email}
      and accepted_at is null and revoked_at is null and expires_at > now()
    limit 1
  `;
  if (open[0]) throw new Error("That email already has an invite. Revoke it first.");
  const token = await newToken();
  const id = crypto.randomUUID();
  await sql`
    insert into family_invites (id, family_id, email, role, token, token_hash, invited_by, expires_at)
    values (${id}, ${input.familyId}, ${email}, ${role}, ${token}, ${await hashToken(token)}, ${userId}, now() + interval '7 days')
  `;
  const family = await sql<{ name: string }>`select name from families where id = ${input.familyId}`;
  const origin = safeOrigin(input.origin);
  const path = `/invite/${token}`;
  const url = origin ? `${origin}${path}` : "";
  const mailed = await sendFamilyInviteMail(email, await accountName(sql, userId), family[0]?.name || "your family", url);
  return { path, url, emailed: mailed.emailed, mailError: mailed.mailError, email };
}

export const inviteFamilyMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; email: string; origin?: string; role?: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      return await createFamilyEmailInvite(sql, context.userId, data);
    } catch (err) {
      publicError(err, "Couldn't create that invite.");
    }
  });

export const removeFamilyPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; personId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const me = await requireFamily(sql, context.userId, data.familyId, "manage_people");
      if (me.id === data.personId) throw new Error("You can't remove yourself");
      const person = await sql<{ id: string; role: string }>`
        select id, role from family_people
        where id = ${data.personId} and family_id = ${data.familyId} and status = 'active'
      `;
      if (!person[0]) throw new Error("That person is not in this family");
      if (person[0].role === "owner") throw new Error("The owner stays");
      const wallet = await sql<{ id: string; balance: string }>`
        select id, balance::text as balance from family_accounts where person_id = ${data.personId}
      `;
      if (wallet[0] && Number(wallet[0].balance) > 0) throw new Error("Move their money out first");
      await sql`update family_people set status = 'removed' where id = ${data.personId}`;
      if (wallet[0]) {
        const used = await sql<{ id: string }>`
          select id from family_entries
          where account_id = ${wallet[0].id} or to_account_id = ${wallet[0].id}
          limit 1
        `;
        if (!used[0]) await sql`delete from family_accounts where id = ${wallet[0].id}`;
      }
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't remove that person.");
    }
  });

export const revokeFamilyInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; inviteId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_people");
      await sql`
        update family_invites set revoked_at = now()
        where id = ${data.inviteId} and family_id = ${data.familyId} and accepted_at is null
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't revoke that invite.");
    }
  });

export const copyFamilyInviteLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; inviteId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_people");
      const rows = await sql<{ id: string; token: string | null }>`
        select id, token from family_invites
        where id = ${data.inviteId} and family_id = ${data.familyId}
          and accepted_at is null and revoked_at is null and expires_at > now()
      `;
      if (!rows[0]) throw new Error("That invite is no longer open");
      let token = rows[0].token;
      if (!token) {
        token = await newToken();
        await sql`
          update family_invites set token = ${token}, token_hash = ${await hashToken(token)}
          where id = ${data.inviteId}
        `;
      }
      return { path: `/invite/${token}` };
    } catch (err) {
      publicError(err, "Couldn't copy that link.");
    }
  });

export const setFamilyInvitesVisible = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; show: boolean }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_people");
      await sql`update families set show_invites = ${data.show} where id = ${data.familyId}`;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't update that.");
    }
  });

export const listMyFamilyInvites = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      return await sql<{ id: string; family_id: string; name: string; invited_by: string | null }>`
        select i.id, i.family_id, f.name, p.full_name as invited_by
        from family_invites i
        join families f on f.id = i.family_id
        join "user" u on u.id = ${context.userId} and lower(u.email) = lower(i.email)
        left join profiles p on p.id = i.invited_by
        where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
          and not exists (
            select 1 from family_people fp
            where fp.family_id = i.family_id and fp.linked_user_id = ${context.userId} and fp.status = 'active'
          )
        order by i.created_at desc
      `;
    } catch (err) {
      publicError(err, "Couldn't load invites.");
    }
  });

export const acceptMyFamilyInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { inviteId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const mine = await sql<{ email: string }>`select email from "user" where id = ${context.userId}`;
      const rows = await sql<{ id: string; token: string | null; email: string | null }>`
        select id, token, email from family_invites
        where id = ${data.inviteId} and accepted_at is null and revoked_at is null and expires_at > now()
      `;
      const invite = rows[0];
      if (!invite?.email || invite.email.toLowerCase() !== (mine[0]?.email || "").toLowerCase()) {
        throw new Error("This invite isn't for your email");
      }
      let token = invite.token;
      if (!token) {
        token = await newToken();
        await sql`
          update family_invites set token = ${token}, token_hash = ${await hashToken(token)}
          where id = ${invite.id} and accepted_at is null
        `;
      }
      return await acceptFamilyInvite(sql, context.userId, token);
    } catch (err) {
      publicError(err, "Couldn't join that family.");
    }
  });

export async function previewFamilyInvite(sql: Sql, userId: string, token: string) {
  const rows = await sql<{
    id: string; family_id: string; name: string; role: string; expires_at: string;
    accepted_at: string | null; revoked_at: string | null; invited_name: string | null;
  }>`
    select i.id, i.family_id, f.name, i.role, i.expires_at::text as expires_at,
           i.accepted_at::text as accepted_at, i.revoked_at::text as revoked_at, p.full_name as invited_name
    from family_invites i
    join families f on f.id = i.family_id
    left join profiles p on p.id = i.invited_by
    where i.token_hash = ${await hashToken(token)}
  `;
  const invite = rows[0];
  if (!invite) return null;
  const member = await sql<{ id: string }>`
    select id from family_people where family_id = ${invite.family_id} and linked_user_id = ${userId} and status = 'active'
  `;
  const state = member[0]
    ? ("member" as const)
    : familyInviteView({ revokedAt: invite.revoked_at, acceptedAt: invite.accepted_at, expiresAt: invite.expires_at, now: Date.now() });
  return {
    kind: "family" as const,
    inviteId: invite.id,
    projectId: invite.family_id,
    projectName: invite.name,
    invitedBy: invite.invited_name || "Someone",
    role: invite.role,
    summary: "This opens the family only. It does not show anyone's personal salary or personal accounts.",
    state,
  };
}

export async function acceptFamilyInvite(sql: Sql, userId: string, token: string) {
  const rows = await sql<{
    id: string; family_id: string; person_id: string | null; role: string;
    expires_at: string; accepted_at: string | null; revoked_at: string | null;
  }>`
    select id, family_id, person_id, role, expires_at::text as expires_at,
           accepted_at::text as accepted_at, revoked_at::text as revoked_at
    from family_invites where token_hash = ${await hashToken(token)}
  `;
  const invite = rows[0];
  if (!invite) return null;
  const existing = await sql<{ id: string }>`
    select id from family_people where family_id = ${invite.family_id} and linked_user_id = ${userId} and status = 'active'
  `;
  if (existing[0]) {
    const real = await accountName(sql, userId);
    await sql`update family_people set display_name = ${real} where id = ${existing[0].id}`;
    await sql`update family_accounts set name = ${real} where person_id = ${existing[0].id}`;
    await ensureMemberWallets(sql, invite.family_id);
    return { projectId: invite.family_id, family: true as const };
  }
  const state = familyInviteView({
    revokedAt: invite.revoked_at,
    acceptedAt: invite.accepted_at,
    expiresAt: invite.expires_at,
    now: Date.now(),
  });
  if (state !== "open") {
    const mine = await sql<{ accepted_by: string | null }>`
      select accepted_by from family_invites where id = ${invite.id}
    `;
    if (mine[0]?.accepted_by !== userId) claimFamilyInvite(state);
  } else {
    const claimed = await sql<{ id: string }>`
      update family_invites set accepted_at = now(), accepted_by = ${userId}
      where id = ${invite.id} and accepted_at is null and revoked_at is null and expires_at > now()
      returning id
    `;
    if (!claimed[0]) {
      const mine = await sql<{ id: string }>`
        select id from family_invites where id = ${invite.id} and accepted_by = ${userId}
      `;
      if (!mine[0]) throw new Error("This invite was already used");
    }
  }
  const real = await accountName(sql, userId);
  if (invite.person_id) {
    const linked = await sql<{ id: string }>`
      update family_people set linked_user_id = ${userId}, role = ${invite.role}, display_name = ${real}
      where id = ${invite.person_id} and family_id = ${invite.family_id} and (linked_user_id is null or linked_user_id = ${userId})
      returning id
    `;
    if (linked[0]) {
      await sql`update family_accounts set name = ${real} where person_id = ${invite.person_id}`;
      await ensureMemberWallets(sql, invite.family_id);
      return { projectId: invite.family_id, family: true as const };
    }
  }
  const again = await sql<{ id: string }>`
    select id from family_people where family_id = ${invite.family_id} and linked_user_id = ${userId} and status = 'active'
  `;
  if (!again[0]) {
    await sql`
      insert into family_people (id, family_id, display_name, linked_user_id, role, status)
      select ${crypto.randomUUID()}, ${invite.family_id}, ${real}, ${userId}, ${invite.role}, 'active'
      where not exists (
        select 1 from family_people
        where family_id = ${invite.family_id} and linked_user_id = ${userId} and status = 'active'
      )
    `;
  } else {
    await sql`update family_people set display_name = ${real} where id = ${again[0].id}`;
    await sql`update family_accounts set name = ${real} where person_id = ${again[0].id}`;
  }
  await ensureMemberWallets(sql, invite.family_id);
  return { projectId: invite.family_id, family: true as const };
}

export const addFamilyAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; name: string; kind?: string; balance?: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_money");
      const name = data.name.trim();
      if (!name) throw new Error("Name the account");
      const kind = data.kind === "bank" || data.kind === "upi" || data.kind === "other" ? data.kind : "cash";
      const balance = parseMoney(data.balance || "0");
      const id = crypto.randomUUID();
      await sql`
        insert into family_accounts (id, family_id, name, kind, balance)
        values (${id}, ${data.familyId}, ${name}, ${kind}, ${balance}::numeric)
      `;
      return { id };
    } catch (err) {
      publicError(err, "Couldn't add that account.");
    }
  });

async function familyAccount(sql: Sql, familyId: string, accountId: string) {
  const rows = await sql<{ id: string; balance: string; person_id: string | null; name: string }>`
    select id, balance::text as balance, person_id, name from family_accounts where id = ${accountId} and family_id = ${familyId}
  `;
  if (!rows[0]) throw new Error("That family account was not found");
  return rows[0];
}

export const postFamilyEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    familyId: string;
    kind: "contribution" | "expense";
    amount: string;
    date: string;
    category?: string;
    personId?: string;
    accountId?: string;
    paidFrom?: "family" | "personal";
    reimburse?: boolean;
    note?: string;
  }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, data.kind === "expense" && data.reimburse ? "manage_money" : "record");
      const amount = money(data.amount);
      const paidFrom = data.paidFrom === "personal" ? "personal" : "family";
      const reimburse = paidFrom === "personal" && Boolean(data.reimburse);
      let personId = data.personId || null;
      if (personId) {
        const person = await sql<{ id: string }>`select id from family_people where id = ${personId} and family_id = ${data.familyId}`;
        if (!person[0]) throw new Error("That person is not in this family");
      }
      if ((data.kind === "contribution" || (data.kind === "expense" && paidFrom === "family")) && !data.accountId) {
        throw new Error("Choose whose account");
      }
      if (data.accountId) {
        const account = await familyAccount(sql, data.familyId, data.accountId);
        if (!personId) personId = account.person_id;
        if ((data.kind === "contribution" || paidFrom === "family") && data.kind !== "contribution" && Number(account.balance) < Number(amount)) {
          throw new Error(`Not enough in ${account.name}`);
        }
        if (data.kind === "contribution" || paidFrom === "family") {
          const sign = data.kind === "contribution" ? amount : `-${amount}`;
          await sql`update family_accounts set balance = balance + ${sign}::numeric where id = ${data.accountId}`;
        }
      }
      const id = crypto.randomUUID();
      await sql`
        insert into family_entries (id, family_id, kind, amount, entry_date, category, person_id, account_id, paid_from, reimburse, note, created_by)
        values (
          ${id}, ${data.familyId}, ${data.kind}, ${amount}::numeric, ${data.date}, ${data.category?.trim() || null},
          ${personId}, ${data.accountId || null}, ${paidFrom}, ${reimburse}, ${data.note?.trim() || null}, ${context.userId}
        )
      `;
      if (reimburse && data.personId) {
        await sql`
          insert into family_reimbursements (id, family_id, entry_id, person_id, amount)
          values (${crypto.randomUUID()}, ${data.familyId}, ${id}, ${data.personId}, ${amount}::numeric)
        `;
      }
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't save that.");
    }
  });

export const postFamilySplit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    familyId: string;
    date: string;
    category: string;
    parts: { accountId: string; amount: string }[];
  }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "record");
      const category = data.category.trim();
      if (!category) throw new Error("Say what it was");
      const parts = data.parts
        .map((part) => ({ accountId: part.accountId, amount: money(part.amount) }))
        .filter((part) => Number(part.amount) > 0);
      if (parts.length < 2) throw new Error("Split needs at least two accounts");
      if (new Set(parts.map((part) => part.accountId)).size !== parts.length) throw new Error("Each person once");
      const accounts = [];
      for (const part of parts) {
        const account = await familyAccount(sql, data.familyId, part.accountId);
        if (Number(account.balance) < Number(part.amount)) throw new Error(`Not enough in ${account.name}`);
        accounts.push(account);
      }
      const splitId = crypto.randomUUID();
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i]!;
        const account = accounts[i]!;
        await sql`update family_accounts set balance = balance - ${part.amount}::numeric where id = ${part.accountId}`;
        await sql`
          insert into family_entries (
            id, family_id, kind, amount, entry_date, category, person_id, account_id, paid_from, split_id, created_by
          ) values (
            ${crypto.randomUUID()}, ${data.familyId}, 'expense', ${part.amount}::numeric, ${data.date}, ${category},
            ${account.person_id}, ${part.accountId}, 'family', ${splitId}, ${context.userId}
          )
        `;
      }
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't save that split.");
    }
  });

export const transferFamilyMoney = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; fromAccountId: string; toAccountId: string; amount: string; date: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "record");
      if (data.fromAccountId === data.toAccountId) throw new Error("Pick two different people");
      const amount = money(data.amount);
      const from = await familyAccount(sql, data.familyId, data.fromAccountId);
      const to = await familyAccount(sql, data.familyId, data.toAccountId);
      if (Number(from.balance) < Number(amount)) throw new Error(`Not enough in ${from.name}`);
      await sql`update family_accounts set balance = balance - ${amount}::numeric where id = ${from.id}`;
      await sql`update family_accounts set balance = balance + ${amount}::numeric where id = ${to.id}`;
      await sql`
        insert into family_entries (id, family_id, kind, amount, entry_date, person_id, account_id, to_account_id, paid_from, note, created_by)
        values (
          ${crypto.randomUUID()}, ${data.familyId}, 'transfer', ${amount}::numeric, ${data.date}, ${from.person_id},
          ${from.id}, ${to.id}, 'family', ${`${from.name} → ${to.name}`}, ${context.userId}
        )
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't move that money.");
    }
  });

export const payFamilyBack = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; personId: string; amount: string; accountId: string; date: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_money");
      const amount = Number(money(data.amount));
      const account = await familyAccount(sql, data.familyId, data.accountId);
      if (Number(account.balance) < amount) throw new Error("Family money is short");
      const open = await sql<{ id: string; left: string }>`
        select id, (amount - paid)::text as left from family_reimbursements
        where family_id = ${data.familyId} and person_id = ${data.personId} and amount > paid
        order by created_at
      `;
      const openTotal = open.reduce((sum, row) => sum + Number(row.left), 0);
      if (amount - openTotal > 0.001) throw new Error("Nothing left to return");
      let rest = amount;
      for (const row of open) {
        if (rest <= 0) break;
        const left = Number(row.left);
        const take = Math.min(left, rest);
        await sql`update family_reimbursements set paid = paid + ${take}::numeric where id = ${row.id}`;
        rest = Math.round((rest - take) * 100) / 100;
      }
      await sql`update family_accounts set balance = balance - ${amount}::numeric where id = ${data.accountId}`;
      await sql`
        insert into family_entries (id, family_id, kind, amount, entry_date, person_id, account_id, paid_from, created_by, note)
        values (${crypto.randomUUID()}, ${data.familyId}, 'payback', ${amount}::numeric, ${data.date}, ${data.personId}, ${data.accountId}, 'family', ${context.userId}, 'Paid back')
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't pay that back.");
    }
  });

export const contributeFromPersonal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; accountId: string; personalAccountId: string; amount: string; date: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const me = await requireFamily(sql, context.userId, data.familyId, "record");
      const amount = money(data.amount);
      const personal = await sql<{ id: string }>`
        select id from accounts where id = ${data.personalAccountId} and user_id = ${context.userId}
      `;
      if (!personal[0]) throw new Error("That personal account was not found");
      await familyAccount(sql, data.familyId, data.accountId);
      const family = await sql<{ name: string }>`select name from families where id = ${data.familyId}`;
      const txnId = crypto.randomUUID();
      const entryId = crypto.randomUUID();
      const linkId = crypto.randomUUID();
      await sql`
        insert into transactions (
          id, user_id, account_id, type, amount, transaction_date, description, is_committed, affects_ledger
        ) values (
          ${txnId}, ${context.userId}, ${data.personalAccountId}, 'transfer', ${amount}::numeric, ${data.date},
          ${`Moved to ${family[0]?.name || "family"}`}, true, true
        )
      `;
      await sql`update family_accounts set balance = balance + ${amount}::numeric where id = ${data.accountId} and family_id = ${data.familyId}`;
      await sql`
        insert into family_entries (id, family_id, kind, amount, entry_date, person_id, account_id, paid_from, transfer_id, created_by, note)
        values (${entryId}, ${data.familyId}, 'contribution', ${amount}::numeric, ${data.date}, ${me.id}, ${data.accountId}, 'family', ${linkId}, ${context.userId}, 'From personal')
      `;
      await sql`
        insert into cross_context_links (id, kind, user_id, family_id, personal_transaction_id, family_entry_id, amount)
        values (${linkId}, 'personal_to_family', ${context.userId}, ${data.familyId}, ${txnId}, ${entryId}, ${amount}::numeric)
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't move that money.");
    }
  });

export const saveFamilyBudget = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; category: string; amount: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_money");
      const category = data.category.trim();
      if (!category) throw new Error("Name the budget");
      await sql`
        insert into family_budgets (id, family_id, category, amount)
        values (${crypto.randomUUID()}, ${data.familyId}, ${category}, ${money(data.amount)}::numeric)
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't save that budget.");
    }
  });

export const saveFamilyGoal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; name: string; target: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_money");
      const name = data.name.trim();
      if (!name) throw new Error("Name the goal");
      await sql`
        insert into family_goals (id, family_id, name, target)
        values (${crypto.randomUUID()}, ${data.familyId}, ${name}, ${money(data.target)}::numeric)
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't save that goal.");
    }
  });

export const moveToFamilyGoal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; goalId: string; accountId: string; amount: string; date: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_money");
      const amount = money(data.amount);
      const account = await familyAccount(sql, data.familyId, data.accountId);
      if (Number(account.balance) < Number(amount)) throw new Error("Family money is short");
      const goal = await sql<{ id: string }>`select id from family_goals where id = ${data.goalId} and family_id = ${data.familyId}`;
      if (!goal[0]) throw new Error("Goal not found");
      await sql`update family_accounts set balance = balance - ${amount}::numeric where id = ${data.accountId}`;
      await sql`update family_goals set saved = saved + ${amount}::numeric where id = ${data.goalId}`;
      await sql`
        insert into family_entries (id, family_id, kind, amount, entry_date, account_id, paid_from, created_by, note)
        values (${crypto.randomUUID()}, ${data.familyId}, 'goal_move', ${amount}::numeric, ${data.date}, ${data.accountId}, 'family', ${context.userId}, 'Moved to a goal')
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't move that.");
    }
  });

export const saveFamilyInvestment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; name: string; kind: string; owner?: string; invested: string; current: string; date: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_money");
      await sql`
        insert into family_investments (id, family_id, name, kind, owner_label, invested, current_value, as_of, manual)
        values (
          ${crypto.randomUUID()}, ${data.familyId}, ${data.name.trim()}, ${data.kind.trim() || "Other"}, ${data.owner?.trim() || null},
          ${money(data.invested)}::numeric, ${parseMoney(data.current || "0")}::numeric, ${data.date}, true
        )
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't save that investment.");
    }
  });

export const saveFamilyLiability = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; name: string; kind: string; balance: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_money");
      await sql`
        insert into family_liabilities (id, family_id, name, kind, balance)
        values (${crypto.randomUUID()}, ${data.familyId}, ${data.name.trim()}, ${data.kind.trim() || "Other"}, ${money(data.balance)}::numeric)
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't save that loan.");
    }
  });

export const saveFamilyBill = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; name: string; amount: string; dueDay: number }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "record");
      const day = Math.min(28, Math.max(1, Math.round(data.dueDay || 1)));
      await sql`
        insert into family_bills (id, family_id, name, amount, due_day)
        values (${crypto.randomUUID()}, ${data.familyId}, ${data.name.trim()}, ${money(data.amount)}::numeric, ${day})
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't save that bill.");
    }
  });

export const markFamilyBillPaid = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; billId: string; date: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "record");
      await sql`
        update family_bills set last_paid = ${data.date}
        where id = ${data.billId} and family_id = ${data.familyId}
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't mark that bill.");
    }
  });

export const listBusinessPortfolio = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      return await sql<{ id: string; name: string; role: string; cash: string }>`
        select p.id, p.name,
          case when p.user_id = ${context.userId} then 'owner' else coalesce(bm.role, 'member') end as role,
          coalesce((
            select sum(l.debit - l.credit)
            from journal_lines l
            join journal_entries e on e.id = l.entry_id
            join ledger_accounts a on a.id = l.account_id
            join businesses b on b.id = e.business_id
            where b.project_id = p.id and a.code in ('1000', '1010', '1020') and e.environment = 'live'
          ), 0)::text as cash
        from projects p
        left join businesses b on b.project_id = p.id
        left join biz_members bm on bm.business_id = b.id and bm.user_id = ${context.userId} and bm.status = 'active'
        where p.project_type = 'business'
          and (p.user_id = ${context.userId} or bm.id is not null)
        order by p.created_at desc
      `;
    } catch (err) {
      publicError(err, "Couldn't load businesses.");
    }
  });

export async function listFamilyBooks(sql: Sql, userId: string) {
  const families = await sql<{ id: string; name: string; role: string }>`
    select f.id, f.name, me.role
    from families f
    join family_people me on me.family_id = f.id and me.linked_user_id = ${userId} and me.status = 'active'
    order by f.created_at
  `;
  const books = [];
  for (const family of families) {
    const people = await sql<{ display_name: string; role: string; balance: string | null }>`
      select p.display_name, p.role, a.balance::text as balance
      from family_people p
      left join family_accounts a on a.person_id = p.id
      where p.family_id = ${family.id} and p.status = 'active'
      order by p.created_at
    `;
    const recent = await sql<{ id: string; kind: string; amount: string; entry_date: string; category: string | null; note: string | null; name: string | null }>`
      select e.id, e.kind, e.amount::text as amount, e.entry_date::text as entry_date, e.category, e.note,
             coalesce(a.name, p.display_name) as name
      from family_entries e
      left join family_accounts a on a.id = e.account_id
      left join family_people p on p.id = e.person_id
      where e.family_id = ${family.id}
      order by e.entry_date desc, e.created_at desc
      limit 6
    `;
    const total = people.reduce((sum, person) => sum + Number(person.balance || 0), 0);
    books.push({
      id: family.id,
      name: family.name,
      yourRole: family.role,
      total: total.toFixed(2),
      members: people.map((person) => ({ name: person.display_name, role: person.role, balance: person.balance || "0.00" })),
      recent,
    });
  }
  return books;
}

async function resolveFamilyBook(sql: Sql, userId: string, name: string) {
  const rows = await sql<{ id: string; name: string }>`
    select f.id, f.name
    from families f
    join family_people me on me.family_id = f.id and me.linked_user_id = ${userId} and me.status = 'active'
    order by f.created_at
  `;
  if (!name) {
    if (rows.length === 1) return rows[0]!;
    throw new Error(rows.length ? `Which family? ${rows.map((row) => row.name).join(", ")}` : "You are not in a family yet");
  }
  const key = name.trim().toLowerCase();
  const exact = rows.filter((row) => row.id === name || row.name.toLowerCase() === key);
  if (exact.length === 1) return exact[0]!;
  const fuzzy = rows.filter((row) => row.name.toLowerCase().includes(key));
  if (fuzzy.length === 1) return fuzzy[0]!;
  if (fuzzy.length > 1) throw new Error(`Multiple families match "${name}". Ask which one.`);
  throw new Error(`No family named "${name}".`);
}

function pickFamilyPerson(
  people: { id: string; display_name: string; linked_user_id: string | null; account_id: string | null; balance: string | null }[],
  userId: string,
  name: string,
) {
  const mine = people.find((person) => person.linked_user_id === userId);
  if (!name || /^(me|i|myself|main|mera|meri)$/i.test(name)) {
    if (!mine?.account_id) throw new Error("Your family account is not ready");
    return mine;
  }
  const key = name.trim().toLowerCase();
  const hit = people.find((person) => person.display_name.toLowerCase() === key)
    || people.find((person) => person.display_name.toLowerCase().includes(key));
  if (!hit?.account_id) throw new Error(`${name} is not in this family. Invite them by email.`);
  return hit;
}

export async function recordFamilyForAssistant(
  sql: Sql,
  userId: string,
  input: { family?: string; kind: "in" | "out" | "move"; amount: string; person?: string; to?: string; what?: string; date: string; confirm?: boolean },
) {
  const family = await resolveFamilyBook(sql, userId, input.family || "");
  await requireFamily(sql, userId, family.id, "record");
  const amount = money(input.amount);
  const people = await sql<{ id: string; display_name: string; linked_user_id: string | null; account_id: string | null; balance: string | null }>`
    select p.id, p.display_name, p.linked_user_id, a.id as account_id, a.balance::text as balance
    from family_people p
    left join family_accounts a on a.person_id = p.id
    where p.family_id = ${family.id} and p.status = 'active'
  `;
  const from = pickFamilyPerson(people, userId, input.person || "");
  const what = (input.what || "").trim();
  const kind = input.kind === "move" ? "transfer" : input.kind === "in" ? "contribution" : "expense";
  const recent = await sql<{ id: string }>`
    select id from family_entries
    where family_id = ${family.id}
      and kind = ${kind}
      and amount = ${amount}::numeric
      and entry_date = ${input.date}::date
      and person_id = ${from.id}
      and coalesce(note, '') = ${input.kind === "out" ? "" : what}
      and coalesce(category, '') = ${input.kind === "out" ? what : ""}
      and created_at > now() - interval '12 hours'
    limit 1
  `;
  if (recent[0] && input.kind !== "move" && !input.confirm) {
    return { family: family.name, kind: input.kind, amount, person: from.display_name, what: what || null, needsConfirm: true };
  }
  if (input.kind === "move") {
    const to = pickFamilyPerson(people, userId, input.to || "");
    if (from.account_id === to.account_id) throw new Error("Pick two different people");
    if (Number(from.balance || 0) < Number(amount)) throw new Error(`Not enough in ${from.display_name}`);
    await sql`update family_accounts set balance = balance - ${amount}::numeric where id = ${from.account_id}`;
    await sql`update family_accounts set balance = balance + ${amount}::numeric where id = ${to.account_id}`;
    await sql`
      insert into family_entries (id, family_id, kind, amount, entry_date, person_id, account_id, to_account_id, paid_from, note, created_by)
      values (
        ${crypto.randomUUID()}, ${family.id}, 'transfer', ${amount}::numeric, ${input.date}, ${from.id},
        ${from.account_id}, ${to.account_id}, 'family', ${`${from.display_name} → ${to.display_name}`}, ${userId}
      )
    `;
    return { family: family.name, kind: "move", amount, from: from.display_name, to: to.display_name };
  }
  if (input.kind === "out" && Number(from.balance || 0) < Number(amount)) throw new Error(`Not enough in ${from.display_name}`);
  const sign = input.kind === "in" ? amount : `-${amount}`;
  await sql`update family_accounts set balance = balance + ${sign}::numeric where id = ${from.account_id}`;
  await sql`
    insert into family_entries (id, family_id, kind, amount, entry_date, category, person_id, account_id, paid_from, note, created_by)
    values (
      ${crypto.randomUUID()}, ${family.id}, ${input.kind === "in" ? "contribution" : "expense"}, ${amount}::numeric, ${input.date},
      ${input.kind === "out" ? (what || null) : null}, ${from.id}, ${from.account_id}, 'family',
      ${input.kind === "in" ? (what || null) : null}, ${userId}
    )
  `;
  return { family: family.name, kind: input.kind, amount, person: from.display_name, what: what || null };
}

export async function updateFamilyForAssistant(
  sql: Sql,
  userId: string,
  input: { family?: string; match?: string; person: string; amount?: string; what?: string },
) {
  const family = await resolveFamilyBook(sql, userId, input.family || "");
  await requireFamily(sql, userId, family.id, "record");
  const people = await sql<{ id: string; display_name: string; linked_user_id: string | null; account_id: string | null; balance: string | null }>`
    select p.id, p.display_name, p.linked_user_id, a.id as account_id, a.balance::text as balance
    from family_people p
    left join family_accounts a on a.person_id = p.id
    where p.family_id = ${family.id} and p.status = 'active'
  `;
  const key = input.person.trim().toLowerCase();
  const named = people.find((person) => person.display_name.toLowerCase() === key)
    || people.find((person) => person.display_name.toLowerCase().includes(key));
  const wallets = await sql<{ id: string; name: string; person_id: string | null }>`
    select id, name, person_id from family_accounts
    where family_id = ${family.id} and name ilike ${"%" + key + "%"}
    order by created_at
    limit 1
  `;
  const wallet = wallets[0];
  const person = named?.account_id
    ? named
    : wallet
      ? {
          id: wallet.person_id || named?.id || "",
          display_name: wallet.name,
          linked_user_id: null,
          account_id: wallet.id,
          balance: null,
        }
      : null;
  if (!person?.account_id) throw new Error(`${input.person} is not in this family`);
  const match = (input.match || "").trim();
  const all = !match || /^(all|sab|everything|pura|saare|sare)$/i.test(match);
  const like = `%${match}%`;
  const rows = await sql<{ id: string; kind: string; amount: string; account_id: string | null; paid_from: string }>`
    select id, kind, amount::text as amount, account_id, paid_from
    from family_entries
    where family_id = ${family.id}
      and kind in ('contribution', 'expense')
      and (${all} or category ilike ${like} or note ilike ${like} or id = ${match})
  `;
  if (!rows.length) throw new Error(all ? "Nothing in this family to move" : `No family entry matching "${match}"`);
  const nextAmount = !all && rows.length === 1 && input.amount ? money(input.amount) : null;
  const nextTitle = !all && rows.length === 1 ? (input.what || "").trim() : "";
  for (const row of rows) {
    const amount = nextAmount || row.amount;
    if (row.paid_from === "family" && row.account_id && row.account_id !== person.account_id) {
      const sign = row.kind === "contribution" ? row.amount : `-${row.amount}`;
      await sql`update family_accounts set balance = balance - ${sign}::numeric where id = ${row.account_id}`;
      await sql`update family_accounts set balance = balance + ${sign}::numeric where id = ${person.account_id}`;
    }
    if (nextAmount && nextAmount !== row.amount && row.paid_from === "family" && person.account_id) {
      const delta = row.kind === "contribution"
        ? Number(nextAmount) - Number(row.amount)
        : Number(row.amount) - Number(nextAmount);
      await sql`update family_accounts set balance = balance + ${delta}::numeric where id = ${person.account_id}`;
    }
    await sql`
      update family_entries set
        person_id = ${person.id || null},
        account_id = ${person.account_id},
        amount = ${amount}::numeric,
        category = case when ${row.kind} = 'expense' and ${nextTitle} <> '' then ${nextTitle} else category end,
        note = case when ${row.kind} = 'contribution' and ${nextTitle} <> '' then ${nextTitle} else note end
      where id = ${row.id}
    `;
  }
  return { family: family.name, person: person.display_name, updated: rows.length };
}

export async function splitFamilyForAssistant(
  sql: Sql,
  userId: string,
  input: { family?: string; what: string; date: string; parts: { person?: string; amount?: string }[] },
) {
  const family = await resolveFamilyBook(sql, userId, input.family || "");
  await requireFamily(sql, userId, family.id, "record");
  const people = await sql<{ id: string; display_name: string; linked_user_id: string | null; account_id: string | null }>`
    select p.id, p.display_name, p.linked_user_id, a.id as account_id
    from family_people p
    left join family_accounts a on a.person_id = p.id
    where p.family_id = ${family.id} and p.status = 'active'
  `;
  const wallets = await sql<{ id: string; name: string; person_id: string | null }>`
    select id, name, person_id from family_accounts where family_id = ${family.id}
  `;
  const parts = input.parts.map((part) => {
    const key = (part.person || "").trim().toLowerCase();
    const mine = !key || /^(me|i|myself|main|mera|meri)$/i.test(key);
    const person = mine
      ? people.find((row) => row.linked_user_id === userId)
      : people.find((row) => row.display_name.toLowerCase() === key) || people.find((row) => row.display_name.toLowerCase().includes(key));
    const wallet = person?.account_id
      ? wallets.find((row) => row.id === person.account_id)
      : wallets.find((row) => row.name.toLowerCase().includes(key));
    if (!wallet) throw new Error(`${part.person || "That person"} is not in this family`);
    return { accountId: wallet.id, amount: money(part.amount || "") };
  });
  if (parts.length < 2) throw new Error("Say how much from each person");
  const category = input.what.trim();
  if (!category) throw new Error("Say what it was");
  const accounts = [];
  for (const part of parts) {
    const account = await familyAccount(sql, family.id, part.accountId);
    if (Number(account.balance) < Number(part.amount)) throw new Error(`Not enough in ${account.name}`);
    accounts.push(account);
  }
  const splitId = crypto.randomUUID();
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    const account = accounts[i]!;
    await sql`update family_accounts set balance = balance - ${part.amount}::numeric where id = ${part.accountId}`;
    await sql`
      insert into family_entries (
        id, family_id, kind, amount, entry_date, category, person_id, account_id, paid_from, split_id, created_by
      ) values (
        ${crypto.randomUUID()}, ${family.id}, 'expense', ${part.amount}::numeric, ${input.date}, ${category},
        ${account.person_id}, ${part.accountId}, 'family', ${splitId}, ${userId}
      )
    `;
  }
  const total = parts.reduce((sum, part) => sum + Number(part.amount), 0).toFixed(2);
  return { family: family.name, what: category, total, parts: parts.length };
}
