import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser, ownedCategory, ownedProject } from "@/lib/server/ensure";
import { mapProject, mapTxn, PROJECT_FROM, PROJECT_SELECT, TXN_FROM, TXN_SELECT } from "@/lib/server/map";
import { cmpMoney, divideMoney, parseMoney } from "@/lib/money";
import { daysBetween, eachDayISO, publicError, todayISO } from "@/lib/utils";
import type { DailySpend, Project, ProjectStatus, ProjectType, TripInsights } from "@/lib/types";

const TYPES = new Set(["trip", "wedding", "hackathon", "business", "personal", "other"]);
const STATUSES = new Set(["planned", "active", "completed", "archived"]);

export const listProjects = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Project[]> => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql.query<Record<string, unknown>>(
        `select ${PROJECT_SELECT} ${PROJECT_FROM}
         where p.user_id = $1
         order by case p.status when 'active' then 0 when 'planned' then 1 when 'completed' then 2 else 3 end, p.created_at desc`,
        [context.userId],
      );
      return rows.map(mapProject);
    } catch (err) {
      publicError(err, "Couldn't load projects.");
    }
  });

export const upsertProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      id?: string;
      name: string;
      description?: string | null;
      projectType: ProjectType;
      startDate?: string | null;
      endDate?: string | null;
      budget: string;
      status: ProjectStatus;
      icon?: string;
    }) => data,
  )
  .handler(async ({ context, data }): Promise<Project> => {
    try {
      const { sql } = await ensureUser(context.userId);
      const name = data.name.trim();
      if (!name) throw new Error("Give the project a name");
      if (!TYPES.has(data.projectType)) throw new Error("Choose a valid project type");
      if (!STATUSES.has(data.status)) throw new Error("Choose a valid status");
      const budget = parseMoney(data.budget || "0");
      const id = data.id ?? crypto.randomUUID();

      if (data.id) {
        const existing = await ownedProject(sql, context.userId, id);
        if (!existing) throw new Error("Project not found");
        await sql`
          update projects set
            name = ${name},
            description = ${data.description ?? null},
            project_type = ${data.projectType},
            start_date = ${data.startDate || null},
            end_date = ${data.endDate || null},
            budget = ${budget}::numeric,
            status = ${data.status},
            icon = ${data.icon ?? "folder"},
            updated_at = now()
          where id = ${id} and user_id = ${context.userId}
        `;
      } else {
        await sql`
          insert into projects (
            id, user_id, name, description, project_type, start_date, end_date, budget, status, icon
          ) values (
            ${id}, ${context.userId}, ${name}, ${data.description ?? null}, ${data.projectType},
            ${data.startDate || null}, ${data.endDate || null}, ${budget}::numeric, ${data.status},
            ${data.icon ?? "folder"}
          )
        `;
      }

      const rows = await sql.query<Record<string, unknown>>(
        `select ${PROJECT_SELECT} ${PROJECT_FROM} where p.id = $1 and p.user_id = $2`,
        [id, context.userId],
      );
      if (!rows[0]) throw new Error("Could not save project");
      return mapProject(rows[0]);
    } catch (err) {
      publicError(err, "Couldn't save that project.");
    }
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      await sql`
        update transactions set project_id = null, updated_at = now()
        where project_id = ${data.id} and user_id = ${context.userId}
      `;
      const rows = await sql<{ id: string }>`
        delete from projects where id = ${data.id} and user_id = ${context.userId} returning id
      `;
      if (!rows[0]) throw new Error("Project not found");
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't delete that project.");
    }
  });

