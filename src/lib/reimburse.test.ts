import assert from "node:assert/strict";
import test from "node:test";
import { can } from "./biz-access.ts";
import { buildStatements, type PostedLine } from "./ledger.ts";
import { planStartingMoney } from "./biz-access.ts";
import {
  allocateReimbursement,
  assertCanRecordFor,
  cashCommitments,
  onePaymentWins,
  planReimbursement,
  planSpend,
  stillDue,
} from "./reimburse.ts";

const rs = (n: number) => BigInt(Math.round(n * 100));

function post(entryId: string, date: string, lines: { code: string; debit: bigint; credit: bigint }[]): PostedLine[] {
  return lines.map((line) => ({ entryId, date, code: line.code, debit: line.debit, credit: line.credit }));
}

test("three founders paying personally do not move cash, revenue, or ownership", () => {
  const fareed = planSpend({ expenseCode: "5400", amount: rs(1200), source: "personal" });
  const aamir = planSpend({ expenseCode: "5400", amount: rs(3000), source: "personal" });
  const zaid = planSpend({ expenseCode: "5400", amount: rs(800), source: "personal" });
  const lines = [
    ...post("f", "2026-10-12", fareed),
    ...post("a", "2026-10-12", aamir),
    ...post("z", "2026-10-12", zaid),
  ];
  const books = buildStatements(lines, "2026-04-01", "2027-03-31");
  assert.equal(books.ok, true);
  assert.equal(books.closingCash, 0n);
  assert.equal(books.totalRevenue, 0n);
  assert.equal(books.netProfit, rs(-5000));
  assert.equal(books.liabilities.find((row) => row.code === "2500")?.amount, rs(5000));
  assert.equal(books.equity.find((row) => row.code === "3000"), undefined);
  assert.equal(fareed.some((line) => line.code === "3000" || line.code === "2300" || line.code === "1010"), false);

  const due = new Map<string, bigint>([
    ["fareed", rs(1200)],
    ["aamir", rs(3000)],
    ["zaid", rs(800)],
  ]);
  assert.equal([...due.values()].reduce((sum, value) => sum + value, 0n), rs(5000));
  assert.notEqual(due.get("fareed"), due.get("aamir"));
});

test("later business cash can reimburse everyone and the rest stays in the company", () => {
  const spend = [
    planSpend({ expenseCode: "5400", amount: rs(1200), source: "personal" }),
    planSpend({ expenseCode: "5400", amount: rs(3000), source: "personal" }),
    planSpend({ expenseCode: "5400", amount: rs(800), source: "personal" }),
  ];
  const funding = planStartingMoney({ amount: rs(30_000), place: "bank", origin: "existing" });
  const pay = planReimbursement(rs(5000), "bank");
  const lines = [
    ...spend.flatMap((journal, index) => post(`e${index}`, "2026-10-12", journal)),
    ...post("cash", "2026-11-01", funding),
    ...post("back", "2026-11-02", pay),
  ];
  const beforePay = buildStatements(lines.filter((line) => line.entryId !== "back"), "2026-04-01", "2027-03-31");
  assert.equal(beforePay.closingCash, rs(30_000));
  assert.equal(beforePay.liabilities.find((row) => row.code === "2500")?.amount, rs(5000));
  const books = buildStatements(lines, "2026-04-01", "2027-03-31");
  assert.equal(books.ok, true);
  assert.equal(books.closingCash, rs(25_000));
  assert.equal(books.liabilities.find((row) => row.code === "2500"), undefined);
  assert.equal(books.netProfit, rs(-5000));
  assert.equal(books.totalRevenue, 0n);
  assert.equal(books.opex.find((row) => row.code === "5400")?.amount, rs(5000));
  assert.equal(books.equity.find((row) => row.code === "3000"), undefined);
  const view = cashCommitments(books.closingCash, 0n, 0n);
  assert.equal(view.after, rs(25_000));
});

test("a partial reimbursement leaves the original expense alone", () => {
  const open = rs(10_000);
  const pay = rs(4_000);
  assert.equal(stillDue(open, pay), rs(6_000));
  const lines = allocateReimbursement(
    [
      { id: "aws", open: rs(3_000) },
      { id: "ads", open: rs(7_000) },
    ],
    pay,
  );
  assert.deepEqual(
    lines.map((line) => [line.id, line.take]),
    [
      ["aws", rs(3_000)],
      ["ads", rs(1_000)],
    ],
  );
  assert.equal(rs(3_000) + rs(7_000), open);
  assert.throws(() => allocateReimbursement([{ id: "aws", open }], rs(10_001)), /still owed/);
});

test("two simultaneous full reimbursements only one is applied", () => {
  const race = onePaymentWins(rs(5_000), [rs(5_000), rs(5_000)]);
  assert.deepEqual(race.applied, [rs(5_000), 0n]);
  assert.equal(race.left, 0n);
});

test("a member can record their own payment but cannot reimburse themselves", () => {
  assert.equal(can("member", "record_personal_business_expense"), true);
  assert.equal(can("member", "manage_reimbursements"), false);
  assert.equal(can("viewer", "record_personal_business_expense"), false);
  assert.equal(can("accountant", "manage_reimbursements"), true);
  assert.doesNotThrow(() => assertCanRecordFor(false, "fareed", "fareed"));
  assert.throws(() => assertCanRecordFor(false, "fareed", "aamir"), /only what you paid/);
  assert.doesNotThrow(() => assertCanRecordFor(true, "fareed", "aamir"));
});

test("a second database update cannot overpay the same expense", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  await pg.exec("create table biz_expenses (id text primary key, amount numeric not null, reimbursed numeric not null)");
  await pg.exec("insert into biz_expenses values ('e', 5000, 0)");
  const first = await pg.query("update biz_expenses set reimbursed = reimbursed + 5000 where id = 'e' and reimbursed + 5000 <= amount returning id");
  const second = await pg.query("update biz_expenses set reimbursed = reimbursed + 5000 where id = 'e' and reimbursed + 5000 <= amount returning id");
  assert.equal(first.rows.length, 1);
  assert.equal(second.rows.length, 0);
  const left = await pg.query<{ reimbursed: string }>("select reimbursed::text as reimbursed from biz_expenses");
  assert.equal(Number(left.rows[0]?.reimbursed), 5000);
});

test("business-paid and unpaid expenses do not create a team liability", () => {
  const bank = planSpend({ expenseCode: "5400", amount: rs(1000), source: "business", place: "bank" });
  const later = planSpend({ expenseCode: "5300", amount: rs(500), source: "unpaid" });
  assert.equal(bank.find((line) => line.code === "1010")?.credit, rs(1000));
  assert.equal(later.find((line) => line.code === "2000")?.credit, rs(500));
  assert.equal([...bank, ...later].some((line) => line.code === "2500"), false);
});
