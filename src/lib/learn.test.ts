import assert from "node:assert/strict";
import test from "node:test";
import { searchConcepts } from "./learn.ts";
import { explainCapital, explainOneInvoice, explainPurchaseBill, type LearnSnapshot } from "./learn-explain.ts";

function snapshot(over: Partial<LearnSnapshot> = {}): LearnSnapshot {
  return {
    name: "Munafa",
    currency: "INR",
    periodLabel: "This month",
    revenue: "0.00",
    grossProfit: "0.00",
    ebitda: "0.00",
    depreciation: "0.00",
    interest: "0.00",
    tax: "0.00",
    netProfit: "0.00",
    cash: "20000.00",
    receivable: "0.00",
    payable: "0.00",
    gstPayable: "0.00",
    ownerFunding: "20000.00",
    totalAssets: "20000.00",
    totalLiabilities: "0.00",
    totalEquity: "20000.00",
    operating: "0.00",
    investing: "0.00",
    financing: "20000.00",
    invoices: [],
    holders: [],
    ...over,
  };
}

test("Munafa opening money is explained as funding, not revenue", () => {
  const block = explainCapital(snapshot());
  assert.match(block.body, /₹20,000/);
  assert.match(block.body, /owner funding/);
  assert.match(block.body, /did not increase revenue or profit/);
  assert.equal(block.rows?.find((row) => row.label.startsWith("Revenue"))?.value.includes("0"), true);
  assert.equal(block.hypothetical, undefined);
});

test("a 59000 invoice explains taxable, GST, cash, and the balance after a partial payment", () => {
  const before = explainOneInvoice(
    snapshot({ gstPayable: "9000.00", receivable: "59000.00" }),
    {
      number: "INV-1",
      customer: "Asha",
      status: "issued",
      taxable: "50000.00",
      cgst: "4500.00",
      sgst: "4500.00",
      igst: "0.00",
      total: "59000.00",
      paid: "0.00",
    },
  );
  const values = (before.rows ?? []).map((row) => row.value).join(" ");
  assert.match(values, /₹50,000/);
  assert.match(values, /₹9,000/);
  assert.match(values, /₹59,000/);
  assert.match(values, /₹0/);
  assert.match(before.body, /not revenue/);
  const after = explainOneInvoice(snapshot(), {
    number: "INV-1",
    customer: "Asha",
    status: "partially_paid",
    taxable: "50000.00",
    cgst: "4500.00",
    sgst: "4500.00",
    igst: "0.00",
    total: "59000.00",
    paid: "20000.00",
  });
  const later = (after.rows ?? []).map((row) => `${row.label} ${row.value}`).join(" | ");
  assert.match(later, /Revenue \(taxable\).*₹50,000/);
  assert.match(later, /Cash received.*₹20,000/);
  assert.match(later, /Still to collect.*₹39,000/);
});

test("an AWS bill explains expense, tracked input GST, and the unpaid balance", () => {
  const unpaid = explainPurchaseBill({ name: "AWS India", currency: "INR", taxable: "10000.00", total: "11800.00", paid: "0.00" });
  assert.match(unpaid.body, /₹10,000/);
  assert.match(unpaid.body, /₹1,800/);
  assert.match(unpaid.body, /input GST tracked separately/i);
  assert.match(unpaid.body, /not called a guaranteed tax credit/i);
  assert.match(unpaid.body, /₹11,800/);
  assert.match(unpaid.body, /Cash does not move/);
  assert.doesNotMatch(unpaid.body, /claimable|you can claim/i);
  const partial = explainPurchaseBill({ name: "AWS India", currency: "INR", taxable: "10000.00", total: "11800.00", paid: "5000.00" });
  assert.match(partial.body, /₹6,800/);
});

test("glossary search finds receivable and valuation without the accounting name", () => {
  assert.equal(searchConcepts("customer owes me money").some((concept) => concept.id === "receivable"), true);
  assert.equal(searchConcepts("company worth").some((concept) => concept.id === "valuation"), true);
  assert.equal(searchConcepts("monthly loss").some((concept) => concept.id === "profit" || concept.id === "burn"), true);
});
