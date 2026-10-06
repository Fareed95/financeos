import assert from "node:assert/strict";
import test from "node:test";
import { ownership, simulateRound } from "./cap-table.ts";

const rupee = (amount: number) => BigInt(amount) * 100n;

test("ownership comes from shares, not a stored percent", () => {
  const rows = ownership([
    { name: "Fareed", shares: 700_000n },
    { name: "Co-Founder", shares: 300_000n },
  ]);
  assert.equal(rows[0]?.bps, 7000n);
  assert.equal(rows[1]?.bps, 3000n);
  assert.equal(rows[0]!.shares + rows[1]!.shares, 1_000_000n);
});

test("a priced round dilutes holders and does not need the cap table to change", () => {
  const before = [
    { name: "Fareed", shares: 700_000n },
    { name: "Co-Founder", shares: 300_000n },
  ];
  const round = simulateRound(before, rupee(5_000_000), rupee(45_000_000));
  assert.equal(round.postMoney, rupee(50_000_000));
  assert.equal(round.investorBps, 1000n);
  assert.equal(round.holders.find((row) => row.name === "Fareed")?.bps, 6300n);
  assert.equal(round.holders.find((row) => row.name === "Co-Founder")?.bps, 2700n);
  assert.deepEqual(before, [
    { name: "Fareed", shares: 700_000n },
    { name: "Co-Founder", shares: 300_000n },
  ]);
});
