/** Integer minor-units arithmetic. Never use floating point for money math. */

const ZERO = 0n;

export type Money = string; // canonical "1234.50"

export function parseMoney(input: string | number): Money {
  const raw = String(input).replace(/,/g, "").trim();
  if (!raw) throw new Error("Enter an amount");
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) throw new Error("Enter a valid amount");
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [w, f = ""] = unsigned.split(".");
  const whole = w.replace(/^0+(?=\d)/, "") || "0";
  const frac = (f + "00").slice(0, 2);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function toCents(amount: Money | string): bigint {
  const parsed = parseMoney(amount);
  const negative = parsed.startsWith("-");
  const unsigned = negative ? parsed.slice(1) : parsed;
  const [w, f] = unsigned.split(".");
  const cents = BigInt(w) * 100n + BigInt(f);
  return negative ? -cents : cents;
}

export function fromCents(cents: bigint): Money {
  const negative = cents < ZERO;
  const abs = negative ? -cents : cents;
  const w = abs / 100n;
  const f = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${w}.${f}`;
}

export function addMoney(...amounts: Array<Money | string>): Money {
  return fromCents(amounts.reduce((sum, a) => sum + toCents(a), ZERO));
}

export function subMoney(a: Money | string, b: Money | string): Money {
  return fromCents(toCents(a) - toCents(b));
}

export function isPositive(amount: Money | string): boolean {
  return toCents(amount) > ZERO;
}

export function isNegative(amount: Money | string): boolean {
  return toCents(amount) < ZERO;
}

export function isZero(amount: Money | string): boolean {
  return toCents(amount) === ZERO;
}

export function cmpMoney(a: Money | string, b: Money | string): number {
  const d = toCents(a) - toCents(b);
  return d === 0n ? 0 : d > 0n ? 1 : -1;
}

export function absMoney(amount: Money | string): Money {
  const c = toCents(amount);
  return fromCents(c < ZERO ? -c : c);
}

export function percentUsed(spent: Money | string, budget: Money | string): number {
  const b = toCents(budget);
  if (b === ZERO) return 0;
  const s = toCents(spent);
  const pct = Number((s * 10000n) / b) / 100;
  return pct;
}

export function divideMoney(amount: Money | string, parts: number): Money {
  if (parts <= 0) return parseMoney(amount);
  const cents = toCents(amount);
  return fromCents(cents / BigInt(parts));
}

export function formatMoney(
  amount: Money | string,
  currency = "INR",
  opts: { sign?: "auto" | "never" | "always"; compact?: boolean } = {},
): string {
  const cents = toCents(amount);
  const value = Number(cents) / 100;
  const locale = currency === "INR" ? "en-IN" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      maximumFractionDigits: 2,
      minimumFractionDigits: opts.compact && Number.isInteger(value) ? 0 : 2,
      signDisplay: opts.sign === "always" ? "always" : opts.sign === "never" ? "never" : "auto",
    }).format(value);
  } catch {
    const n = fromCents(cents);
    return `${currency} ${n}`;
  }
}

export function formatCompact(amount: Money | string, currency = "INR"): string {
  const cents = toCents(amount);
  const value = Number(cents) / 100;
  const locale = currency === "INR" ? "en-IN" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: Math.abs(value) >= 100000 ? "compact" : "standard",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return formatMoney(amount, currency);
  }
}
