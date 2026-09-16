import { getSql, type Sql } from "@/lib/db";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { mapProfile } from "@/lib/server/map";
import type { Profile } from "@/lib/types";

export async function ensureUser(
  userId: string,
  displayName?: string | null,
): Promise<{ sql: Sql; profile: Profile }> {
  const sql = await getSql();
  await sql`
    insert into profiles (id, full_name, currency, theme, onboarding_completed)
    values (${userId}, ${displayName ?? null}, 'INR', 'system', false)
    on conflict (id) do nothing
  `;

  const count = await sql<{ n: number }>`
    select count(*)::int as n from categories where user_id = ${userId}
  `;
  if ((count[0]?.n ?? 0) === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await sql`
        insert into categories (id, user_id, name, icon, type, is_active, is_default)
        values (${crypto.randomUUID()}, ${userId}, ${c.name}, ${c.icon}, ${c.type}, true, true)
      `;
    }
  }

  if (displayName) {
    await sql`
      update profiles
      set full_name = coalesce(full_name, ${displayName}),
          updated_at = now()
      where id = ${userId} and (full_name is null or full_name = '')
    `;
  }

  const rows = await sql<Record<string, unknown>>`
    select id, full_name, avatar_url, currency, theme, onboarding_completed
    from profiles where id = ${userId}
  `;
  const row = rows[0];
  if (!row) throw new Error("Could not load your profile");
  return { sql, profile: mapProfile(row) };
}

export async function ownedAccount(sql: Sql, userId: string, accountId: string) {
  const rows = await sql<{ id: string }>`
    select id from accounts where id = ${accountId} and user_id = ${userId}
  `;
  return rows[0] ?? null;
}

export async function ownedCategory(sql: Sql, userId: string, categoryId: string) {
  const rows = await sql<{ id: string }>`
    select id from categories where id = ${categoryId} and user_id = ${userId}
  `;
  return rows[0] ?? null;
}

export async function ownedProject(sql: Sql, userId: string, projectId: string) {
  const rows = await sql<{ id: string }>`
    select id from projects where id = ${projectId} and user_id = ${userId}
  `;
  return rows[0] ?? null;
}
