import type { DraftLine } from "@/lib/ledger";

/** Indian state and UT codes used to decide CGST+SGST versus IGST. */
export const INDIA_STATES: { code: string; name: string }[] = [
  { code: "JK", name: "Jammu and Kashmir" },
  { code: "HP", name: "Himachal Pradesh" },
  { code: "PB", name: "Punjab" },
  { code: "CH", name: "Chandigarh" },
  { code: "UT", name: "Uttarakhand" },
  { code: "HR", name: "Haryana" },
  { code: "DL", name: "Delhi" },
  { code: "RJ", name: "Rajasthan" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "BR", name: "Bihar" },
  { code: "SK", name: "Sikkim" },
  { code: "AR", name: "Arunachal Pradesh" },
  { code: "NL", name: "Nagaland" },
  { code: "MN", name: "Manipur" },
  { code: "MZ", name: "Mizoram" },
  { code: "TR", name: "Tripura" },
  { code: "ML", name: "Meghalaya" },
  { code: "AS", name: "Assam" },
  { code: "WB", name: "West Bengal" },
  { code: "JH", name: "Jharkhand" },
  { code: "OD", name: "Odisha" },
  { code: "CG", name: "Chhattisgarh" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "GJ", name: "Gujarat" },
  { code: "MH", name: "Maharashtra" },
  { code: "KA", name: "Karnataka" },
  { code: "GA", name: "Goa" },
  { code: "KL", name: "Kerala" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "TS", name: "Telangana" },
  { code: "AP", name: "Andhra Pradesh" },
  { code: "PY", name: "Puducherry" },
  { code: "AN", name: "Andaman and Nicobar" },
  { code: "LD", name: "Lakshadweep" },
  { code: "DN", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "LA", name: "Ladakh" },
];

const STATE_SET = new Set(INDIA_STATES.map((state) => state.code));
export const GST_RATES = [0, 5, 12, 18, 28] as const;

export function financialYearLabel(date: string, startMonth = 4) {
  const [yearText, monthText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const start = month >= startMonth ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function formatInvoiceNumber(prefix: string, series: string, n: number) {
  const clean = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "") || "INV";
  return `${clean}/${series}/${String(n).padStart(5, "0")}`;
}

export function parseQtyMilli(value: string) {
  const raw = value.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) throw new Error("Quantity must be a positive number");
  const [whole, frac = ""] = raw.split(".");
  const milli = BigInt(whole) * 1000n + BigInt((frac + "000").slice(0, 3));
  if (milli <= 0n) throw new Error("Quantity must be greater than zero");
  return milli;
}

/** Half-up to the nearest paisa. Quantity is in thousandths. */
export function lineGross(qtyMilli: bigint, ratePaise: bigint) {
  if (ratePaise < 0n) throw new Error("Rate can't be negative");
  const product = qtyMilli * ratePaise;
  const base = product / 1000n;
  const rem = product % 1000n;
  return base + (rem >= 500n ? 1n : 0n);
}

export type TaxTreatment = "intra" | "inter" | "none" | "incomplete";

export type GstResult = {
  treatment: TaxTreatment;
  taxable: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  total: bigint;
};

/** GST collected for the government. Missing state data is incomplete, never guessed. */
export function gstOn(taxable: bigint, ratePercent: number, sellerState: string | null, placeOfSupply: string | null): GstResult {
  if (!GST_RATES.includes(ratePercent as (typeof GST_RATES)[number])) throw new Error("GST rate must be 0, 5, 12, 18, or 28");
  if (taxable < 0n) throw new Error("Taxable value can't be negative");
  if (ratePercent === 0) {
    return { treatment: "none", taxable, cgst: 0n, sgst: 0n, igst: 0n, total: taxable };
  }
  const seller = sellerState?.trim().toUpperCase() || "";
  const place = placeOfSupply?.trim().toUpperCase() || "";
  if (!STATE_SET.has(seller) || !STATE_SET.has(place)) {
    return { treatment: "incomplete", taxable, cgst: 0n, sgst: 0n, igst: 0n, total: taxable };
  }
  const tax = (taxable * BigInt(ratePercent) + 50n) / 100n;
  if (seller === place) {
    const cgst = tax / 2n;
    const sgst = tax - cgst;
    return { treatment: "intra", taxable, cgst, sgst, igst: 0n, total: taxable + cgst + sgst };
  }
  return { treatment: "inter", taxable, cgst: 0n, sgst: 0n, igst: tax, total: taxable + tax };
}

