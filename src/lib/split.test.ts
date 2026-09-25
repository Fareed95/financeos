import assert from "node:assert/strict";
import test from "node:test";
import { toCents } from "./money.ts";
import { allocateSplits, applyExpense, applySettlement, simplifyDebts, summarizeSpend } from "./split.ts";

test("equal split of 1500 across 3", () => {
  const rows = allocateSplits("1500", "equal", [
    { userId: "fareed", value: "1" },
    { userId: "y", value: "1" },
    { userId: "z", value: "1" },
  ]);
  assert.deepEqual(rows.map((r) => r.allocated), ["500.00", "500.00", "500.00"]);
});

test("exact amounts must match total", () => {
  assert.throws(
    () =>
      allocateSplits("100", "exact", [
        { userId: "a", value: "40" },
        { userId: "b", value: "50" },
      ]),
    /add up/,
  );
});

test("percentages must total 100 and show rupees", () => {
  const rows = allocateSplits("1000", "percentage", [
    { userId: "a", value: "20" },
    { userId: "b", value: "30" },
    { userId: "c", value: "50" },
  ]);
  assert.deepEqual(rows.map((r) => r.allocated), ["200.00", "300.00", "500.00"]);
});

test("shares 1 1 2 of 2000", () => {
  const rows = allocateSplits("2000", "shares", [
    { userId: "fareed", value: "1" },
    { userId: "y", value: "1" },
    { userId: "z", value: "2" },
  ]);
  assert.deepEqual(rows.map((r) => r.allocated), ["500.00", "500.00", "1000.00"]);
});

test("rounding leftover cents stay exact", () => {
  const rows = allocateSplits("100", "equal", [
    { userId: "a", value: "1" },
    { userId: "b", value: "1" },
    { userId: "c", value: "1" },
  ]);
  const sum = rows.reduce((s, r) => s + toCents(r.allocated), 0n);
  assert.equal(sum, 10000n);
});

