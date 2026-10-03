import { fromCents, toCents } from "./money.ts";

export const ASSET_KINDS = ["vehicle", "property", "gadget", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export type Depreciation = {
  monthly: string;
  monthsUsed: number;
  lifeMonths: number;
  depreciated: string;
  bookValue: string;
  finished: boolean;
};

function dateParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whole months from purchase to today. The purchase month itself counts once that day has passed. */
export function monthsOwned(purchaseDate: string, today: string): number {
  const from = dateParts(purchaseDate);
  const to = dateParts(today);
  if (!from || !to) return 0;
  const [y1, m1, d1] = from;
  const [y2, m2, d2] = to;
  let months = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) months -= 1;
  return Math.max(0, months);
}

/** Straight-line. Book value never falls below salvage, and this is not a cash expense. */
export function straightLine(input: {
  today: string;
  purchaseDate: string;
  purchaseAmount: string;
  salvageAmount: string;
  usefulYears: number;
}): Depreciation {
  const years = Math.min(40, Math.max(1, Math.floor(input.usefulYears) || 1));
  const lifeMonths = years * 12;
  const purchase = toCents(input.purchaseAmount);
  const salvageRaw = toCents(input.salvageAmount || "0");
  const salvage = salvageRaw > purchase ? purchase : salvageRaw < 0n ? 0n : salvageRaw;
  const depreciable = purchase - salvage;
  const monthly = depreciable / BigInt(lifeMonths);
  const monthsUsed = Math.min(lifeMonths, monthsOwned(input.purchaseDate, input.today));
  const finished = monthsUsed >= lifeMonths;
  const depreciated = finished ? depreciable : monthly * BigInt(monthsUsed);
  const book = purchase - depreciated;
  return {
    monthly: fromCents(monthly),
    monthsUsed,
    lifeMonths,
    depreciated: fromCents(depreciated),
    bookValue: fromCents(book < salvage ? salvage : book),
    finished,
  };
}