export type ComputedLine = {
  description: string;
  hsnSac: string | null;
  quantity: string;
  unit: string | null;
  rate: bigint;
  discount: bigint;
  gstRate: number;
  revenueCode: string;
  taxable: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  total: bigint;
  treatment: TaxTreatment;
};

export function computeLines(
  items: {
    description: string;
    hsnSac?: string | null;
    quantity: string;
    unit?: string | null;
    rate: bigint;
    discount?: bigint;
    gstRate: number;
    revenueCode?: string;
  }[],
  sellerState: string | null,
  placeOfSupply: string | null,
): { lines: ComputedLine[]; treatment: TaxTreatment; taxable: bigint; cgst: bigint; sgst: bigint; igst: bigint; total: bigint } {
  if (items.length === 0) throw new Error("Add at least one line");
  const lines = items.map((item) => {
    const description = item.description.trim();
    if (!description) throw new Error("Each line needs a description");
    const discount = item.discount ?? 0n;
    if (discount < 0n) throw new Error("Discount can't be negative");
    const gross = lineGross(parseQtyMilli(item.quantity), item.rate);
    if (discount > gross) throw new Error("Discount can't exceed the line amount");
    const taxable = gross - discount;
    const gst = gstOn(taxable, item.gstRate, sellerState, placeOfSupply);
    const revenueCode = item.revenueCode === "4000" ? "4000" : "4100";
    return {
      description,
      hsnSac: item.hsnSac?.trim() || null,
      quantity: item.quantity.trim(),
      unit: item.unit?.trim() || null,
      rate: item.rate,
      discount,
      gstRate: item.gstRate,
      revenueCode,
      taxable,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total: gst.total,
      treatment: gst.treatment,
    };
  });
  const sum = (pick: (line: ComputedLine) => bigint) => lines.reduce((total, line) => total + pick(line), 0n);
  const treatments = new Set(lines.map((line) => line.treatment));
  const treatment: TaxTreatment = treatments.has("incomplete") ? "incomplete" : treatments.has("inter") ? "inter" : treatments.has("intra") ? "intra" : "none";
  return {
    lines,
    treatment,
    taxable: sum((line) => line.taxable),
    cgst: sum((line) => line.cgst),
    sgst: sum((line) => line.sgst),
    igst: sum((line) => line.igst),
    total: sum((line) => line.total),
  };
}

function pushCredit(lines: DraftLine[], code: string, amount: bigint) {
  if (amount > 0n) lines.push({ code, debit: 0n, credit: amount });
}

function pushDebit(lines: DraftLine[], code: string, amount: bigint) {
  if (amount > 0n) lines.push({ code, debit: amount, credit: 0n });
}

/** Issue posts receivable, revenue excluding GST, and GST payable. Nothing is posted for a draft. */
export function planIssueJournal(input: {
  lines: { revenueCode: string; taxable: bigint }[];
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  total: bigint;
}): DraftLine[] {
  const journal: DraftLine[] = [{ code: "1100", debit: input.total, credit: 0n }];
  const byCode = new Map<string, bigint>();
  for (const line of input.lines) byCode.set(line.revenueCode, (byCode.get(line.revenueCode) ?? 0n) + line.taxable);
  for (const [code, amount] of byCode) pushCredit(journal, code, amount);
  pushCredit(journal, "2210", input.cgst);
  pushCredit(journal, "2220", input.sgst);
  pushCredit(journal, "2230", input.igst);
  return journal;
}

export function planPaymentJournal(cashAccount: string, amount: bigint): DraftLine[] {
  if (!["1000", "1010", "1020"].includes(cashAccount)) throw new Error("Choose a cash or bank account");
  if (amount <= 0n) throw new Error("Amount must be greater than zero");
  return [
    { code: cashAccount, debit: amount, credit: 0n },
    { code: "1100", debit: 0n, credit: amount },
  ];
}

