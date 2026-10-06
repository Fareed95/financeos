import assert from "node:assert/strict";
import test from "node:test";
import { assertScope, keyStatus } from "./api-guard.ts";
import { can } from "./biz-access.ts";
import { assertBalanced, buildStatements, type DraftLine, type PostedLine } from "./ledger.ts";
import { planStartingMoney } from "./biz-access.ts";
import {
  agingBucket,
  assertCanPay,
  billStatus,
  budgetVariance,
  depreciationAmount,
  nextRecurringDate,
  planAssetPurchase,
  planBillPayment,
  planDepreciation,
  planFullOpening,
  planLoanPayment,
  planLoanReceipt,
  planOpenBill,
  runwayFrom,
  webhookRetryDelayMs,
  whyProfitChanged,
} from "./ops.ts";
import { webhookSignature, webhookSignatureMatches } from "./webhook-sign.ts";

const rs = (rupees: number) => BigInt(rupees) * 100n;

function books() {
  const lines: PostedLine[] = [];
  let n = 0;
  return {
    post(date: string, draft: DraftLine[]) {
      assertBalanced(draft);
      const entryId = String(++n);
      for (const line of draft) lines.push({ entryId, date, code: line.code, debit: line.debit, credit: line.credit });
    },
    at(from: string, to: string) {
      return buildStatements(lines, from, to);
    },
  };
}

test("Munafa funding then an AWS bill and two payments do not double the expense", () => {
  const ledger = books();
  ledger.post("2026-10-01", planStartingMoney({ amount: rs(20_000), place: "cash", origin: "founder" }));
  let view = ledger.at("2026-10-01", "2026-10-31");
  assert.equal(view.totalRevenue, 0n);
  assert.equal(view.netProfit, 0n);
  assert.equal(view.closingCash, rs(20_000));

  const bill = planOpenBill({
    expenseCode: "5400",
    taxable: rs(10_000),
    rate: 18,
    sellerState: "MH",
    placeOfSupply: "MH",
  });
  assert.equal(bill.cgst, rs(900));
  assert.equal(bill.sgst, rs(900));
  assert.equal(bill.total, rs(11_800));
  ledger.post("2026-10-02", bill.lines);
  view = ledger.at("2026-10-01", "2026-10-31");
  assert.equal(view.opex.find((row) => row.code === "5400")?.amount, rs(10_000));
  assert.equal(view.liabilities.find((row) => row.code === "2000")?.amount, rs(11_800));
  assert.equal(view.assets.find((row) => row.code === "1210")?.amount, rs(900));
  assert.equal(view.assets.find((row) => row.code === "1220")?.amount, rs(900));
  assert.equal(view.closingCash, rs(20_000));
  assert.equal(view.netProfit, -rs(10_000));
  assert.equal(view.ok, true);

  assert.throws(() => assertCanPay(rs(11_800), rs(12_000)), /more than/);
  ledger.post("2026-10-03", planBillPayment(rs(5_000), "1000"));
  assert.equal(billStatus(rs(11_800), rs(5_000), "2026-10-20", "2026-10-07"), "partially_paid");
  view = ledger.at("2026-10-01", "2026-10-31");
  assert.equal(view.closingCash, rs(15_000));
  assert.equal(view.liabilities.find((row) => row.code === "2000")?.amount, rs(6_800));
  assert.equal(view.opex.find((row) => row.code === "5400")?.amount, rs(10_000));

  ledger.post("2026-10-04", planBillPayment(rs(6_800), "1000"));
  assert.equal(billStatus(rs(11_800), rs(11_800), "2026-10-20", "2026-10-07"), "paid");
  view = ledger.at("2026-10-01", "2026-10-31");
  assert.equal(view.closingCash, rs(8_200));
  assert.equal(view.liabilities.find((row) => row.code === "2000"), undefined);
  assert.equal(view.opex.find((row) => row.code === "5400")?.amount, rs(10_000));
  assert.equal(view.totalRevenue, 0n);
  assert.equal(view.ok, true);
});

test("a loan is not revenue, and principal is not an expense", () => {
  const ledger = books();
  ledger.post("2026-10-01", planLoanReceipt(rs(100_000), "1010"));
  let view = ledger.at("2026-10-01", "2026-10-31");
  assert.equal(view.totalRevenue, 0n);
  assert.equal(view.closingCash, rs(100_000));
  assert.equal(view.liabilities.find((row) => row.code === "2300")?.amount, rs(100_000));
  assert.equal(view.financing, rs(100_000));
  ledger.post("2026-10-15", planLoanPayment(rs(8_000), rs(2_000), "1010"));
  view = ledger.at("2026-10-01", "2026-10-31");
  assert.equal(view.liabilities.find((row) => row.code === "2300")?.amount, rs(92_000));
  assert.equal(view.interest, rs(2_000));
  assert.equal(view.closingCash, rs(90_000));
  assert.equal(view.opex.find((row) => row.name === "Interest"), undefined);
  assert.equal(view.totalRevenue, 0n);
  assert.equal(view.ok, true);
});

