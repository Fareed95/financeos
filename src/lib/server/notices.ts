import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { ensureUser } from "@/lib/server/ensure";
import { publicError } from "@/lib/utils";

type WebPush = {
  generateVAPIDKeys: () => { publicKey: string; privateKey: string };
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ) => Promise<unknown>;
};

async function webPush(): Promise<WebPush> {
  const mod = (await import("web-push")) as { default?: WebPush } & WebPush;
  return mod.default ?? mod;
}

async function vapidKeys(sql: Sql) {
  const rows = await sql<{ key: string; value: string }>`
    select key, value from app_kv where key in ('vapid_public', 'vapid_private')
  `;
  const found = new Map(rows.map((row) => [row.key, row.value]));
  if (found.get("vapid_public") && found.get("vapid_private")) {
    return { publicKey: found.get("vapid_public")!, privateKey: found.get("vapid_private")! };
  }
  const keys = (await webPush()).generateVAPIDKeys();
  await sql`
    insert into app_kv (key, value) values ('vapid_public', ${keys.publicKey})
    on conflict (key) do nothing
  `;
  await sql`
    insert into app_kv (key, value) values ('vapid_private', ${keys.privateKey})
    on conflict (key) do nothing
  `;
  const again = await sql<{ key: string; value: string }>`
    select key, value from app_kv where key in ('vapid_public', 'vapid_private')
  `;
  const saved = new Map(again.map((row) => [row.key, row.value]));
  return {
    publicKey: saved.get("vapid_public") || keys.publicKey,
    privateKey: saved.get("vapid_private") || keys.privateKey,
  };
}

async function pushToUser(
  sql: Sql,
  userId: string,
  payload: { title: string; body: string; url: string; tag: string },
) {
  let sent = false;
  try {
    const keys = await vapidKeys(sql);
    const client = await webPush();
    client.setVapidDetails("mailto:notifications@kharcha.app", keys.publicKey, keys.privateKey);
    const subs = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }>`
      select id, endpoint, p256dh, auth from push_subscriptions where user_id = ${userId}
    `;
    for (const sub of subs) {
      try {
        await client.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        sent = true;
      } catch (err) {
        const status =
          typeof err === "object" && err && "statusCode" in err ? Number((err as { statusCode: number }).statusCode) : 0;
        if (status === 404 || status === 410) {
          await sql`delete from push_subscriptions where id = ${sub.id}`;
        }
      }
    }
  } catch {
    return false;
  }
  return sent;
}

/** Tell the other people on a shared project. Personal projects stay quiet. */
export async function notifyProjectActivity(
  sql: Sql,
  input: {
    projectId: string;
    actorId: string;
    kind: "expense" | "income" | "settled";
    amount: string;
    description?: string | null;
  },
) {
  const projects = await sql<{ name: string; collaboration: string }>`
    select name, collaboration from projects where id = ${input.projectId}
  `;
  const project = projects[0];
  if (!project || project.collaboration !== "collaborative") return;
  const names = await sql<{ full_name: string | null }>`
    select full_name from profiles where id = ${input.actorId}
  `;
  const actor = names[0]?.full_name?.trim() || "Someone";
  const members = await sql<{ user_id: string }>`
    select user_id from project_members
    where project_id = ${input.projectId} and status = 'active' and user_id <> ${input.actorId}
    union
    select user_id from projects
    where id = ${input.projectId} and user_id <> ${input.actorId}
  `;
  if (members.length === 0) return;
  const money = formatMoney(input.amount);
  const what = input.description?.trim();
  const body =
    input.kind === "settled"
      ? `${actor} settled ${money}${what ? ` · ${what}` : ""}`
      : `${actor} added ${what ? `${what} · ` : ""}${money}`;
  const href = `/projects/${input.projectId}`;
  for (const member of members) {
    const id = crypto.randomUUID();
    await sql`
      insert into member_notices (id, user_id, project_id, title, body, href)
      values (${id}, ${member.user_id}, ${input.projectId}, ${project.name}, ${body}, ${href})
    `;
    const sent = await pushToUser(sql, member.user_id, { title: project.name, body, url: href, tag: id });
    if (sent) await sql`update member_notices set seen_at = now() where id = ${id}`;
  }
}

export const listUnseenNotices = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const notices = await sql<{ id: string; title: string; body: string; href: string }>`
        select id, title, body, href from member_notices
        where user_id = ${context.userId} and seen_at is null
        order by created_at asc
        limit 20
      `;
      return { notices };
    } catch (err) {
      publicError(err, "Couldn't load notifications.");
    }
  });

export const markNoticesSeen = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { ids: string[] }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      for (const id of (data.ids ?? []).slice(0, 20)) {
        await sql`
          update member_notices set seen_at = now()
          where id = ${id} and user_id = ${context.userId} and seen_at is null
        `;
      }
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't update notifications.");
    }
  });

export const vapidPublicKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const keys = await vapidKeys(sql);
      return { publicKey: keys.publicKey };
    } catch (err) {
      publicError(err, "Couldn't start notifications.");
    }
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { endpoint: string; p256dh: string; auth: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const endpoint = data.endpoint?.trim();
      if (!endpoint || !data.p256dh || !data.auth) throw new Error("Missing push subscription");
      const { sql } = await ensureUser(context.userId);
      await sql`
        insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
        values (${crypto.randomUUID()}, ${context.userId}, ${endpoint}, ${data.p256dh}, ${data.auth})
        on conflict (endpoint) do update set
          user_id = ${context.userId},
          p256dh = ${data.p256dh},
          auth = ${data.auth}
      `;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't save this device.");
    }
  });
