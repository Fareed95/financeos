export type IntegrityIssue = { code: string; detail: string };

export type BooksAuditInput = {
  journals: { id: string; debit: bigint; credit: bigint }[];
  trialDebit: bigint;
  trialCredit: bigint;
  assets: bigint;
  liabilities: bigint;
  equity: bigint;
  invoices: { id: string; total: bigint; paid: bigint }[];
  bills: { id: string; total: bigint; paid: bigint }[];
  loans: { id: string; principal: bigint; outstanding: bigint }[];
  assetsHeld: { id: string; cost: bigint; residual: bigint; accumulated: bigint }[];
  crossBusinessRefs: number;
  settlementJournals: number;
  testLinesInLive: number;
};

/** Read-only. It never posts a correcting journal. */
export function auditBooks(input: BooksAuditInput): { ok: boolean; issues: IntegrityIssue[] } {
  const issues: IntegrityIssue[] = [];
  for (const journal of input.journals) {
    if (journal.debit !== journal.credit) {
      issues.push({ code: "journal_unbalanced", detail: `${journal.id} debits ${journal.debit} credits ${journal.credit}` });
    }
  }
  if (input.trialDebit !== input.trialCredit) {
    issues.push({ code: "trial_unbalanced", detail: `debits ${input.trialDebit} credits ${input.trialCredit}` });
  }
  if (input.assets !== input.liabilities + input.equity) {
    issues.push({
      code: "balance_sheet",
      detail: `assets ${input.assets} vs liabilities ${input.liabilities} + equity ${input.equity}`,
    });
  }
  for (const invoice of input.invoices) {
    if (invoice.paid > invoice.total) issues.push({ code: "invoice_overpaid", detail: invoice.id });
  }
  for (const bill of input.bills) {
    if (bill.paid > bill.total) issues.push({ code: "bill_overpaid", detail: bill.id });
  }
  if (input.settlementJournals > 0) {
    issues.push({ code: "settlement_on_books", detail: `${input.settlementJournals} settlement journals on the business ledger` });
  }
  for (const loan of input.loans) {
    if (loan.outstanding < 0n) issues.push({ code: "loan_negative", detail: loan.id });
    if (loan.outstanding > loan.principal) issues.push({ code: "loan_above_principal", detail: loan.id });
  }
  for (const asset of input.assetsHeld) {
    const cap = asset.cost - (asset.residual < 0n ? 0n : asset.residual);
    if (asset.accumulated < 0n || asset.accumulated > cap) {
      issues.push({ code: "depreciation_over_cap", detail: asset.id });
    }
  }
  if (input.crossBusinessRefs > 0) {
    issues.push({ code: "cross_business", detail: `${input.crossBusinessRefs} rows point at another business` });
  }
  if (input.testLinesInLive > 0) {
    issues.push({ code: "test_in_live", detail: `${input.testLinesInLive} test-environment lines are in the live set` });
  }
  return { ok: issues.length === 0, issues };
}