export const getProjectDetail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; today: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const rows = await sql.query<Record<string, unknown>>(
        `select ${PROJECT_SELECT} ${PROJECT_FROM} where p.id = $1 and p.user_id = $2`,
        [data.id, context.userId],
      );
      if (!rows[0]) throw new Error("Project not found");
      const project = mapProject(rows[0]);

      const txns = await sql.query<Record<string, unknown>>(
        `select ${TXN_SELECT} ${TXN_FROM}
         where t.user_id = $1 and t.project_id = $2
         order by t.transaction_date desc, t.created_at desc
         limit 50`,
        [context.userId, data.id],
      );

      const catRows = await sql<{ category_id: string | null; name: string; icon: string; amount: string }>`
        select t.category_id, coalesce(c.name, 'Other') as name, coalesce(c.icon, 'ellipsis') as icon,
               coalesce(sum(t.amount), 0)::text as amount
        from transactions t
        left join categories c on c.id = t.category_id
        where t.user_id = ${context.userId} and t.project_id = ${data.id}
          and t.type = 'expense' and t.is_committed = true
        group by t.category_id, c.name, c.icon
        order by sum(t.amount) desc
      `;

      const dailyRows = await sql<{ date: string; expense: string; income: string }>`
        select transaction_date::text as date,
               coalesce(sum(case when type = 'expense' then amount else 0 end), 0)::text as expense,
               coalesce(sum(case when type = 'income' then amount else 0 end), 0)::text as income
        from transactions
        where user_id = ${context.userId} and project_id = ${data.id} and is_committed = true
        group by transaction_date
        order by transaction_date asc
      `;

      const todaySpendRows = await sql<{ amount: string }>`
        select coalesce(sum(amount), 0)::text as amount
        from transactions
        where user_id = ${context.userId} and project_id = ${data.id}
          and type = 'expense' and is_committed = true and is_prepaid = false
          and transaction_date = ${data.today}
      `;

      const today = data.today || todayISO();
      const end = project.endDate || today;
      const cursor = project.startDate && today < project.startDate ? project.startDate : today;
      const remainingDays = cursor > end ? 0 : Math.max(1, daysBetween(cursor, end) + 1);
      const remaining = project.remaining;
      const remainingPositive = remaining.startsWith("-") ? "0.00" : remaining;
      const recommendedDaily = remainingDays > 0 ? divideMoney(remainingPositive, remainingDays) : remainingPositive;
      const todaySpend = todaySpendRows[0]?.amount ?? "0.00";
      const tripDays = project.startDate && project.endDate
        ? Math.max(1, daysBetween(project.startDate, project.endDate) + 1)
        : 1;
      const averageDaily = divideMoney(project.duringTrip, tripDays);

      const insights: TripInsights = {
        budget: project.budget,
        totalCost: project.totalCost,
        prepaid: project.prepaid,
        duringTrip: project.duringTrip,
        remaining,
        contributions: project.contributions,
        netCost: project.netCost,
        todaySpend,
        averageDaily,
        remainingDays,
        recommendedDaily,
        overDaily: remainingDays > 0 && cmpMoney(todaySpend, recommendedDaily) > 0,
        categoryBreakdown: catRows.map((r) => ({
          categoryId: r.category_id,
          name: r.name,
          icon: r.icon,
          amount: r.amount,
        })),
        daily: fillTripDays(project.startDate, project.endDate, today, dailyRows),
      };

      const projectBudgets = await sql<Record<string, unknown>>`
        select pb.id, pb.project_id, pb.category_id, c.name as category_name,
               pb.amount::text as amount,
               coalesce((
                 select sum(t.amount) from transactions t
                 where t.project_id = pb.project_id and t.user_id = pb.user_id
                   and t.type = 'expense' and t.is_committed = true
                   and (pb.category_id is null or t.category_id = pb.category_id)
               ), 0)::text as spent
        from project_budgets pb
        left join categories c on c.id = pb.category_id
        where pb.user_id = ${context.userId} and pb.project_id = ${data.id}
      `;

      return {
        project,
        transactions: txns.map(mapTxn),
        insights,
        projectBudgets: projectBudgets.map((r) => ({
          id: String(r.id),
          projectId: String(r.project_id),
          categoryId: r.category_id ? String(r.category_id) : null,
          categoryName: r.category_name ? String(r.category_name) : null,
          amount: String(r.amount),
          spent: String(r.spent),
        })),
      };
    } catch (err) {
      publicError(err, "Couldn't load that project.");
    }
  });

export const upsertProjectBudget = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id?: string; projectId: string; categoryId?: string | null; amount: string }) => data)
  .handler(async ({ context, data }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const proj = await ownedProject(sql, context.userId, data.projectId);
      if (!proj) throw new Error("Project not found");
      if (data.categoryId) {
        const cat = await ownedCategory(sql, context.userId, data.categoryId);
        if (!cat) throw new Error("Category not found");
      }
      const amount = parseMoney(data.amount);
      const id = data.id ?? crypto.randomUUID();
      if (data.id) {
        await sql`
          update project_budgets set amount = ${amount}::numeric, category_id = ${data.categoryId ?? null}
          where id = ${id} and user_id = ${context.userId}
        `;
      } else {
        await sql`
          insert into project_budgets (id, user_id, project_id, category_id, amount)
          values (${id}, ${context.userId}, ${data.projectId}, ${data.categoryId ?? null}, ${amount}::numeric)
        `;
      }
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't save that project budget.");
    }
  });

function fillTripDays(
  startDate: string | null,
  endDate: string | null,
  today: string,
  rows: Array<{ date: string; expense: string; income: string }>,
): DailySpend[] {
  const mapped: DailySpend[] = rows.map((r) => ({
    date: r.date.slice(0, 10),
    expense: r.expense,
    income: r.income,
  }));
  const byDate = new Map(mapped.map((r) => [r.date, r]));
  const start = startDate || mapped[0]?.date;
  if (!start) return mapped;
  const last = endDate && endDate < today ? endDate : today;
  if (start > last) return mapped;
  const window = eachDayISO(start, last, 62);
  const days = window.length > 21 ? window.slice(-21) : window;
  return days.map((date) => byDate.get(date) ?? { date, expense: "0.00", income: "0.00" });
}
