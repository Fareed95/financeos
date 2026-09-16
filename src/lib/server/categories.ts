import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser } from "@/lib/server/ensure";
import { mapCategory } from "@/lib/server/map";
import { publicError } from "@/lib/utils";
import type { Category, CategoryType } from "@/lib/types";

export const upsertCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id?: string; name: string; icon: string; type: CategoryType }) => data)
  .handler(async ({ context, data }): Promise<Category> => {
    try {
      const { sql } = await ensureUser(context.userId);
      const name = data.name.trim();
      if (!name) throw new Error("Give the category a name");
      if (data.type !== "expense" && data.type !== "income") throw new Error("Choose expense or income");
      const id = data.id ?? crypto.randomUUID();
      if (data.id) {
        const existing = await sql<{ id: string }>`
          select id from categories where id = ${id} and user_id = ${context.userId}
        `;
        if (!existing[0]) throw new Error("Category not found");
        await sql`
          update categories set name = ${name}, icon = ${data.icon || "circle"}, type = ${data.type}
          where id = ${id} and user_id = ${context.userId}
        `;
      } else {
        await sql`
          insert into categories (id, user_id, name, icon, type, is_active, is_default)
          values (${id}, ${context.userId}, ${name}, ${data.icon || "circle"}, ${data.type}, true, false)
        `;
      }
      const rows = await sql<Record<string, unknown>>`
        select id, name, icon, type, is_active, is_default
        from categories where id = ${id} and user_id = ${context.userId}
      `;
      if (!rows[0]) throw new Error("Could not save category");
      return mapCategory(rows[0]);
    } catch (err) {
      publicError(err, "Couldn't save that category.");
    }
  });

export const toggleCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; isActive: boolean }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql<{ id: string }>`
        update categories set is_active = ${data.isActive}
        where id = ${data.id} and user_id = ${context.userId}
        returning id
      `;
      if (!rows[0]) throw new Error("Category not found");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't update that category.");
    }
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const used = await sql<{ n: number }>`
        select count(*)::int as n from transactions
        where user_id = ${context.userId} and category_id = ${data.id}
      `;
      if ((used[0]?.n ?? 0) > 0) {
        throw new Error("This category is used on transactions. Hide it instead of deleting.");
      }
      const rows = await sql<{ id: string }>`
        delete from categories where id = ${data.id} and user_id = ${context.userId} returning id
      `;
      if (!rows[0]) throw new Error("Category not found");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't delete that category.");
    }
  });
