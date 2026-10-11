import assert from "node:assert/strict";
import test from "node:test";
import { ownership, parsePercentBps, planPercentGrant, simulateRound } from "./cap-table.ts";

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

test("a percent grant lands exactly and leaves the rest with the founder", () => {
  const first = planPercentGrant({
    holders: [],
    holder: "Rehbar",
    targetBps: 4000n,
    founderName: "Fareed",
  });
  assert.equal(first.after.find((row) => row.name === "Rehbar")?.bps, 4000n);
  assert.equal(first.after.find((row) => row.name === "Fareed")?.bps, 6000n);
  assert.equal(first.issuances.reduce((sum, row) => sum + row.shares, 0n), 10000n);

  const more = planPercentGrant({
    holders: first.after.map((row) => ({ name: row.name, shares: row.shares })),
    holder: "Rehbar",
    targetBps: 5000n,
    founderName: "Fareed",
  });
  assert.equal(more.after.find((row) => row.name === "Rehbar")?.bps, 5000n);
  assert.equal(more.after.find((row) => row.name === "Fareed")?.bps, 5000n);
  assert.ok(more.issuances.every((row) => row.shares > 0n));
});

test("giving a percent cannot shrink someone who already owns more", () => {
  assert.throws(
    () => planPercentGrant({
      holders: [
        { name: "Fareed", shares: 6000n },
        { name: "Rehbar", shares: 4000n },
      ],
      holder: "Rehbar",
      targetBps: 3000n,
      founderName: "Fareed",
    }),
    /already own more/,
  );
  assert.equal(parsePercentBps("40"), 4000n);
  assert.equal(parsePercentBps("12.5%"), 1250n);
  assert.throws(() => parsePercentBps("0"), /1 to 100/);
});
