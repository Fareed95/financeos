import assert from "node:assert/strict";
import test from "node:test";
import { assertBalanced } from "./ledger.ts";
import {
  agingBucket,
  computeLines,
  displayStatus,
  financialYearLabel,
  formatInvoiceNumber,
  planCreditJournal,
  planIssueJournal,
  planPaymentJournal,
  rupeesInWords,
} from "./gst.ts";

const rs = (rupees: number) => BigInt(rupees) * 100n;

function crodlinLines(place: string) {
  return computeLines(
    [{ description: "Software Development", hsnSac: "998314", quantity: "1", rate: rs(50_000), gstRate: 18, revenueCode: "4100" }],
    "MH",
    place,
  );
}

test("Maharashtra to Maharashtra splits 18 percent into CGST and SGST", () => {
  const bill = crodlinLines("MH");
  assert.equal(bill.treatment, "intra");
  assert.equal(bill.taxable, rs(50_000));
  assert.equal(bill.cgst, rs(4_500));
  assert.equal(bill.sgst, rs(4_500));
  assert.equal(bill.igst, 0n);
  assert.equal(bill.total, rs(59_000));
});

test("Maharashtra to Karnataka is IGST only", () => {
  const bill = crodlinLines("KA");
  assert.equal(bill.treatment, "inter");
  assert.equal(bill.igst, rs(9_000));
  assert.equal(bill.cgst, 0n);
  assert.equal(bill.sgst, 0n);
  assert.equal(bill.total, rs(59_000));
});

test("GST is not guessed when the seller state or place of supply is missing", () => {
  const bill = computeLines(
    [{ description: "Work", quantity: "1", rate: rs(10_000), gstRate: 18 }],
    "MH",
    "",
  );
  assert.equal(bill.treatment, "incomplete");
  assert.equal(bill.cgst, 0n);
  assert.equal(bill.igst, 0n);
});

test("issuing the Maharashtra invoice posts revenue net of GST", () => {
  const bill = crodlinLines("MH");
  const journal = planIssueJournal({ lines: bill.lines, cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst, total: bill.total });
  assertBalanced(journal);
  assert.equal(journal.find((line) => line.code === "1100")?.debit, rs(59_000));
  assert.equal(journal.find((line) => line.code === "4100")?.credit, rs(50_000));
  assert.equal(journal.find((line) => line.code === "2210")?.credit, rs(4_500));
  assert.equal(journal.find((line) => line.code === "2220")?.credit, rs(4_500));
  assert.equal(journal.find((line) => line.code === "4000"), undefined);
});

test("interstate issue credits IGST payable", () => {
  const bill = crodlinLines("KA");
  const journal = planIssueJournal({ lines: bill.lines, cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst, total: bill.total });
  assertBalanced(journal);
  assert.equal(journal.find((line) => line.code === "2230")?.credit, rs(9_000));
  assert.equal(journal.find((line) => line.code === "2210"), undefined);
});

test("a bank collection does not touch revenue", () => {
  const first = planPaymentJournal("1010", rs(20_000));
  const second = planPaymentJournal("1010", rs(39_000));
  assertBalanced(first);
  assertBalanced(second);
  assert.equal(first.some((line) => line.code.startsWith("4")), false);
  assert.equal(first.find((line) => line.code === "1100")?.credit, rs(20_000));
  assert.equal(second.find((line) => line.code === "1010")?.debit, rs(39_000));
});

test("a credit note reverses revenue and GST and keeps the original journal", () => {
  const bill = crodlinLines("MH");
  const journal = planCreditJournal({
    lines: bill.lines,
    cgst: bill.cgst,
    sgst: bill.sgst,
    igst: bill.igst,
    total: bill.total,
    credit: bill.total,
  });
  assertBalanced(journal);
  assert.equal(journal.find((line) => line.code === "4100")?.debit, rs(50_000));
  assert.equal(journal.find((line) => line.code === "2210")?.debit, rs(4_500));
  assert.equal(journal.find((line) => line.code === "2220")?.debit, rs(4_500));
  assert.equal(journal.find((line) => line.code === "1100")?.credit, rs(59_000));
});

test("financial year numbering does not reuse a shape from the calendar year alone", () => {
  assert.equal(financialYearLabel("2026-10-07"), "2026-27");
  assert.equal(financialYearLabel("2026-02-01"), "2025-26");
  assert.equal(formatInvoiceNumber("inv", "2026-27", 1), "INV/2026-27/00001");
});

test("overdue is derived, and aging buckets follow the due date", () => {
  assert.equal(displayStatus("issued", "2026-10-01", "2026-10-07", rs(100)), "overdue");
  assert.equal(displayStatus("paid", "2026-10-01", "2026-10-07", 0n), "paid");
  assert.equal(agingBucket("2026-10-20", "2026-10-07", rs(1)), "current");
  assert.equal(agingBucket("2026-09-01", "2026-10-07", rs(1)), "31-60");
  assert.equal(rupeesInWords(rs(59_000)), "fifty nine thousand rupees only");
});
