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
      const family = await sql<{ id: string; name: string }>`select id, name from families where id = ${data.familyId}`;
      const people = await sql<{ id: string; display_name: string; role: string; linked_user_id: string | null }>`
        select id, display_name, role, linked_user_id from family_people
        where family_id = ${data.familyId} and status = 'active' order by created_at
      `;
      const accounts = await sql<{ id: string; name: string; kind: string; balance: string }>`
        select id, name, kind, balance::text as balance from family_accounts where family_id = ${data.familyId} order by created_at
      `;
      const entries = await sql<{
        id: string; kind: string; amount: string; entry_date: string; category: string | null;
        person_id: string | null; paid_from: string; reimburse: boolean; note: string | null; display_name: string | null;
      }>`
        select e.id, e.kind, e.amount::text as amount, e.entry_date::text as entry_date, e.category,
               e.person_id, e.paid_from, e.reimburse, e.note, p.display_name
        from family_entries e
        left join family_people p on p.id = e.person_id
        where e.family_id = ${data.familyId}
        order by e.entry_date desc, e.created_at desc
        limit 80
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
        ? await sql<{ id: string; email: string | null; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }>`
            select id, email, role, expires_at::text as expires_at, accepted_at::text as accepted_at, revoked_at::text as revoked_at
            from family_invites where family_id = ${data.familyId} order by created_at desc
          `
        : [];
      return {
        family: family[0],
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
          ...invite,
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
      await sql`
        insert into family_people (id, family_id, display_name, role, status)
        values (${crypto.randomUUID()}, ${data.familyId}, ${name}, ${role}, 'active')
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't add that person.");
    }
  });

export const inviteFamilyMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { familyId: string; role: string; email?: string; personId?: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await requireFamily(sql, context.userId, data.familyId, "manage_people");
      const role = assertFamilyInviteRole(data.role);
      const token = await newToken();
      const id = crypto.randomUUID();
      await sql`
        insert into family_invites (id, family_id, person_id, email, role, token_hash, invited_by, expires_at)
        values (${id}, ${data.familyId}, ${data.personId || null}, ${data.email?.trim() || null}, ${role}, ${await hashToken(token)}, ${context.userId}, now() + interval '7 days')
      `;
      return { path: `/invite/${token}` };
    } catch (err) {
      publicError(err, "Couldn't create that invite.");
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
  if (existing[0]) return { projectId: invite.family_id, family: true as const };
  const state = familyInviteView({
    revokedAt: invite.revoked_at,
    acceptedAt: invite.accepted_at,
    expiresAt: invite.expires_at,
    now: Date.now(),
  });
  claimFamilyInvite(state);
  const claimed = await sql<{ id: string }>`
    update family_invites set accepted_at = now(), accepted_by = ${userId}
    where id = ${invite.id} and accepted_at is null and revoked_at is null and expires_at > now()
    returning id
  `;
  if (!claimed[0]) throw new Error("This invite was already used");
  const profile = await sql<{ full_name: string | null }>`select full_name from profiles where id = ${userId}`;
  if (invite.person_id) {
    const linked = await sql<{ id: string }>`
      update family_people set linked_user_id = ${userId}, role = ${invite.role}
      where id = ${invite.person_id} and family_id = ${invite.family_id} and linked_user_id is null
      returning id
    `;
    if (linked[0]) return { projectId: invite.family_id, family: true as const };
  }
  await sql`
    insert into family_people (id, family_id, display_name, linked_user_id, role, status)
    values (${crypto.randomUUID()}, ${invite.family_id}, ${profile[0]?.full_name || "Family member"}, ${userId}, ${invite.role}, 'active')
  `;
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
      await sql`
        insert into family_accounts (id, family_id, name, kind, balance)
        values (${crypto.randomUUID()}, ${data.familyId}, ${name}, ${kind}, ${balance}::numeric)
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't add that account.");
    }
  });

async function familyAccount(sql: Sql, familyId: string, accountId: string) {
  const rows = await sql<{ id: string; balance: string }>`
    select id, balance::text as balance from family_accounts where id = ${accountId} and family_id = ${familyId}
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
      if (data.personId) {
        const person = await sql<{ id: string }>`select id from family_people where id = ${data.personId} and family_id = ${data.familyId}`;
        if (!person[0]) throw new Error("That person is not in this family");
      }
      if (data.accountId) await familyAccount(sql, data.familyId, data.accountId);
      if ((data.kind === "contribution" || paidFrom === "family") && data.accountId) {
        const account = await familyAccount(sql, data.familyId, data.accountId);
        if (data.kind === "expense" && Number(account.balance) < Number(amount)) throw new Error("Family money is short");
        const sign = data.kind === "contribution" ? amount : `-${amount}`;
        await sql`update family_accounts set balance = balance + ${sign}::numeric where id = ${data.accountId}`;
      }
      if (data.kind === "expense" && paidFrom === "family" && !data.accountId) throw new Error("Choose the family account that paid");
      const id = crypto.randomUUID();
      await sql`
        insert into family_entries (id, family_id, kind, amount, entry_date, category, person_id, account_id, paid_from, reimburse, note, created_by)
        values (
          ${id}, ${data.familyId}, ${data.kind}, ${amount}::numeric, ${data.date}, ${data.category?.trim() || null},
          ${data.personId || null}, ${data.accountId || null}, ${paidFrom}, ${reimburse}, ${data.note?.trim() || null}, ${context.userId}
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
