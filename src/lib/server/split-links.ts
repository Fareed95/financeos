import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { ensureUser } from "@/lib/server/ensure";
import { allocateSplits, type SplitMethod } from "@/lib/split";
import { publicError } from "@/lib/utils";

export type ShareLink = {
  name: string;
  email: string | null;
  url: string;
  allocated: string;
  mailed: boolean;
};

export type OpenPartInput = {
  userId?: string | null;
  name: string;
  email?: string | null;
  value?: string | null;
};

type StoredPart = {
  userId: string | null;
  name: string;
  email: string | null;
  value: string;
  allocated: string;
  status: "pending" | "accepted";
};

async function hashToken(token: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

async function newToken() {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(24).toString("base64url");
}

export function safeOrigin(input: string | undefined | null): string {
  if (!input) return "";
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function cleanName(raw: string) {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) throw new Error("Name the person you're splitting with");
  return name;
}

function cleanEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? "").trim().toLowerCase();
  if (!email) return null;
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email");
  }
  return email;
}

export function planOpenParts(
  amount: string,
  method: SplitMethod,
  payerId: string,
  parts: OpenPartInput[],
): StoredPart[] {
  if (method !== "equal" && method !== "exact" && method !== "percentage" && method !== "shares") {
    throw new Error("Choose equal, amount, or percentage");
  }
  const cleaned = parts.map((part, index) => {
    const userId = part.userId?.trim() || null;
    const name = userId === payerId ? cleanName(part.name || "You") : cleanName(part.name || "");
    return {
      key: userId || `guest-${index}`,
      userId,
      name,
      email: cleanEmail(part.email),
      value: method === "equal" ? "1" : (part.value ?? "").trim() || "0",
    };
  });
  if (!cleaned.some((part) => part.userId === payerId)) throw new Error("Include yourself in the split");
  if (cleaned.length < 2) throw new Error("Add at least one person to split with");
  const keys = new Set<string>();
  for (const part of cleaned) {
    if (keys.has(part.key)) throw new Error("That person is already in the split");
    keys.add(part.key);
  }
  const allocations = allocateSplits(
    amount,
    method,
    cleaned.map((part) => ({ userId: part.key, value: part.value })),
  );
  return cleaned.map((part) => {
    const row = allocations.find((item) => item.userId === part.key);
    return {
      userId: part.userId,
      name: part.name,
      email: part.email,
      value: part.value,
      allocated: row?.allocated ?? "0.00",
      status: part.userId ? "accepted" : "pending",
    };
  });
}

