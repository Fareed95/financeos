import assert from "node:assert/strict";
import test from "node:test";
import { monthsOwned, straightLine } from "./depreciation.ts";

test("counts completed months, not a future purchase", () => {
  assert.equal(monthsOwned("2024-01-01", "2026-10-03"), 33);
  assert.equal(monthsOwned("2026-10-15", "2026-10-03"), 0);
  assert.equal(monthsOwned("2026-01-20", "2026-02-10"), 0);
  assert.equal(monthsOwned("2026-01-20", "2026-02-20"), 1);
  assert.equal(monthsOwned("2026-01-01 00:00:00", "2026-10-03"), 9);
});

test("straight-line bike: 8 years, no salvage", () => {
  const row = straightLine({
    today: "2026-10-03",
    purchaseDate: "2026-01-01",
    purchaseAmount: "960000.00",
    salvageAmount: "0",
    usefulYears: 8,
  });
  assert.equal(row.lifeMonths, 96);
  assert.equal(row.monthly, "10000.00");
  assert.equal(row.monthsUsed, 9);
  assert.equal(row.depreciated, "90000.00");
  assert.equal(row.bookValue, "870000.00");
  assert.equal(row.finished, false);
});

test("book value stops at salvage", () => {
  const row = straightLine({
    today: "2030-01-01",
    purchaseDate: "2020-01-01",
    purchaseAmount: "100000.00",
    salvageAmount: "20000.00",
    usefulYears: 5,
  });
  assert.equal(row.finished, true);
  assert.equal(row.bookValue, "20000.00");
  assert.equal(row.monthly, "1333.33");
});
