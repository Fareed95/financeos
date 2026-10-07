import assert from "node:assert/strict";
import test from "node:test";
import { auditBooks } from "./integrity.ts";
import { assertBalanced, buildStatements, type DraftLine, type PostedLine } from "./ledger.ts";
import { planStartingMoney } from "./biz-access.ts";
import { planBillPayment, planOpenBill } from "./ops.ts";
import { explainPurchaseBill } from "./learn-explain.ts";

const rs = (rupees: number) => BigInt(rupees) * 100n;

function post(lines: PostedLine[], date: string, draft: DraftLine[], entryId: string) {
  assertBalanced(draft);
  for (const line of draft) lines.push({ entryId, date, code: line.code, debit: line.debit, credit: line.credit });
}

test("Munafa ₹20,000 then the AWS bill stays balanced after both payments", () => {
  const lines: PostedLine[] = [];
  post(lines, "2026-10-01", planStartingMoney({ amount: rs(20_000), place: "cash", origin: "founder" }), "j1");
  const bill = planOpenBill({ expenseCode: "5400", taxable: rs(10_000), rate: 18, sellerState: "MH", placeOfSupply: "MH" });
  post(lines, "2026-10-02", bill.lines, "j2");
  post(lines, "2026-10-03", planBillPayment(rs(5_000), "1000"), "j3");
  post(lines, "2026-10-04", planBillPayment(rs(6_800), "1000"), "j4");
  const books = buildStatements(lines, "2026-10-01", "2026-10-31");
  assert.equal(books.closingCash, rs(8_200));
  assert.equal(books.opex.find((row) => row.code === "5400")?.amount, rs(10_000));
  assert.equal(books.liabilities.find((row) => row.code === "2000")?.amount, undefined);
  const journals = ["j1", "j2", "j3", "j4"].map((id) => {
    const rows = lines.filter((line) => line.entryId === id);
    return {
      id,
      debit: rows.reduce((sum, line) => sum + line.debit, 0n),
      credit: rows.reduce((sum, line) => sum + line.credit, 0n),
    };
  });
  const result = auditBooks({
    journals,
    trialDebit: books.trialDebit,
    trialCredit: books.trialCredit,
    assets: books.totalAssets,
    liabilities: books.totalLiabilities,
    equity: books.totalEquity,
    invoices: [],
    bills: [{ id: "aws", total: rs(11_800), paid: rs(11_800) }],
    loans: [],
    assetsHeld: [],
    crossBusinessRefs: 0,
    settlementJournals: 0,
    testLinesInLive: 0,
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("integrity catches an overpaid bill, a negative loan, and test leakage", () => {
  const result = auditBooks({
    journals: [{ id: "j", debit: 1n, credit: 1n }],
    trialDebit: 1n,
    trialCredit: 1n,
    assets: 1n,
    liabilities: 0n,
    equity: 1n,
    invoices: [{ id: "inv", total: 10n, paid: 11n }],
    bills: [{ id: "bill", total: 10n, paid: 12n }],
    loans: [{ id: "loan", principal: 10n, outstanding: -1n }],
    assetsHeld: [{ id: "laptop", cost: 10n, residual: 0n, accumulated: 11n }],
    crossBusinessRefs: 1,
    settlementJournals: 1,
    testLinesInLive: 2,
  });
  const codes = result.issues.map((issue) => issue.code).sort();
  assert.deepEqual(codes, [
    "bill_overpaid",
    "cross_business",
    "depreciation_over_cap",
    "invoice_overpaid",
    "loan_negative",
    "settlement_on_books",
    "test_in_live",
  ]);
});

test("an AWS bill explanation separates expense, tracked GST, and the unpaid balance", () => {
  const block = explainPurchaseBill({ name: "AWS", currency: "INR", taxable: "10000.00", total: "11800.00", paid: "5000.00" });
  assert.match(block.body, /10,000/);
  assert.match(block.body, /1,800/);
  assert.match(block.body, /11,800/);
  assert.match(block.body, /6,800/);
  assert.equal(block.body.toLowerCase().includes("guaranteed"), true);
  assert.equal(block.body.toLowerCase().includes("input tax credit is eligible"), false);
});