function share(part: bigint, credit: bigint, total: bigint) {
  if (total === 0n) return 0n;
  return (part * credit) / total;
}

/** Credit note reverses revenue, GST liability, and receivable. It never deletes the original journal. */
export function planCreditJournal(input: {
  lines: { revenueCode: string; taxable: bigint }[];
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  total: bigint;
  credit: bigint;
}): DraftLine[] {
  if (input.credit <= 0n || input.credit > input.total) throw new Error("Credit note must be within the open balance");
  const taxable = input.lines.reduce((sum, line) => sum + line.taxable, 0n);
  let taxableShare = share(taxable, input.credit, input.total);
  let cgstShare = share(input.cgst, input.credit, input.total);
  let sgstShare = share(input.sgst, input.credit, input.total);
  let igstShare = share(input.igst, input.credit, input.total);
  const drift = input.credit - (taxableShare + cgstShare + sgstShare + igstShare);
  taxableShare += drift;
  const journal: DraftLine[] = [];
  const byCode = new Map<string, bigint>();
  for (const line of input.lines) byCode.set(line.revenueCode, (byCode.get(line.revenueCode) ?? 0n) + line.taxable);
  let left = taxableShare;
  const codes = [...byCode.entries()];
  codes.forEach(([code, amount], index) => {
    const piece = index === codes.length - 1 ? left : share(amount, taxableShare, taxable || 1n);
    left -= piece;
    pushDebit(journal, code, piece);
  });
  pushDebit(journal, "2210", cgstShare);
  pushDebit(journal, "2220", sgstShare);
  pushDebit(journal, "2230", igstShare);
  journal.push({ code: "1100", debit: 0n, credit: input.credit });
  return journal;
}

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export function agingBucket(due: string | null, today: string, open: bigint): AgingBucket | null {
  if (open <= 0n) return null;
  if (!due || due >= today) return "current";
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function displayStatus(status: string, due: string | null, today: string, open: bigint) {
  const normalized = status === "sent" ? "issued" : status;
  if ((normalized === "issued" || normalized === "partially_paid") && due && due < today && open > 0n) return "overdue";
  return normalized;
}

const BELOW_20 = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function wordsUnder100(n: number): string {
  if (n < 20) return BELOW_20[n] ?? "";
  const ten = TENS[Math.floor(n / 10)] ?? "";
  const one = BELOW_20[n % 10] ?? "";
  return one ? `${ten} ${one}` : ten;
}

function wordsUnder1000(n: number): string {
  if (n < 100) return wordsUnder100(n);
  const hundred = BELOW_20[Math.floor(n / 100)] ?? "";
  const rest = n % 100;
  return rest ? `${hundred} hundred ${wordsUnder100(rest)}` : `${hundred} hundred`;
}

/** Indian grouping: crore, lakh, thousand. Paise are stated only when present. */
export function rupeesInWords(paise: bigint): string {
  if (paise < 0n) return `minus ${rupeesInWords(-paise)}`;
  const rupees = Number(paise / 100n);
  const rest = Number(paise % 100n);
  if (!Number.isSafeInteger(rupees)) return "amount too large";
  const parts: string[] = [];
  let left = rupees;
  const crore = Math.floor(left / 10_000_000);
  left %= 10_000_000;
  const lakh = Math.floor(left / 100_000);
  left %= 100_000;
  const thousand = Math.floor(left / 1000);
  left %= 1000;
  if (crore) parts.push(`${wordsUnder1000(crore)} crore`);
  if (lakh) parts.push(`${wordsUnder100(lakh)} lakh`);
  if (thousand) parts.push(`${wordsUnder1000(thousand)} thousand`);
  if (left) parts.push(wordsUnder1000(left));
  const rupeeWords = parts.length ? parts.join(" ") : "zero";
  const paisa = rest ? ` and ${wordsUnder100(rest)} paise` : "";
  return `${rupeeWords} rupees${paisa} only`;
}
