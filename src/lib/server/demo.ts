import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUser } from "@/lib/server/ensure";
import { publicError } from "@/lib/utils";

export const loadDemoData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, profile } = await ensureUser(context.userId);
      const userId = context.userId;

      const existing = await sql<{ n: number }>`
        select count(*)::int as n from projects where user_id = ${userId} and is_demo = true
      `;
      if ((existing[0]?.n ?? 0) > 0) {
        throw new Error("Demo data is already loaded. Remove it first.");
      }

      const cats = await sql<{ id: string; name: string; type: string }>`
        select id, name, type from categories where user_id = ${userId}
      `;
      const cat = (name: string) => cats.find((c) => c.name === name)?.id ?? cats.find((c) => c.type === "expense")?.id;

      let accounts = await sql<{ id: string; name: string }>`
        select id, name from accounts where user_id = ${userId} and is_active = true
      `;

      if (!accounts.some((a) => /upi/i.test(a.name))) {
        const upiId = crypto.randomUUID();
        await sql`
          insert into accounts (id, user_id, name, type, opening_balance, currency, is_demo)
          values (${upiId}, ${userId}, 'UPI', 'upi', 12000, ${profile.currency}, true)
        `;
        accounts = [...accounts, { id: upiId, name: "UPI" }];
      }
      if (!accounts.some((a) => /bank|hdfc/i.test(a.name))) {
        const hdfcId = crypto.randomUUID();
        await sql`
          insert into accounts (id, user_id, name, type, opening_balance, currency, is_demo)
          values (${hdfcId}, ${userId}, 'HDFC Bank', 'bank', 85000, ${profile.currency}, true)
        `;
        accounts = [...accounts, { id: hdfcId, name: "HDFC Bank" }];
      }

      const upi = accounts.find((a) => /upi/i.test(a.name))?.id ?? accounts[0]!.id;
      const bank = accounts.find((a) => /bank|hdfc/i.test(a.name))?.id ?? accounts[0]!.id;

      const tripId = crypto.randomUUID();
      const crodlinId = crypto.randomUUID();
      await sql`
        insert into projects (id, user_id, name, description, project_type, start_date, end_date, budget, status, icon, is_demo)
        values
          (${tripId}, ${userId}, 'Bangalore Trip', 'Week in Bangalore — flights, stay, food.', 'trip', '2026-09-17', '2026-09-22', 20000, 'active', 'plane', true),
          (${crodlinId}, ${userId}, 'Crodlin', 'Side project expenses.', 'business', '2026-09-01', '2026-12-31', 10000, 'active', 'briefcase', true)
      `;

      const salaryCat = cat("Salary");
      const food = cat("Food");
      const travel = cat("Travel");
      const stay = cat("Accommodation");
      const transport = cat("Transport");
      const shopping = cat("Shopping");
      const bills = cat("Bills");
      const biz = cat("Business");

      const rows: Array<{
        amount: string;
        type: string;
        account: string;
        category: string | undefined;
        project: string | null;
        date: string;
        desc: string;
        prepaid: boolean;
      }> = [
        { amount: "75000", type: "income", account: bank, category: salaryCat, project: null, date: "2026-09-01", desc: "September salary", prepaid: false },
        { amount: "4500", type: "expense", account: bank, category: travel, project: tripId, date: "2026-09-10", desc: "Flight to Bangalore", prepaid: true },
        { amount: "6000", type: "expense", account: bank, category: stay, project: tripId, date: "2026-09-10", desc: "Hotel — 5 nights", prepaid: true },
        { amount: "350", type: "expense", account: upi, category: food, project: tripId, date: "2026-09-17", desc: "Breakfast", prepaid: false },
        { amount: "280", type: "expense", account: upi, category: transport, project: tripId, date: "2026-09-17", desc: "Airport cab", prepaid: false },
        { amount: "1200", type: "expense", account: upi, category: shopping, project: tripId, date: "2026-09-18", desc: "Day shopping", prepaid: false },
        { amount: "4200", type: "expense", account: bank, category: biz, project: crodlinId, date: "2026-09-05", desc: "Crodlin tools", prepaid: false },
        { amount: "2400", type: "expense", account: upi, category: bills, project: null, date: "2026-09-04", desc: "Electricity + wifi", prepaid: false },
        { amount: "890", type: "expense", account: upi, category: food, project: null, date: "2026-09-12", desc: "Groceries", prepaid: false },
        { amount: "5000", type: "transfer", account: bank, category: undefined, project: null, date: "2026-09-08", desc: "HDFC → UPI", prepaid: false },
      ];

      for (const r of rows) {
        await sql`
          insert into transactions (
            id, user_id, account_id, category_id, project_id, counterparty_account_id,
            type, amount, transaction_date, description, is_prepaid, is_committed, is_demo
          ) values (
            ${crypto.randomUUID()}, ${userId}, ${r.account}, ${r.category ?? null}, ${r.project},
            ${r.type === "transfer" ? upi : null},
            ${r.type}, ${r.amount}::numeric, ${r.date}::date, ${r.desc}, ${r.prepaid}, true, true
          )
        `;
      }

      await sql`
        insert into budgets (id, user_id, name, amount, period, start_date, end_date, is_demo)
        values (${crypto.randomUUID()}, ${userId}, 'September Budget', 40000, 'monthly', '2026-09-01', '2026-09-30', true)
      `;

      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't load demo data.");
    }
  });

export const removeDemoData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql } = await ensureUser(context.userId);
      const id = context.userId;
      await sql`delete from transactions where user_id = ${id} and is_demo = true`;
      await sql`delete from budgets where user_id = ${id} and is_demo = true`;
      await sql`delete from projects where user_id = ${id} and is_demo = true`;
      await sql`delete from accounts where user_id = ${id} and is_demo = true`;
      return { ok: true };
    } catch (err) {
      publicError(err, "Couldn't remove demo data.");
    }
  });