async function trySendEmail(to: string, fromName: string, description: string, share: string, url: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "Kharcha <onboarding@resend.dev>",
        to: [to],
        subject: `${fromName} split a bill with you`,
        text: `${fromName} split ${description || "a bill"} with you. Your share is ${share}.\n\n${url}\n`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function payerName(sql: Sql, userId: string) {
  const rows = await sql<{ full_name: string | null; name: string | null }>`
    select p.full_name, u.name
    from profiles p
    left join "user" u on u.id = p.id
    where p.id = ${userId}
  `;
  return rows[0]?.full_name || rows[0]?.name || "Someone";
}

export async function clearSplitLinks(sql: Sql, transactionId: string, ownerId: string) {
  await sql`
    delete from split_links
    where transaction_id = ${transactionId}
      and exists (
        select 1 from transactions t
        where t.id = ${transactionId} and t.user_id = ${ownerId}
      )
  `;
}

export async function saveSplitLinks(
  sql: Sql,
  ownerId: string,
  transactionId: string,
  method: SplitMethod,
  parts: StoredPart[],
  origin: string | undefined,
  description: string | null,
): Promise<ShareLink[]> {
  const owned = await sql<{ id: string }>`
    select id from transactions where id = ${transactionId} and user_id = ${ownerId}
  `;
  if (!owned[0]) throw new Error("Transaction not found");
  const fromName = await payerName(sql, ownerId);
  const resolved: StoredPart[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    let userId = part.userId;
    let status = part.status;
    if (!userId && part.email) {
      const found = await sql<{ id: string }>`
        select id from "user" where lower(email) = ${part.email} limit 1
      `;
      if (found[0]) {
        userId = found[0].id;
        status = "accepted";
      }
    }
    if (userId) {
      if (seen.has(userId)) throw new Error("That person is already in the split");
      seen.add(userId);
    }
    resolved.push({ ...part, userId, status });
  }
  await sql`delete from split_links where transaction_id = ${transactionId}`;
  const base = safeOrigin(origin);
  const links: ShareLink[] = [];
  for (const part of resolved) {
    const token = await newToken();
    const accepted = part.status === "accepted" && Boolean(part.userId);
    await sql`
      insert into split_links (
        id, transaction_id, user_id, display_name, email, split_method, share_value,
        allocated_amount, token_hash, invited_by, expires_at, status, accepted_by, accepted_at
      ) values (
        ${crypto.randomUUID()}, ${transactionId}, ${part.userId}, ${part.name}, ${part.email},
        ${method}, ${part.value}::numeric, ${part.allocated}::numeric, ${await hashToken(token)},
        ${ownerId}, now() + interval '30 days', ${accepted ? "accepted" : "pending"},
        ${accepted ? part.userId : null},
        ${accepted ? new Date().toISOString() : null}
      )
    `;
    if (part.userId === ownerId) continue;
    const path = `/split/${token}`;
    const url = base ? `${base}${path}` : path;
    let mailed = false;
    if (part.email && url.startsWith("http")) {
      mailed = await trySendEmail(part.email, fromName, description || "a bill", part.allocated, url);
    }
    links.push({ name: part.name, email: part.email, url, allocated: part.allocated, mailed });
  }
  return links;
}

export const getTxnSplit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { transactionId: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const owned = await sql<{ id: string }>`
        select id from transactions where id = ${data.transactionId} and user_id = ${context.userId}
      `;
      if (!owned[0]) return { mode: "off" as const, method: "equal" as const, visibility: "personal" as const, parts: [] };
      const splits = await sql<{ user_id: string }>`
        select user_id from expense_splits where transaction_id = ${data.transactionId}
      `;
      const links = await sql<{
        user_id: string | null;
        display_name: string;
        email: string | null;
        split_method: SplitMethod;
        share_value: string;
        status: string;
      }>`
        select user_id, display_name, email, split_method, share_value::text as share_value, status
        from split_links
        where transaction_id = ${data.transactionId}
        order by created_at asc
      `;
      const txn = await sql<{ visibility: string }>`
        select visibility from transactions where id = ${data.transactionId}
      `;
      const visibility = txn[0]?.visibility === "private" ? "private" : txn[0]?.visibility === "shared" ? "shared" : "personal";
      if (links.length === 0 && splits.length === 0) {
        return { mode: "off" as const, method: "equal" as const, visibility, parts: [] };
      }
      if (splits.length > 0 && links.every((link) => link.user_id)) {
        const method = links[0]?.split_method ?? "equal";
        const parts = links.length
          ? links.map((link) => ({
              userId: link.user_id,
              name: link.display_name,
              email: link.email ?? "",
              value: link.share_value,
            }))
          : splits.map((row) => ({ userId: row.user_id, name: "", email: "", value: "1" }));
        return { mode: "group" as const, method, visibility, parts };
      }
      return {
        mode: "open" as const,
        method: links[0]?.split_method ?? "equal",
        visibility: "personal" as const,
        parts: links.map((link) => ({
          userId: link.user_id,
          name: link.display_name,
          email: link.email ?? "",
          value: link.share_value,
        })),
      };
    } catch (err) {
      publicError(err, "Couldn't load that split.");
    }
  });

