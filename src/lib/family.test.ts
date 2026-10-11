import assert from "node:assert/strict";
import test from "node:test";
import { canFamily, assertSameFamily, familySeesPersonal, claimFamilyInvite, familyInviteView } from "./family-access.ts";
import { applyHousehold, familyNetWorth, goalProgress, planPersonalToFamily, splitPersonalAndFamily } from "./family.ts";
import { planSpend } from "./reimburse.ts";

const rs = (n: number) => BigInt(Math.round(n * 100));

test("personal salary is not family income", () => {
  const split = splitPersonalAndFamily({ salary: rs(80000), contribution: rs(25000) });
  assert.equal(split.personalIncome, rs(80000));
  assert.equal(split.familySeesSalary, false);
  assert.equal(split.familyAdded, rs(25000));
  assert.equal(familySeesPersonal(false), false);
  assert.equal(split.personalKept, rs(55000));
});

test("Sayed household contributions and spending stay separate from cash", () => {
  const books = applyHousehold(0n, [
    { kind: "contribution", person: "Dad", amount: rs(40000), intoAccount: true },
    { kind: "contribution", person: "Fareed", amount: rs(25000), intoAccount: true },
    { kind: "contribution", person: "Mom", amount: rs(10000), intoAccount: true },
    { kind: "expense", person: "Family", amount: rs(20000), paidFrom: "family", reimburse: false, category: "Rent" },
    { kind: "expense", person: "Family", amount: rs(10000), paidFrom: "family", reimburse: false, category: "Groceries" },
    { kind: "expense", person: "Family", amount: rs(3000), paidFrom: "family", reimburse: false, category: "Electricity" },
    { kind: "expense", person: "Family", amount: rs(1000), paidFrom: "family", reimburse: false, category: "Internet" },
  ]);
  assert.equal(books.added, rs(75000));
  assert.equal(books.spent, rs(34000));
  assert.equal(books.byPerson.get("Dad"), rs(40000));
  assert.equal(books.cash, rs(41000));
});

test("untracked contributions do not invent family cash", () => {
  const books = applyHousehold(rs(10000), [
    { kind: "contribution", person: "Dad", amount: rs(40000), intoAccount: false },
  ]);
  assert.equal(books.added, rs(40000));
  assert.equal(books.cash, rs(10000));
});

test("personal payment can be a contribution or a reimbursement", () => {
  const contributed = applyHousehold(rs(10000), [
    { kind: "expense", person: "Brother", amount: rs(2000), paidFrom: "personal", reimburse: false, category: "Groceries" },
  ]);
  assert.equal(contributed.spent, rs(2000));
  assert.equal(contributed.cash, rs(10000));
  assert.equal(contributed.due.get("Brother") ?? 0n, 0n);

  const owed = applyHousehold(rs(10000), [
    { kind: "expense", person: "Brother", amount: rs(2000), paidFrom: "personal", reimburse: true, category: "Groceries" },
    { kind: "payback", person: "Brother", amount: rs(2000) },
  ]);
  assert.equal(owed.spent, rs(2000));
  assert.equal(owed.due.get("Brother"), 0n);
  assert.equal(owed.cash, rs(8000));
});

test("personal to family transfer does not double count", () => {
  const move = planPersonalToFamily(rs(25000));
  assert.equal(move.personal.countsAsExpense, false);
  assert.equal(move.personal.countsAsIncome, false);
  assert.equal(move.family.countsAsNewWealth, false);
  assert.equal(move.combinedChange, 0n);
  const personalCash = rs(50000) - move.personal.amount;
  const familyCash = rs(10000) + move.family.amount;
  assert.equal(personalCash + familyCash, rs(60000));
  assert.equal(familySeesPersonal(false), false);
});

test("family roles do not grant personal or business powers", () => {
  assert.equal(canFamily("viewer", "view"), true);
  assert.equal(canFamily("viewer", "record"), false);
  assert.equal(canFamily("member", "manage_people"), false);
  assert.equal(canFamily("adult", "manage_money"), true);
  assert.equal(canFamily("owner", "manage_people"), true);
  assert.throws(() => assertSameFamily("family-a", "family-b"));
});

test("family invite can be used once", () => {
  const open = familyInviteView({ revokedAt: null, acceptedAt: null, expiresAt: "2099-01-01", now: Date.parse("2026-10-01") });
  assert.equal(claimFamilyInvite(open), "claimed");
  const used = familyInviteView({ revokedAt: null, acceptedAt: "2026-10-02", expiresAt: "2099-01-01", now: Date.parse("2026-10-03") });
  assert.throws(() => claimFamilyInvite(used));
  const revoked = familyInviteView({ revokedAt: "2026-10-02", acceptedAt: null, expiresAt: "2099-01-01", now: Date.parse("2026-10-03") });
  assert.equal(revoked, "revoked");
});

test("goals and net worth ignore private personal assets", () => {
  assert.equal(goalProgress(rs(180000), rs(500000)), 36);
  assert.equal(familyNetWorth({ cash: rs(10000), investments: 0n, liabilities: 0n, hasValuation: false }), null);
  assert.equal(familyNetWorth({ cash: rs(10000), investments: rs(50000), liabilities: rs(20000), hasValuation: true }), rs(40000));
  assert.equal(familyNetWorth({ cash: rs(29000), goals: rs(10000), investments: rs(21000), liabilities: rs(100000), hasValuation: true }), rs(-40000));
});

test("business personal spend still does not move company cash", () => {
  const lines = planSpend({ expenseCode: "5400", amount: rs(1200), source: "personal" });
  assert.equal(lines.some((line) => line.code === "1000" || line.code === "1010"), false);
  assert.equal(lines.find((line) => line.code === "2500")?.credit, rs(1200));
});
