import { createHash, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser, ownedAccount, ownedCategory } from "@/lib/server/ensure";
import type { Sql } from "@/lib/db";
import { fromCents, parseMoney, toCents } from "@/lib/money";
import { publicError } from "@/lib/utils";
import {
  allocateSplits,
  applyExpense,
  applySettlement,
  simplifyDebts,
  type SplitMethod,
} from "@/lib/split";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

type Role = "owner" | "member";

async function access(sql: Sql, userId: string, projectId: string) {
  const rows = await sql<{ id: string; user_id: string; collaboration: string; name: string }>`
    select id, user_id, collaboration, name from projects where id = ${projectId}
  `;
  const project = rows[0];
  if (!project) return null;
  if (project.user_id === userId) return { project, role: "owner" as Role };
  const member = await sql<{ role: string }>`
    select role from project_members
    where project_id = ${projectId} and user_id = ${userId} and status = 'active'
  `;
  if (!member[0]) return null;
  return { project, role: member[0].role === "owner" ? "owner" : ("member" as Role) };
}

async function memberIds(sql: Sql, projectId: string, ownerId: string) {
  const rows = await sql<{ user_id: string }>`
    select user_id from project_members
    where project_id = ${projectId} and status = 'active'
  `;
  const ids = new Set(rows.map((r) => r.user_id));
  ids.add(ownerId);
  return ids;
}

export async function assertNoSettledEdit(sql: Sql, transactionId: string) {
  const rows = await sql<{ project_id: string | null; visibility: string }>`
    select project_id, visibility from transactions where id = ${transactionId}
  `;
  const txn = rows[0];
  if (!txn?.project_id || txn.visibility === "personal") return;
  const settled = await sql<{ id: string }>`
    select id from settlements
    where project_id = ${txn.project_id} and status = 'completed'
    limit 1
  `;
  if (settled[0]) {
    throw new Error("This project already has a settlement. Add a new expense instead of editing this one.");
  }
}

export const listProjectMembers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const gate = await access(sql, context.userId, data.projectId);
      if (!gate) throw new Error("Project not found");
      const people = await sql<{ user_id: string; role: string; full_name: string | null }>`
        select m.user_id, m.role, p.full_name
        from project_members m
        left join profiles p on p.id = m.user_id
        where m.project_id = ${data.projectId} and m.status = 'active'
      `;
      const owner = await sql<{ id: string; full_name: string | null }>`
        select pr.id, p.full_name from projects pr
        left join profiles p on p.id = pr.user_id
        where pr.id = ${data.projectId}
      `;
      const list = people.map((p) => ({
        userId: p.user_id,
        role: p.role,
        name: p.full_name || "Member",
      }));
      if (owner[0] && !list.some((p) => p.userId === owner[0]!.id)) {
        list.unshift({ userId: owner[0].id, role: "owner", name: owner[0].full_name || "Owner" });
      }
      return { role: gate.role, members: list, collaboration: gate.project.collaboration };
    } catch (err) {
      publicError(err, "Couldn't load members.");
    }
  });

export const createProjectInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const gate = await access(sql, context.userId, data.projectId);
      if (!gate || gate.role !== "owner") throw new Error("Only the owner can invite");
      await sql`
        update projects set collaboration = 'collaborative', updated_at = now()
        where id = ${data.projectId}
      `;
      const ownerRow = await sql<{ id: string }>`
        select id from project_members
        where project_id = ${data.projectId} and user_id = ${gate.project.user_id} and status = 'active'
      `;
      if (!ownerRow[0]) {
        await sql`
          insert into project_members (id, project_id, user_id, role, status)
          values (${crypto.randomUUID()}, ${data.projectId}, ${gate.project.user_id}, 'owner', 'active')
        `;
      }
      const token = randomBytes(24).toString("base64url");
      const id = crypto.randomUUID();
      await sql`
        insert into project_invites (id, project_id, token_hash, invited_by, expires_at)
        values (
          ${id}, ${data.projectId}, ${hashToken(token)}, ${context.userId},
          now() + interval '14 days'
        )
      `;
      return { token, path: `/invite/${token}` };
    } catch (err) {
      publicError(err, "Couldn't create an invite.");
    }
  });