export const previewSplit = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    try {
      const token = (data.token || "").trim();
      if (token.length < 16 || token.length > 80) throw new Error("This link is not valid");
      const sql = await getSql();
      const rows = await sql<{
        id: string;
        display_name: string;
        allocated_amount: string;
        status: string;
        expires_at: string;
        invited_by: string;
        user_id: string | null;
        description: string | null;
        total: string;
        payer_name: string | null;
      }>`
        select l.id, l.display_name, l.allocated_amount::text as allocated_amount, l.status,
               l.expires_at::text as expires_at, l.invited_by, l.user_id,
               t.description, t.amount::text as total,
               coalesce(p.full_name, u.name, 'Someone') as payer_name
        from split_links l
        join transactions t on t.id = l.transaction_id
        left join profiles p on p.id = l.invited_by
        left join "user" u on u.id = l.invited_by
        where l.token_hash = ${await hashToken(token)}
      `;
      const row = rows[0];
      if (!row) throw new Error("This split link is not valid");
      const expired = new Date(row.expires_at).getTime() < Date.now();
      return {
        payerName: row.payer_name || "Someone",
        description: row.description,
        total: row.total,
        yourName: row.display_name,
        yourShare: row.allocated_amount,
        status: expired && row.status === "pending" ? "expired" : row.status,
      };
    } catch (err) {
      publicError(err, "Couldn't open that split.");
    }
  });

export const acceptSplit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { token: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const token = (data.token || "").trim();
      if (token.length < 16 || token.length > 80) throw new Error("This link is not valid");
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{
        id: string;
        status: string;
        user_id: string | null;
        invited_by: string;
        expires_at: string;
      }>`
        select id, status, user_id, invited_by, expires_at::text as expires_at
        from split_links
        where token_hash = ${await hashToken(token)}
      `;
      const row = rows[0];
      if (!row) throw new Error("This split link is not valid");
      if (row.invited_by === context.userId) return { ok: true, already: true };
      if (row.user_id && row.user_id !== context.userId) throw new Error("This split was sent to someone else");
      if (row.status === "settled") return { ok: true, already: true };
      if (new Date(row.expires_at).getTime() < Date.now() && row.status === "pending") {
        throw new Error("This link has expired");
      }
      await sql`
        update split_links
        set user_id = ${context.userId},
            accepted_by = ${context.userId},
            accepted_at = now(),
            status = 'accepted'
        where id = ${row.id}
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't accept that split.");
    }
  });

export const listMySplits = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{
        id: string;
        direction: "out" | "in";
        name: string;
        amount: string;
        description: string | null;
        status: string;
      }>`
        select l.id, 'out' as direction, l.display_name as name,
               l.allocated_amount::text as amount, t.description, l.status
        from split_links l
        join transactions t on t.id = l.transaction_id
        where l.invited_by = ${context.userId}
          and (l.user_id is null or l.user_id <> l.invited_by)
          and l.status <> 'settled'
          and t.user_id = ${context.userId}
        union all
        select l.id, 'in' as direction, coalesce(p.full_name, u.name, 'Someone') as name,
               l.allocated_amount::text as amount, t.description, l.status
        from split_links l
        join transactions t on t.id = l.transaction_id
        left join profiles p on p.id = l.invited_by
        left join "user" u on u.id = l.invited_by
        where (l.user_id = ${context.userId} or l.accepted_by = ${context.userId})
          and l.invited_by <> ${context.userId}
          and l.status <> 'settled'
        order by direction desc, name asc
      `;
      return rows;
    } catch (err) {
      publicError(err, "Couldn't load splits.");
    }
  });

export const markSplitSettled = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ id: string }>`
        update split_links
        set status = 'settled'
        where id = ${data.id}
          and status <> 'settled'
          and (
            invited_by = ${context.userId}
            or user_id = ${context.userId}
            or accepted_by = ${context.userId}
          )
        returning id
      `;
      if (!rows[0]) throw new Error("Split not found");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't mark that as paid.");
    }
  });
