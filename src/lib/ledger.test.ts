import assert from "node:assert/strict";
import test from "node:test";
import { assertBalanced, buildStatements, invoiceTotal, type PostedLine } from "./ledger.ts";

const rupee = (amount: number) => BigInt(amount) * 100n;

test("rejects an unbalanced journal", () => {
  assert.throws(() => assertBalanced([
    { code: "1010", debit: rupee(100), credit: 0n },
    { code: "4000", debit: 0n, credit: rupee(90) },
  ]), /does not balance/);
});

test("invoice total is subtotal minus discount plus tax", () => {
  assert.equal(invoiceTotal(rupee(1000), rupee(100), rupee(162), ), rupee(1062));
});

test("Crodlin: unpaid sale, collection, and a paid software expense reconcile", () => {
  const lines: PostedLine[] = [
    { entryId: "capital", date: "2026-04-01", code: "1010", debit: rupee(1_000_000), credit: 0n },
    { entryId: "capital", date: "2026-04-01", code: "3000", debit: 0n, credit: rupee(1_000_000) },
    { entryId: "sale", date: "2026-04-10", code: "1100", debit: rupee(100_000), credit: 0n },
    { entryId: "sale", date: "2026-04-10", code: "4000", debit: 0n, credit: rupee(100_000) },
    { entryId: "collect", date: "2026-04-20", code: "1010", debit: rupee(100_000), credit: 0n },
    { entryId: "collect", date: "2026-04-20", code: "1100", debit: 0n, credit: rupee(100_000) },
    { entryId: "software", date: "2026-04-21", code: "5400", debit: rupee(20_000), credit: 0n },
    { entryId: "software", date: "2026-04-21", code: "1010", debit: 0n, credit: rupee(20_000) },
  ];
  for (const id of ["capital", "sale", "collect", "software"]) {
    assertBalanced(lines.filter((line) => line.entryId === id).map(({ code, debit, credit }) => ({ code, debit, credit })));
  }
  const books = buildStatements(lines, "2026-04-01", "2027-03-31");
  assert.equal(books.ok, true);
  assert.equal(books.error, null);
  assert.equal(books.totalRevenue, rupee(100_000));
  assert.equal(books.grossProfit, rupee(100_000));
  assert.equal(books.ebitda, rupee(80_000));
  assert.equal(books.netProfit, rupee(80_000));
  const bank = books.assets.find((row) => row.code === "1010");
  const receivable = books.assets.find((row) => row.code === "1100");
  assert.equal(bank?.amount, rupee(1_080_000));
  assert.equal(receivable, undefined);
  assert.equal(books.totalAssets, rupee(1_080_000));
  assert.equal(books.totalLiabilities, 0n);
  assert.equal(books.currentEarnings, rupee(80_000));
  assert.equal(books.totalEquity, rupee(1_080_000));
  assert.equal(books.openingCash, 0n);
  assert.equal(books.operating, rupee(80_000));
  assert.equal(books.investing, 0n);
  assert.equal(books.financing, rupee(1_000_000));
  assert.equal(books.closingCash, rupee(1_080_000));
  assert.equal(books.trialDebit, books.trialCredit);

  const afterSale = buildStatements(lines.filter((line) => line.entryId !== "collect" && line.entryId !== "software"), "2026-04-01", "2027-03-31");
  assert.equal(afterSale.assets.find((row) => row.code === "1100")?.amount, rupee(100_000));
  assert.equal(afterSale.assets.find((row) => row.code === "1010")?.amount, rupee(1_000_000));
  assert.equal(afterSale.totalRevenue, rupee(100_000));
});
