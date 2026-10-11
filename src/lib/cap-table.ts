/** Ownership is always derived from share counts. Percentages are not stored. */

export type Holder = { name: string; shares: bigint };

export type Ownership = { name: string; shares: bigint; bps: bigint };

export function ownership(holders: Holder[]): Ownership[] {
  const total = holders.reduce((sum, holder) => sum + holder.shares, 0n);
  if (total < 0n) throw new Error("Share count can't be negative");
  return holders
    .filter((holder) => holder.shares !== 0n)
    .map((holder) => ({
      name: holder.name,
      shares: holder.shares,
      bps: total === 0n ? 0n : (holder.shares * 10000n) / total,
    }));
}

export type RoundSim = {
  postMoney: bigint;
  investorBps: bigint;
  newShares: bigint;
  holders: Ownership[];
};

/**
 * Dilution from a priced round. Does not touch the real cap table.
 * Investor percent is investment / post-money. Existing holders keep their
 * relative split of what remains.
 */
export function simulateRound(holders: Holder[], investment: bigint, preMoney: bigint): RoundSim {
  if (investment <= 0n) throw new Error("Investment must be greater than zero");
  if (preMoney <= 0n) throw new Error("Pre-money valuation must be greater than zero");
  const outstanding = holders.reduce((sum, holder) => sum + holder.shares, 0n);
  if (outstanding <= 0n) throw new Error("Issue shares before simulating a round");
  const postMoney = preMoney + investment;
  const investorBps = (investment * 10000n) / postMoney;
  const newShares = (investment * outstanding) / preMoney;
  const remain = 10000n - investorBps;
  const current = ownership(holders);
  const diluted = current.map((holder) => ({
    name: holder.name,
    shares: holder.shares,
    bps: (holder.bps * remain) / 10000n,
  }));
  diluted.push({ name: "New investor", shares: newShares, bps: investorBps });
  return { postMoney, investorBps, newShares, holders: diluted };
}

/** Shares to issue so one person ends on an exact percent. Percents are not stored. */

export type ShareIssue = { holder: string; shares: bigint };

export function parsePercentBps(text: string): bigint {
  const cleaned = text.trim().replace("%", "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error("Enter a percent like 40");
  const [whole, frac = ""] = cleaned.split(".");
  const bps = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  if (bps <= 0n || bps > 10000n) throw new Error("Use a percent from 1 to 100");
  return bps;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1n;
}

/**
 * Issue only new shares so `holder` owns `targetBps` afterwards.
 * An empty company starts as 10,000 shares: the founder keeps the rest.
 * Existing owners are diluted, never reduced. 100% is only allowed on an empty company.
 */
export function planPercentGrant(input: {
  holders: Holder[];
  holder: string;
  targetBps: bigint;
  founderName: string;
}): { issuances: ShareIssue[]; after: Ownership[] } {
  const holder = input.holder.trim();
  const founder = input.founderName.trim() || "Owner";
  if (!holder) throw new Error("Choose who gets this percent");
  const target = input.targetBps;
  if (target <= 0n || target > 10000n) throw new Error("Use a percent from 1 to 100");

  if (input.holders.length === 0) {
    if (target === 10000n) {
      return pack([{ name: holder, shares: 10000n }]);
    }
    if (holder === founder) throw new Error("Start with 100%. Then give someone else a percent.");
    return pack([
      { name: founder, shares: 10000n - target },
      { name: holder, shares: target },
    ]);
  }

  if (target === 10000n) throw new Error("Someone already owns part of this");
  const mine = input.holders.find((row) => row.name === holder)?.shares ?? 0n;
  const total = input.holders.reduce((sum, row) => sum + row.shares, 0n);
  const current = (mine * 10000n) / total;
  if (current > target) throw new Error("They already own more than that");
  if (current === target) throw new Error("They already own that percent");

  const numer = target * total - mine * 10000n;
  const denom = 10000n - target;
  if (numer <= 0n) throw new Error("They already own that percent");
  const scale = denom / gcd(numer, denom);
  const issuances: ShareIssue[] = [];
  if (scale > 1n) {
    for (const row of input.holders) {
      const extra = row.shares * (scale - 1n);
      if (extra > 0n) issuances.push({ holder: row.name, shares: extra });
    }
  }
  issuances.push({ holder, shares: numer / gcd(numer, denom) });

  const next = new Map(input.holders.map((row) => [row.name, row.shares]));
  for (const row of issuances) next.set(row.holder, (next.get(row.holder) ?? 0n) + row.shares);
  const after = ownership([...next.entries()].map(([name, shares]) => ({ name, shares })));
  if (after.find((row) => row.name === holder)?.bps !== target) throw new Error("Couldn't land on that percent");
  return { issuances, after };
}

function pack(rows: Holder[]) {
  return {
    issuances: rows.map((row) => ({ holder: row.name, shares: row.shares })),
    after: ownership(rows),
  };
}