export const previewInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { token: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{
        id: string;
        project_id: string;
        project_name: string;
        expires_at: string;
        accepted_at: string | null;
        revoked_at: string | null;
        invited_name: string | null;
      }>`
        select i.id, i.project_id, pr.name as project_name, i.expires_at::text as expires_at,
               i.accepted_at::text as accepted_at, i.revoked_at::text as revoked_at,
               p.full_name as invited_name
        from project_invites i
        join projects pr on pr.id = i.project_id
        left join profiles p on p.id = i.invited_by
        where i.token_hash = ${hashToken(data.token)}
      `;
      const invite = rows[0];
      if (!invite) throw new Error("This invite link is not valid");
      const member = await access(sql, context.userId, invite.project_id);
      let state: "open" | "expired" | "revoked" | "used" | "member" = "open";
      if (member) state = "member";
      else if (invite.revoked_at) state = "revoked";
      else if (invite.accepted_at) state = "used";
      else if (new Date(invite.expires_at).getTime() < Date.now()) state = "expired";
      return {
        inviteId: invite.id,
        projectId: invite.project_id,
        projectName: invite.project_name,
        invitedBy: invite.invited_name || "Someone",
        state,
      };
    } catch (err) {
      publicError(err, "Couldn't open that invite.");
    }
  });

export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { token: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{
        id: string;
        project_id: string;
        expires_at: string;
        accepted_at: string | null;
        revoked_at: string | null;
        owner_id: string;
      }>`
        select i.id, i.project_id, i.expires_at::text as expires_at,
               i.accepted_at::text as accepted_at, i.revoked_at::text as revoked_at,
               pr.user_id as owner_id
        from project_invites i
        join projects pr on pr.id = i.project_id
        where i.token_hash = ${hashToken(data.token)}
      `;
      const invite = rows[0];
      if (!invite) throw new Error("This invite link is not valid");
      if (invite.owner_id === context.userId) return { projectId: invite.project_id };
      if (invite.revoked_at) throw new Error("This invite was revoked");
      if (invite.accepted_at) throw new Error("This invite was already used");
      if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error("This invite has expired");
      const existing = await sql<{ status: string }>`
        select status from project_members
        where project_id = ${invite.project_id} and user_id = ${context.userId}
        order by joined_at desc limit 1
      `;
      if (existing[0]?.status === "active") return { projectId: invite.project_id };
      if (existing[0]) {
        await sql`
          update project_members set status = 'active', role = 'member', joined_at = now()
          where project_id = ${invite.project_id} and user_id = ${context.userId}
        `;
      } else {
        await sql`
          insert into project_members (id, project_id, user_id, role, status)
          values (${crypto.randomUUID()}, ${invite.project_id}, ${context.userId}, 'member', 'active')
        `;
      }
      await sql`
        update project_invites
        set accepted_at = now(), accepted_by = ${context.userId}
        where id = ${invite.id} and accepted_at is null
      `;
      return { projectId: invite.project_id };
    } catch (err) {
      publicError(err, "Couldn't join that project.");
    }
  });

export const listProjectInvites = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const gate = await access(sql, context.userId, data.projectId);
      if (!gate || gate.role !== "owner") return { invites: [] };
      const rows = await sql<{ id: string; expires_at: string; created_at: string }>`
        select id, expires_at::text as expires_at, created_at::text as created_at
        from project_invites
        where project_id = ${data.projectId}
          and accepted_at is null
          and revoked_at is null
          and expires_at > now()
        order by created_at desc
        limit 20
      `;
      return {
        invites: rows.map((row) => ({
          id: row.id,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        })),
      };
    } catch (err) {
      publicError(err, "Couldn't load invites.");
    }
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { inviteId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ project_id: string }>`
        select project_id from project_invites where id = ${data.inviteId}
      `;
      if (!rows[0]) throw new Error("Invite not found");
      const gate = await access(sql, context.userId, rows[0].project_id);
      if (!gate || gate.role !== "owner") throw new Error("Only the owner can revoke invites");
      await sql`
        update project_invites set revoked_at = now()
        where id = ${data.inviteId} and accepted_at is null
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't revoke that invite.");
    }
  });

export const removeProjectMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; userId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const gate = await access(sql, context.userId, data.projectId);
      if (!gate || gate.role !== "owner") throw new Error("Only the owner can remove members");
      if (data.userId === gate.project.user_id) throw new Error("The owner stays on the project");
      await sql`
        update project_members set status = 'removed'
        where project_id = ${data.projectId} and user_id = ${data.userId} and status = 'active'
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't remove that member.");
    }
  });