test("a laptop is an asset until depreciation is posted", () => {
  const ledger = books();
  ledger.post("2026-10-01", planAssetPurchase(rs(60_000), true, "1010"));
  let view = ledger.at("2026-10-01", "2026-10-31");
  assert.equal(view.opex.length, 0);
  assert.equal(view.netProfit, 0n);
  assert.equal(view.assets.find((row) => row.code === "1420")?.amount, rs(60_000));
  assert.equal(view.investing, -rs(60_000));
  const month = depreciationAmount(rs(60_000), 0n, 12, 0);
  assert.equal(month, rs(5_000));
  ledger.post("2026-10-31", planDepreciation(month));
  view = ledger.at("2026-10-01", "2026-10-31");
  assert.equal(view.depreciation, rs(5_000));
  assert.equal(view.assets.find((row) => row.code === "1410")?.amount, -rs(5_000));
  assert.equal(view.ok, true);
  assert.equal(depreciationAmount(rs(60_000), 0n, 12, 11), rs(5_000));
});

test("full opening balances plug equity and stay balanced", () => {
  const opening = planFullOpening({
    cash: rs(100_000),
    bank: rs(400_000),
    receivable: rs(100_000),
    payable: rs(50_000),
    loan: rs(150_000),
    assets: 0n,
  });
  assert.equal(opening.plug, rs(400_000));
  const ledger = books();
  ledger.post("2026-04-01", opening.lines);
  const view = ledger.at("2026-04-01", "2027-03-31");
  assert.equal(view.totalAssets, rs(600_000));
  assert.equal(view.totalLiabilities, rs(200_000));
  assert.equal(view.totalEquity, rs(400_000));
  assert.equal(view.totalRevenue, 0n);
  assert.equal(view.ok, true);
});

test("aging, budgets, runway, and profit changes use only the numbers given", () => {
  assert.equal(agingBucket("2026-10-20", "2026-10-07"), "current");
  assert.equal(agingBucket("2026-09-01", "2026-10-07"), "31-60");
  const variance = budgetVariance(rs(20_000), rs(27_000));
  assert.equal(variance.over, true);
  assert.equal(variance.variance, rs(7_000));
  assert.match(runwayFrom(rs(600_000), [-rs(100_000)]).months ?? "", /^6\.0$/);
  assert.match(runwayFrom(rs(600_000), [rs(1)]).note, /not negative/);
  assert.equal(runwayFrom(rs(1), []).note, "Not enough data yet.");
  const change = whyProfitChanged(
    { revenue: rs(100_000), expenses: [{ name: "Software", amount: rs(10_000) }], profit: rs(90_000) },
    { revenue: rs(90_000), expenses: [{ name: "Software", amount: rs(16_000), }, { name: "Marketing", amount: rs(4_000) }], profit: rs(70_000) },
  );
  assert.equal(change.explained, true);
  assert.equal(change.delta, -rs(20_000));
  assert.equal(nextRecurringDate("2026-10-07", "monthly"), "2026-11-07");
  assert.equal(webhookRetryDelayMs(0), 60_000);
  assert.equal(webhookRetryDelayMs(4), null);
});

test("permissions and API scopes reject viewers, members paying bills, and revoked keys", () => {
  assert.equal(can("viewer", "manage_vendors"), false);
  assert.equal(can("viewer", "pay_bills"), false);
  assert.equal(can("member", "pay_bills"), false);
  assert.equal(can("member", "view_equity"), false);
  assert.equal(can("accountant", "manage_bills"), true);
  assert.equal(can("accountant", "pay_bills"), true);
  assert.equal(can("accountant", "view_equity"), false);
  assert.equal(can("accountant", "manage_api_keys"), false);
  assert.equal(can("attacker", "view_vendors"), false);
  assert.throws(() => assertScope(["invoices:read"], "bills:read"), /bills:read/);
  assert.equal(keyStatus({ revokedAt: "2026-10-01", expiresAt: null, now: Date.now() }), "revoked");
  const signed = webhookSignature("secret", "100", "{\"ok\":true}");
  assert.equal(webhookSignatureMatches("secret", "100", "{\"ok\":true}", signed.header), true);
  assert.equal(webhookSignatureMatches("secret", "100", "{\"ok\":false}", signed.header), false);
  assert.match(signed.header, /^sha256=[0-9a-f]{64}$/);
});
