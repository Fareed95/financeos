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
