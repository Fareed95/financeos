import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthPlan, paydayISO, shouldAskPayday, type PlanSource } from "./month-plan.ts";

function source(partial: Partial<PlanSource> & Pick<PlanSource, "id" | "amount" | "dayOfMonth">): PlanSource {
  return {
    name: "Salary",
    kind: "salary",
    isActive: true,
    checkin: null,
    snoozeUntil: null,
    ...partial,
  };
}

test("payday clamps to the last day of a short month", () => {
  assert.equal(paydayISO(2026, 2, 31), "2026-02-28");
  assert.equal(paydayISO(2024, 2, 31), "2024-02-29");
  assert.equal(paydayISO(2026, 10, 1), "2026-10-01");
});

test("asks from payday onward until they answer", () => {
  const salary = source({ id: "s", amount: "80000.00", dayOfMonth: 1 });
  assert.equal(shouldAskPayday("2026-10-01", salary), true);
  assert.equal(shouldAskPayday("2026-10-03", salary), true);
  assert.equal(shouldAskPayday("2026-10-03", { ...salary, dayOfMonth: 5 }), false);
  assert.equal(shouldAskPayday("2026-10-03", { ...salary, checkin: "credited" }), false);
  assert.equal(
    shouldAskPayday("2026-10-03", { ...salary, checkin: "snoozed", snoozeUntil: "2026-10-04" }),
    false,
  );
  assert.equal(
    shouldAskPayday("2026-10-04", { ...salary, checkin: "snoozed", snoozeUntil: "2026-10-04" }),
    true,
  );
});

test("plans a calm month as hold, needs, and wants", () => {
  const plan = buildMonthPlan({
    today: "2026-10-01",
    sources: [source({ id: "s", amount: "100000.00", dayOfMonth: 1 })],
    categories: [{ name: "Food", amount: "2000.00" }],
    spent: "2000.00",
    received: "0.00",
  });
  assert.equal(plan.expected, "100000.00");
  assert.equal(plan.left, "98000.00");
  assert.equal(plan.over, false);
  const allocate = plan.advice.find((a) => a.id === "allocate");
  assert.ok(allocate && allocate.id === "allocate");
  if (allocate?.id === "allocate") {
    assert.equal(allocate.hold, "20000.00");
    assert.equal(allocate.needs, "46800.00");
    assert.equal(allocate.wants, "31200.00");
  }
});

test("flags food when it crosses a quarter of expected income", () => {
  const plan = buildMonthPlan({
    today: "2026-10-20",
    sources: [source({ id: "s", amount: "40000.00", dayOfMonth: 1, checkin: "credited" })],
    categories: [{ name: "Food", amount: "12000.00" }],
    spent: "15000.00",
    received: "40000.00",
  });
  assert.ok(plan.advice.some((a) => a.id === "category" && a.name === "Food"));
});

test("says the month is over when spend passes expected income", () => {
  const plan = buildMonthPlan({
    today: "2026-10-18",
    sources: [source({ id: "s", amount: "30000.00", dayOfMonth: 1, checkin: "credited" })],
    categories: [],
    spent: "31000.00",
    received: "30000.00",
  });
  assert.equal(plan.over, true);
  assert.equal(plan.daily, "0.00");
  assert.equal(plan.advice[0]?.id, "over");
});

test("unpaid EMI is held back before the daily number", () => {
  const plan = buildMonthPlan({
    today: "2026-10-01",
    sources: [source({ id: "s", amount: "100000.00", dayOfMonth: 1 })],
    bills: [{ id: "e", name: "Bike EMI", amount: "20000.00", isActive: true, checkin: null }],
    categories: [],
    spent: "0.00",
    received: "0.00",
  });
  assert.equal(plan.reserved, "20000.00");
  assert.equal(plan.left, "80000.00");
  const allocate = plan.advice.find((a) => a.id === "allocate");
  assert.ok(allocate && allocate.id === "allocate");
  if (allocate?.id === "allocate") {
    assert.equal(allocate.hold, "16000.00");
    assert.equal(allocate.bills, "20000.00");
  }
});

test("a paid EMI is not reserved twice", () => {
  const plan = buildMonthPlan({
    today: "2026-10-05",
    sources: [source({ id: "s", amount: "100000.00", dayOfMonth: 1, checkin: "credited" })],
    bills: [{ id: "e", name: "Bike EMI", amount: "20000.00", isActive: true, checkin: "paid" }],
    categories: [],
    spent: "20000.00",
    received: "100000.00",
  });
  assert.equal(plan.reserved, "0.00");
  assert.equal(plan.left, "80000.00");
  assert.equal(plan.over, false);
});

test("asks to add income before giving a spend plan", () => {
  const plan = buildMonthPlan({
    today: "2026-10-03",
    sources: [],
    categories: [],
    spent: "0.00",
    received: "0.00",
  });
  assert.deepEqual(plan.advice, [{ id: "setup", tone: "act" }]);
});