export const leaveProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const gate = await access(sql, context.userId, data.projectId);
      if (!gate) throw new Error("Project not found");
      if (gate.role === "owner") throw new Error("Owners can't leave. Archive the project instead.");
      await sql`
        update project_members set status = 'left'
        where project_id = ${data.projectId} and user_id = ${context.userId} and status = 'active'
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't leave that project.");
    }
  });

export const addProjectExpense = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      projectId: string;
      accountId: string;
      categoryId?: string | null;
      amount: string;
      description?: string | null;
      transactionDate: string;
      visibility: "shared" | "personal" | "private";
      paidByUserId?: string;
      method?: SplitMethod;
      parts?: { userId: string; value: string }[];
    }) => data,
  )
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const gate = await access(sql, context.userId, data.projectId);
      if (!gate) throw new Error("Project not found");
      if (gate.project.collaboration !== "collaborative" && data.visibility !== "personal") {
        throw new Error("Invite someone before splitting this project");
      }
      const amount = parseMoney(data.amount);
      if (amount.startsWith("-") || amount === "0.00") throw new Error("Amount must be greater than zero");
      const account = await ownedAccount(sql, context.userId, data.accountId);
      if (!account) throw new Error("Choose a valid account");
      if (data.categoryId) {
        const cat = await ownedCategory(sql, context.userId, data.categoryId);
        if (!cat) throw new Error("Choose a valid category");
      }
      const people = await memberIds(sql, data.projectId, gate.project.user_id);
      const paidBy = data.visibility === "personal" ? context.userId : data.paidByUserId || context.userId;
      if (!people.has(paidBy)) throw new Error("Choose who paid");
      const affects = paidBy === context.userId;
      const id = crypto.randomUUID();
      let allocations: { userId: string; allocated: string }[] = [];
      if (data.visibility !== "personal") {
        const parts = (data.parts ?? []).filter((p) => p.userId);
        if (parts.some((p) => !people.has(p.userId))) throw new Error("Someone in the split isn't on this project");
        allocations = allocateSplits(amount, data.method ?? "equal", parts);
      }
      await sql`
        insert into transactions (
          id, user_id, account_id, category_id, project_id, type, amount,
          transaction_date, description, is_committed, visibility, paid_by_user_id, affects_ledger
        ) values (
          ${id}, ${context.userId}, ${data.accountId}, ${data.categoryId ?? null}, ${data.projectId},
          'expense', ${amount}::numeric, ${data.transactionDate}::date, ${data.description ?? null},
          true, ${data.visibility}, ${paidBy}, ${affects}
        )
      `;
      const method = data.method ?? "equal";
      for (const row of allocations) {
        const part = (data.parts ?? []).find((p) => p.userId === row.userId);
        await sql`
          insert into expense_splits (id, transaction_id, user_id, split_method, share_value, allocated_amount)
          values (
            ${crypto.randomUUID()}, ${id}, ${row.userId}, ${method},
            ${part?.value || "1"}::numeric, ${row.allocated}::numeric
          )
        `;
      }
      return { id };
    } catch (err) {
      publicError(err, "Couldn't add that expense.");
    }
  });

export async function loadViewerSpend(sql: Sql, projectId: string, viewerId: string) {
  const rows = await sql<{ kind: string; amount: string }>`
    select 'personal' as kind, coalesce(sum(amount), 0)::text as amount
    from transactions
    where project_id = ${projectId} and user_id = ${viewerId}
      and type = 'expense' and is_committed = true and visibility = 'personal'
    union all
    select 'shared', coalesce(sum(amount), 0)::text
    from transactions
    where project_id = ${projectId} and type = 'expense' and is_committed = true and visibility = 'shared'
    union all
    select 'paid', coalesce(sum(amount), 0)::text
    from transactions
    where project_id = ${projectId} and type = 'expense' and is_committed = true
      and visibility = 'shared' and paid_by_user_id = ${viewerId}
    union all
    select 'share', coalesce(sum(es.allocated_amount), 0)::text
    from expense_splits es
    join transactions t on t.id = es.transaction_id
    where t.project_id = ${projectId} and t.visibility = 'shared' and t.type = 'expense'
      and t.is_committed = true and es.user_id = ${viewerId}
    union all
    select 'private_share', coalesce(sum(es.allocated_amount), 0)::text
    from expense_splits es
    join transactions t on t.id = es.transaction_id
    where t.project_id = ${projectId} and t.visibility = 'private' and t.type = 'expense'
      and t.is_committed = true and es.user_id = ${viewerId}
    union all
    select 'income', coalesce(sum(t.amount), 0)::text
    from transactions t
    where t.project_id = ${projectId} and t.type = 'income' and t.is_committed = true
      and (
        (t.visibility = 'personal' and t.user_id = ${viewerId})
        or t.visibility = 'shared'
        or (
          t.visibility = 'private'
          and (
            t.user_id = ${viewerId}
            or t.paid_by_user_id = ${viewerId}
            or exists (
              select 1 from expense_splits es
              where es.transaction_id = t.id and es.user_id = ${viewerId}
            )
          )
        )
      )
  `;
  const get = (kind: string) => rows.find((row) => row.kind === kind)?.amount ?? "0.00";
  const personal = toCents(parseMoney(get("personal")));
  const share = toCents(parseMoney(get("share")));
  const priv = toCents(parseMoney(get("private_share")));
  return {
    personalSpend: fromCents(personal),
    sharedSpend: parseMoney(get("shared")),
    youPaid: parseMoney(get("paid")),
    yourShare: fromCents(share),
    mySpend: fromCents(personal + share + priv),
    myIncome: parseMoney(get("income")),
  };
}

export async function loadProjectBalances(sql: Sql, projectId: string, viewerId: string) {
  const gate = await access(sql, viewerId, projectId);
  if (!gate) throw new Error("Project not found");
  const expenses = await sql<{
    id: string;
    amount: string;
    paid_by_user_id: string | null;
    user_id: string;
    visibility: string;
  }>`
    select id, amount::text as amount, paid_by_user_id, user_id, visibility
    from transactions
    where project_id = ${projectId} and type = 'expense' and is_committed = true
      and visibility = 'shared'
  `;
  const splits = await sql<{ transaction_id: string; user_id: string; allocated_amount: string }>`
    select transaction_id, user_id, allocated_amount::text as allocated_amount
    from expense_splits
    where transaction_id in (
      select id from transactions
      where project_id = ${projectId} and visibility = 'shared' and type = 'expense'
    )
  `;
  const byTxn = new Map<string, { userId: string; allocated: string }[]>();
  for (const s of splits) {
    const list = byTxn.get(s.transaction_id) ?? [];
    list.push({ userId: s.user_id, allocated: s.allocated_amount });
    byTxn.set(s.transaction_id, list);
  }
  const nets = new Map<string, bigint>();
  let shared = 0n;
  for (const e of expenses) {
    const alloc = byTxn.get(e.id) ?? [];
    applyExpense(nets, e.paid_by_user_id || e.user_id, alloc);
    shared += BigInt(String(e.amount).replace(".", ""));
  }
  const done = await sql<{ from_user_id: string; to_user_id: string; amount: string }>`
    select from_user_id, to_user_id, amount::text as amount
    from settlements
    where project_id = ${projectId} and status = 'completed'
  `;
  for (const s of done) applySettlement(nets, s.from_user_id, s.to_user_id, s.amount);
  const plan = simplifyDebts([...nets.entries()].map(([userId, cents]) => ({ userId, cents })));
  const mine = nets.get(viewerId) ?? 0n;

  const privateExpenses = await sql<{
    id: string;
    paid_by_user_id: string | null;
    user_id: string;
  }>`
    select id, paid_by_user_id, user_id
    from transactions t
    where t.project_id = ${projectId} and t.type = 'expense' and t.is_committed = true
      and t.visibility = 'private'
      and (
        t.user_id = ${viewerId}
        or t.paid_by_user_id = ${viewerId}
        or exists (
          select 1 from expense_splits es
          where es.transaction_id = t.id and es.user_id = ${viewerId}
        )
      )
  `;
  const privateNets = new Map<string, bigint>();
  if (privateExpenses.length > 0) {
    const privateSplits = await sql<{ transaction_id: string; user_id: string; allocated_amount: string }>`
      select es.transaction_id, es.user_id, es.allocated_amount::text as allocated_amount
      from expense_splits es
      join transactions t on t.id = es.transaction_id
      where t.project_id = ${projectId} and t.visibility = 'private' and t.type = 'expense'
        and (
          t.user_id = ${viewerId}
          or t.paid_by_user_id = ${viewerId}
          or exists (
            select 1 from expense_splits mine
            where mine.transaction_id = t.id and mine.user_id = ${viewerId}
          )
        )
    `;
    const byPrivate = new Map<string, { userId: string; allocated: string }[]>();
    for (const split of privateSplits) {
      const list = byPrivate.get(split.transaction_id) ?? [];
      list.push({ userId: split.user_id, allocated: split.allocated_amount });
      byPrivate.set(split.transaction_id, list);
    }
    for (const expense of privateExpenses) {
      applyExpense(privateNets, expense.paid_by_user_id || expense.user_id, byPrivate.get(expense.id) ?? []);
    }
  }
  const privatePlan = simplifyDebts([...privateNets.entries()].map(([userId, cents]) => ({ userId, cents })));
  return { nets, plan, mine, sharedCents: shared, role: gate.role, privatePlan };
}

export const getProjectBalances = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const names = await sql<{ user_id: string; full_name: string | null }>`
        select m.user_id, p.full_name from project_members m
        left join profiles p on p.id = m.user_id
        where m.project_id = ${data.projectId} and m.status = 'active'
        union
        select pr.user_id, p.full_name from projects pr
        left join profiles p on p.id = pr.user_id
        where pr.id = ${data.projectId}
      `;
      const nameOf = new Map(names.map((n) => [n.user_id, n.full_name || "Member"]));
      const { plan, mine, privatePlan } = await loadProjectBalances(sql, data.projectId, context.userId);
      const spend = await loadViewerSpend(sql, data.projectId, context.userId);
      const history = await sql<{
        id: string;
        from_user_id: string;
        to_user_id: string;
        amount: string;
        payment_method: string;
        note: string | null;
        status: string;
        created_at: string;
      }>`
        select id, from_user_id, to_user_id, amount::text as amount, payment_method, note, status,
               created_at::text as created_at
        from settlements
        where project_id = ${data.projectId}
        order by created_at desc
        limit 30
      `;
      const { fromCents: centsToMoney } = await import("@/lib/money");
      return {
        you: centsToMoney(mine),
        spend,
        payments: plan.map((p) => ({
          ...p,
          fromName: nameOf.get(p.fromUserId) || "Member",
          toName: nameOf.get(p.toUserId) || "Member",
        })),
        privatePayments: privatePlan.map((p) => ({
          ...p,
          fromName: nameOf.get(p.fromUserId) || "Member",
          toName: nameOf.get(p.toUserId) || "Member",
        })),
        history: history.map((h) => ({
          id: h.id,
          amount: h.amount,
          method: h.payment_method,
          note: h.note,
          status: h.status,
          createdAt: h.created_at,
          fromName: nameOf.get(h.from_user_id) || "Member",
          toName: nameOf.get(h.to_user_id) || "Member",
        })),
      };
    } catch (err) {
      publicError(err, "Couldn't load balances.");
    }
  });

export const createSettlement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      projectId: string;
      fromUserId: string;
      toUserId: string;
      amount: string;
      paymentMethod?: "upi" | "cash" | "bank" | "other";
      note?: string | null;
    }) => data,
  )
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const gate = await access(sql, context.userId, data.projectId);
      if (!gate) throw new Error("Project not found");
      const people = await memberIds(sql, data.projectId, gate.project.user_id);
      if (!people.has(data.fromUserId) || !people.has(data.toUserId)) throw new Error("Pick people on this project");
      if (data.fromUserId === data.toUserId) throw new Error("Settlement needs two people");
      const amount = parseMoney(data.amount);
      if (amount.startsWith("-") || amount === "0.00") throw new Error("Amount must be greater than zero");
      const involved = data.fromUserId === context.userId || data.toUserId === context.userId || gate.role === "owner";
      if (!involved) throw new Error("You can only settle a payment you're part of");
      const id = crypto.randomUUID();
      try {
        await sql`
          insert into settlements (
            id, project_id, from_user_id, to_user_id, amount, payment_method, note,
            status, created_by, completed_at
          ) values (
            ${id}, ${data.projectId}, ${data.fromUserId}, ${data.toUserId}, ${amount}::numeric,
            ${data.paymentMethod ?? "upi"}, ${data.note ?? null}, 'completed', ${context.userId}, now()
          )
        `;
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message.includes("settlements_pending")) throw new Error("That settlement is already pending");
        throw err;
      }
      return { id };
    } catch (err) {
      publicError(err, "Couldn't record that settlement.");
    }
  });