test("100 split three ways is deterministic", () => {
  const rows = allocateSplits("100", "equal", [
    { userId: "a", value: "1" },
    { userId: "b", value: "1" },
    { userId: "c", value: "1" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.allocated),
    ["33.34", "33.33", "33.33"],
  );
});

test("invalid splits are rejected", () => {
  assert.throws(() => allocateSplits("0", "equal", [{ userId: "a", value: "1" }]), /greater than zero/);
  assert.throws(() => allocateSplits("-5", "equal", [{ userId: "a", value: "1" }]), /greater than zero/);
  assert.throws(
    () =>
      allocateSplits("100", "exact", [
        { userId: "a", value: "-1" },
        { userId: "b", value: "101" },
      ]),
    /negative/,
  );
  assert.throws(
    () =>
      allocateSplits("100", "percentage", [
        { userId: "a", value: "40" },
        { userId: "b", value: "40" },
      ]),
    /100/,
  );
  assert.throws(
    () =>
      allocateSplits("100", "percentage", [
        { userId: "a", value: "-10" },
        { userId: "b", value: "110" },
      ]),
    /negative/,
  );
  assert.throws(
    () =>
      allocateSplits("100", "shares", [
        { userId: "a", value: "0" },
        { userId: "b", value: "0" },
      ]),
    /share/,
  );
});

test("bangalore trip nets ignore personal and private", () => {
  const nets = new Map();
  const dinner = allocateSplits("1500", "equal", [
    { userId: "fareed", value: "1" },
    { userId: "y", value: "1" },
    { userId: "z", value: "1" },
  ]);
  applyExpense(nets, "fareed", dinner);
  const cab = allocateSplits("1000", "equal", [
    { userId: "y", value: "1" },
    { userId: "z", value: "1" },
  ]);
  applyExpense(nets, "y", cab);
  assert.equal(nets.get("fareed"), 100000n);
  assert.equal(nets.get("y"), 0n);
  assert.equal(nets.get("z"), -100000n);
  const plan = simplifyDebts([...nets.entries()].map(([userId, cents]) => ({ userId, cents: cents ?? 0n })));
  assert.deepEqual(plan, [{ fromUserId: "z", toUserId: "fareed", amount: "1000.00" }]);
});

test("circular debts collapse so Y pays nobody", () => {
  const nets = new Map([
    ["x", 0n],
    ["y", 0n],
    ["z", 0n],
  ]);
  applyExpense(nets, "x", allocateSplits("500", "exact", [{ userId: "y", value: "500" }]));
  applyExpense(nets, "y", allocateSplits("500", "exact", [{ userId: "z", value: "500" }]));
  const plan = simplifyDebts([...nets.entries()].map(([userId, cents]) => ({ userId, cents })));
  assert.deepEqual(plan, [{ fromUserId: "z", toUserId: "x", amount: "500.00" }]);
  assert.equal(nets.get("y"), 0n);
  assert.notEqual(plan[0]?.amount, "1000.00");
});

test("completed settlement reduces what is still owed", () => {
  const nets = new Map([
    ["fareed", 100000n],
    ["z", -100000n],
  ]);
  applySettlement(nets, "z", "fareed", "400");
  const plan = simplifyDebts([...nets.entries()].map(([userId, cents]) => ({ userId, cents })));
  assert.deepEqual(plan, [{ fromUserId: "z", toUserId: "fareed", amount: "600.00" }]);
});

test("acceptance spend keeps personal and private out of the group total", () => {
  const dinner = allocateSplits("1500", "equal", [
    { userId: "fareed", value: "1" },
    { userId: "y", value: "1" },
    { userId: "z", value: "1" },
  ]);
  const cab = allocateSplits("1000", "equal", [
    { userId: "y", value: "1" },
    { userId: "z", value: "1" },
  ]);
  const secret = allocateSplits("600", "equal", [
    { userId: "fareed", value: "1" },
    { userId: "y", value: "1" },
  ]);
  const shared = [
    { paidBy: "fareed", amount: "1500.00", allocations: dinner },
    { paidBy: "y", amount: "1000.00", allocations: cab },
  ];
  const fareed = summarizeSpend({
    viewerId: "fareed",
    shared,
    personal: [{ userId: "fareed", amount: "2000" }],
    privateOnes: [{ paidBy: "fareed", amount: "600", allocations: secret }],
  });
  assert.equal(fareed.groupSpend, "2500.00");
  assert.equal(fareed.yourShare, "500.00");
  assert.equal(fareed.youPaid, "1500.00");
  assert.equal(fareed.personalSpend, "2000.00");
  assert.equal(fareed.mySpend, "2800.00");

  const z = summarizeSpend({
    viewerId: "z",
    shared,
    personal: [],
    privateOnes: [],
  });
  assert.equal(z.mySpend, "1000.00");
  assert.equal(z.groupSpend, "2500.00");
  assert.equal(z.personalSpend, "0.00");
});

test("ten-user circular obligations net to zero and do not inflate transfers", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `u${i}`);
  const amounts = ["100", "250", "80", "400", "60", "90", "300", "45", "120", "70"];
  const nets = new Map(ids.map((id) => [id, 0n]));
  for (let i = 0; i < ids.length; i += 1) {
    const next = ids[(i + 1) % ids.length];
    applyExpense(nets, ids[i], allocateSplits(amounts[i], "exact", [{ userId: next, value: amounts[i] }]));
  }
  let sum = 0n;
  let positive = 0n;
  for (const cents of nets.values()) {
    sum += cents;
    if (cents > 0n) positive += cents;
  }
  assert.equal(sum, 0n);
  assert.ok(positive > 0n);
  const plan = simplifyDebts([...nets.entries()].map(([userId, cents]) => ({ userId, cents })));
  const after = new Map(nets);
  for (const row of plan) applySettlement(after, row.fromUserId, row.toUserId, row.amount);
  for (const cents of after.values()) assert.equal(cents, 0n);
  const paid = plan.reduce((s, row) => s + toCents(row.amount), 0n);
  assert.equal(paid, positive);
  assert.ok(plan.length < ids.length);
  assert.ok(plan.every((row) => toCents(row.amount) <= positive));
});
