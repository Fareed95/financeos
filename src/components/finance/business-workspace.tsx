import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, fromCents, isZero, toCents } from "@/lib/money";
import { METRIC_HELP } from "@/lib/ledger";
import { simulateRound } from "@/lib/cap-table";
import { can } from "@/lib/biz-access";
import { assignOwnershipIntent } from "@/lib/ownership-decision";
import { getBusiness, linkBusinessStakeholder, postBusinessCapital, postBusinessShares } from "@/lib/server/business";
import { decideBusinessOwnership } from "@/lib/server/biz-team";
import { todayISO } from "@/lib/utils";
import { InvoiceDesk } from "@/components/finance/invoice-desk";
import { DeveloperPortal } from "@/components/finance/developer-portal";
import { BusinessSetup } from "@/components/finance/business-setup";
import { BusinessOps } from "@/components/finance/business-ops";
import { accountActivity, checkBooks } from "@/lib/server/ops";
import { BusinessTeam } from "@/components/finance/business-team";
import { LearnButton, LearnPanel, dismissLearnTip, learnTipVisible } from "@/components/finance/learn-panel";
import type { LearnSnapshot } from "@/lib/learn-explain";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { BusinessEmptyState, BusinessListRow, BusinessMetric, BusinessPageHeader, BusinessSection, BusinessStatusBadge } from "@/components/finance/business-ui";
import { MoneyHub, ReimbursementDesk, SpendForm, TransferForm } from "@/components/finance/business-spend";

type Section = "home" | "invoices" | "expenses" | "reports" | "equity" | "team" | "developer" | "guide" | "vendors" | "bills" | "money" | "budgets" | "loans" | "assets" | "reimbursements" | "settings";

export function BusinessWorkspace({ projectId, projectName, currency }: { projectId: string; projectName: string; currency: string }) {
  const today = todayISO();
  const user = useCurrentUser();
  const qc = useQueryClient();
  const [section, setSection] = useState<Section>("home");
  const [more, setMore] = useState(false);
  const [add, setAdd] = useState(false);
  const [period, setPeriod] = useState("month");
  const [money, setMoney] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [learn, setLearn] = useState<string | null>(null);
  const [focusConcept, setFocusConcept] = useState<string | null>(null);
  const [showTip, setShowTip] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expensePreset, setExpensePreset] = useState<"business" | "personal" | "unpaid">("business");
  const [report, setReport] = useState<string | null>(null);
  const [invoiceSetup, setInvoiceSetup] = useState(false);
  const [equityDraft, setEquityDraft] = useState<{ holder: string; linkUserId: string } | null>(null);
  const [skippedPrompt, setSkippedPrompt] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["business", projectId, today, period],
    queryFn: () => getBusiness({ data: { projectId, today, period } }),
  });

  useEffect(() => {
    document.documentElement.dataset.hideQuickAdd = "1";
    document.documentElement.dataset.business = "1";
    setShowTip(learnTipVisible());
    return () => {
      delete document.documentElement.dataset.hideQuickAdd;
      delete document.documentElement.dataset.business;
    };
  }, []);

  async function reload() {
    await qc.invalidateQueries({ queryKey: ["business", projectId] });
    await qc.invalidateQueries({ queryKey: ["biz-team", projectId] });
  }

  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading your business…</p>;
  if (q.error || !q.data) return <p className="text-sm text-expense">Couldn't load this business.</p>;
  const data = q.data;
  if (!data.setupDone) {
    if (data.role !== "owner" && data.role !== "admin") {
      return <p className="text-sm text-muted-foreground">The owner is still setting this business up.</p>;
    }
    return <BusinessSetup projectId={projectId} name={projectName} onDone={reload} />;
  }
  const books = data.statements;
  const snapshot: LearnSnapshot = {
    name: projectName,
    currency,
    periodLabel: data.range.label,
    revenue: books.totalRevenue,
    grossProfit: books.grossProfit,
    ebitda: books.ebitda,
    depreciation: books.depreciation,
    interest: books.interest,
    tax: books.tax,
    netProfit: books.netProfit,
    cash: data.cash,
    receivable: data.receivable,
    payable: data.payable,
    gstPayable: data.gstPayable,
    ownerFunding: data.ownerFunding,
    totalAssets: books.totalAssets,
    totalLiabilities: books.totalLiabilities,
    totalEquity: books.totalEquity,
    operating: books.operating,
    investing: books.investing,
    financing: books.financing,
    invoices: data.invoices.map((invoice) => ({
      number: invoice.number,
      customer: invoice.customer_name,
      status: invoice.status,
      taxable: invoice.taxable_total,
      cgst: invoice.cgst_total,
      sgst: invoice.sgst_total,
      igst: invoice.igst_total,
      total: invoice.total,
      paid: invoice.amount_paid,
    })),
    holders: data.holders,
    change: data.change,
    runwayNote: data.runway.note,
    reimbursement: data.reimbursementDue,
  };
  function openLearn(page: string, concept?: string) {
    setFocusConcept(concept ?? null);
    setLearn(page);
  }
  const canEquity = can(data.role, "view_equity");
  const canDev = can(data.role, "manage_api_keys");
  const canWrite = can(data.role, "create_records");
  const canPersonal = can(data.role, "record_personal_business_expense");
  const canPayTeam = can(data.role, "manage_reimbursements");
  const moneyFmt = (value: string) => formatMoney(value, currency, { compact: true });
  const selfId = user?.id || data.people.find((person) => person.role === "owner")?.userId || "";
  const inPeriod = data.expenses.filter((row) => row.spentOn >= data.range.from && row.spentOn <= data.range.to);
  const periodSpend = inPeriod.reduce((sum, row) => sum + toCents(row.amount), 0n);
  const byAccount = new Map<string, bigint>();
  for (const row of inPeriod) byAccount.set(row.account_code, (byAccount.get(row.account_code) ?? 0n) + toCents(row.amount));
  const commitments = toCents(data.payable) > 0n || toCents(data.reimbursementDue) > 0n;
  const afterObligations = toCents(data.cash) - toCents(data.payable) - toCents(data.reimbursementDue);

  function open(next: Section) {
    setSection(next);
    setMore(false);
    setAdd(false);
  }

  const prompt = data.ownershipPrompt && data.ownershipPrompt.memberId !== skippedPrompt ? data.ownershipPrompt : null;

  function openEquityFor(person: { name: string; userId: string }) {
    const intent = assignOwnershipIntent(person);
    setEquityDraft({ holder: intent.holder, linkUserId: intent.linkUserId });
    open("equity");
  }

  return (
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,42rem)] lg:justify-start lg:gap-10">
      <aside className="mb-4 hidden lg:block">
        <p className="px-2 text-xs text-muted-foreground">{projectName}</p>
        <NavGroup label="Today">
          <Side label="Overview" active={section === "home"} onClick={() => open("home")} />
          <Side label="Sales" active={section === "invoices"} onClick={() => open("invoices")} />
          <Side label="Expenses" active={section === "expenses"} onClick={() => open("expenses")} />
        </NavGroup>
        <NavGroup label="Money">
          <Side label="Money" active={section === "money"} onClick={() => open("money")} />
          <Side label="Reimbursements" active={section === "reimbursements"} onClick={() => open("reimbursements")} />
          <Side label="Bills" active={section === "bills"} onClick={() => open("bills")} />
          <Side label="Vendors" active={section === "vendors"} onClick={() => open("vendors")} />
        </NavGroup>
        <NavGroup label="Planning">
          <Side label="Budgets" active={section === "budgets"} onClick={() => open("budgets")} />
          <Side label="Loans" active={section === "loans"} onClick={() => open("loans")} />
          <Side label="Assets" active={section === "assets"} onClick={() => open("assets")} />
        </NavGroup>
        <NavGroup label="Business">
          <Side label="Reports" active={section === "reports"} onClick={() => open("reports")} />
          {canEquity && <Side label="Equity" active={section === "equity"} onClick={() => open("equity")} />}
          <Side label="Team" active={section === "team"} onClick={() => open("team")} />
        </NavGroup>
        <NavGroup label="System">
          <Side label="Guide" active={section === "guide"} onClick={() => open("guide")} />
          {canDev && <Side label="Developer" active={section === "developer"} onClick={() => open("developer")} />}
          <Side label="Settings" active={section === "settings"} onClick={() => open("settings")} />
        </NavGroup>
      </aside>
      <div className="min-w-0 space-y-4 pb-6">
        <div className="sticky top-0 z-30 -mx-4 grid grid-cols-4 gap-1.5 bg-background px-4 py-2 lg:hidden">
          <Tab label="Overview" active={section === "home"} onClick={() => open("home")} />
          <Tab label="Sales" active={section === "invoices"} onClick={() => open("invoices")} />
          <Tab label="Expenses" active={section === "expenses"} onClick={() => open("expenses")} />
          <Tab label="More" active={more} onClick={() => setMore((value) => !value)} />
        </div>
        {more && (
          <div className="space-y-5 lg:hidden">
            <MoreGroup title="Money" items={[
              ["money", "Accounts", "Bank, cash, and transfers"],
              ["reimbursements", "Reimbursements", "Money the company owes the team"],
              ["invoices", "Money to collect", "Invoices waiting to be paid"],
              ["bills", "Money to pay", "Bills you still owe"],
            ]} section={section} open={open} />
            <MoreGroup title="Spending" items={[
              ["expenses", "Expenses", "What the business spent"],
              ["vendors", "Vendors", "People you pay"],
              ["bills", "Bills", "Open vendor bills"],
            ]} section={section} open={open} />
            <MoreGroup title="Planning" items={[
              ["budgets", "Budgets", "What you planned to spend"],
              ["loans", "Loans", "Money borrowed"],
              ["assets", "Assets", "Things the business owns"],
            ]} section={section} open={open} />
            <MoreGroup title="Business" items={[
              ["reports", "Reports", "Profit, cash, and what you owe"],
              ...(canEquity ? [["equity", "Equity", "Who owns the company"] as const] : []),
              ["team", "Team", "Who can open this business"],
            ]} section={section} open={open} />
            <MoreGroup title="System" items={[
              ["guide", "Guide", "Plain-language explanations"],
              ...(canDev ? [["developer", "Developer", "API keys"] as const] : []),
              ["settings", "Settings", "Seller and tax details"],
            ]} section={section} open={open} />
          </div>
        )}
        <div className={more ? "hidden lg:contents" : "contents"}>
        {books.error && <p className="rounded-xl bg-card p-4 text-sm text-expense">{books.error}</p>}
        {section === "home" && (
          <div className="space-y-4">
            <BusinessPageHeader
              context="Business"
              title={projectName}
              aside={
                <>
                  <LearnButton compact onClick={() => openLearn("home")} />
                  {(canWrite || canPersonal) && <Button type="button" className="h-9" onClick={() => setAdd(true)}>Add</Button>}
                </>
              }
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Business overview</p>
              <select className="h-9 rounded-md bg-card px-2 text-sm" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Period">
                <option value="month">This month</option>
                <option value="last_month">Last month</option>
                <option value="quarter">This quarter</option>
                <option value="year">This financial year</option>
              </select>
            </div>
            {showTip && (
              <p className="text-sm text-muted-foreground">
                New here? Learn explains a number without changing the books.{" "}
                <button type="button" className="underline" onClick={() => { dismissLearnTip(); setShowTip(false); }}>Dismiss</button>
              </p>
            )}
            <div className="rounded-xl bg-card px-4 py-4">
              <p className="text-xs text-muted-foreground">Company position</p>
              <p className={`mt-1 font-display text-[1.75rem] leading-none tabular ${toCents(data.position) < 0n ? "text-expense" : ""}`}>{moneyFmt(data.position)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {toCents(data.position) < 0n
                  ? "The company is behind by this much. Sales and profit will raise it."
                  : toCents(data.position) > 0n
                    ? "Profit kept in the business. It is not cash you put in."
                    : "No result yet. Spending shows here as a minus until sales come in."}
              </p>
              {!isZero(data.cash) && (
                <p className="mt-2 text-sm text-muted-foreground">Cash in the business {moneyFmt(data.cash)}</p>
              )}
              {toCents(data.reimbursementDue) > 0n && (
                <button type="button" className="mt-2 block text-left text-sm text-muted-foreground underline" onClick={() => open("reimbursements")}>
                  {moneyFmt(data.reimbursementDue)} still owed to people who paid personally
                </button>
              )}
              {toCents(data.payable) > 0n && (
                <p className="mt-1 text-sm text-muted-foreground">{moneyFmt(data.payable)} due to vendors</p>
              )}
            </div>
            {data.expenses.length > 0 && (
              <BusinessSection title="Recent" action={<button type="button" className="text-xs text-muted-foreground" onClick={() => open("expenses")}>All</button>}>
                {data.expenses.slice(0, 6).map((row) => {
                  const personal = row.payerKind === "personal";
                  const who = row.payerName || data.people.find((person) => person.userId === row.payerUserId)?.name;
                  return (
                    <BusinessListRow
                      key={row.id}
                      title={row.memo || data.expenseAccounts.find((account) => account.code === row.account_code)?.name || "Expense"}
                      meta={[who, personal ? "Paid personally" : row.payerKind === "unpaid" ? "Not paid yet" : "Business account", row.spentOn].filter(Boolean).join(" · ")}
                      value={moneyFmt(row.amount)}
                    />
                  );
                })}
              </BusinessSection>
            )}
            {isZero(books.totalRevenue) && inPeriod.length === 0 ? (
              data.expenses.length === 0 ? (
                <BusinessEmptyState title="No sales yet" body="Create your first invoice to start tracking revenue. Money you put in is not a sale." action={<Button type="button" className="h-11" onClick={() => open("invoices")}>Create invoice</Button>} />
              ) : null
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <BusinessMetric label="Revenue" value={moneyFmt(books.totalRevenue)} />
                <BusinessMetric label="Expenses" value={moneyFmt(fromCents(periodSpend))} />
                <BusinessMetric label="Profit" value={moneyFmt(books.netProfit)} hint="Kept in the business" />
                <BusinessMetric label="Money to collect" value={moneyFmt(data.receivable)} />
              </div>
            )}
            {commitments && (
              <BusinessSection title="Cash commitments">
                <div className="rounded-lg border border-border/70 px-3">
                  <BusinessListRow title="Cash available" value={moneyFmt(data.cash)} />
                  {toCents(data.reimbursementDue) > 0n && <BusinessListRow title="Team reimbursements" value={moneyFmt(data.reimbursementDue)} />}
                  {toCents(data.payable) > 0n && <BusinessListRow title="Vendor bills" value={moneyFmt(data.payable)} />}
                  <BusinessListRow title="After current obligations" value={moneyFmt(fromCents(afterObligations))} />
                </div>
                {toCents(data.reimbursementDue) > 0n && (
                  <button type="button" className="text-sm text-muted-foreground underline" onClick={() => open("reimbursements")}>
                    {moneyFmt(data.reimbursementDue)} due · {data.reimbursementPeople} {data.reimbursementPeople === 1 ? "person" : "people"} covered expenses personally. Review
                  </button>
                )}
              </BusinessSection>
            )}
            <p className="text-sm text-muted-foreground">{data.runway.note}{data.runway.months ? ` About ${data.runway.months} months.` : ""}</p>
            <button type="button" className="min-h-11 text-sm text-muted-foreground" onClick={() => openLearn("home", "profit")}>Why did this change?</button>
            {money && canWrite && <AddMoney projectId={projectId} date={today} onSaved={async () => { setMoney(false); await reload(); }} />}
            {transfer && canWrite && <TransferForm projectId={projectId} date={today} onSaved={reload} />}
          </div>
        )}
        {section === "invoices" && (
          <div className="space-y-3">
            <BusinessPageHeader title="Sales" context={projectName} aside={<LearnButton compact onClick={() => openLearn("invoices")} />} />
            <InvoiceDesk projectId={projectId} currency={currency} startSetup={invoiceSetup} />
          </div>
        )}
        {section === "expenses" && (
          <div className="space-y-4">
            <BusinessPageHeader title="Expenses" context={data.range.label} aside={<LearnButton compact onClick={() => openLearn("expenses")} />} />
            <div className="rounded-xl bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">This month</p>
              <p className="text-2xl font-medium tabular">{moneyFmt(fromCents(periodSpend))}</p>
            </div>
            {byAccount.size > 0 && (
              <BusinessSection title="Where it went">
                {[...byAccount.entries()].map(([code, amount]) => (
                  <BusinessListRow key={code} title={data.expenseAccounts.find((account) => account.code === code)?.name || code} value={moneyFmt(fromCents(amount))} />
                ))}
              </BusinessSection>
            )}
            {inPeriod.length === 0 && (
              <BusinessEmptyState title="No spending in this period" body="Record a business expense, including something a founder paid personally." />
            )}
            {inPeriod.length > 0 && (
              <BusinessSection title="Recent spending">
                {inPeriod.slice(0, 8).map((row) => {
                  const returned = toCents(row.reimbursed || "0");
                  const open = toCents(row.amount) - returned;
                  const personal = row.payerKind === "personal";
                  const badge = row.payerKind === "unpaid" ? "Unpaid" : personal ? (open <= 0n ? "Returned" : returned > 0n ? "Part due" : "Owed") : "Paid";
                  const tone = badge === "Returned" || badge === "Paid" ? "paid" : badge === "Unpaid" ? "open" : "personal";
                  return (
                  <BusinessListRow
                    key={row.id}
                    title={row.memo || data.expenseAccounts.find((account) => account.code === row.account_code)?.name || "Expense"}
                    meta={personal ? "Paid personally" : row.payerKind === "unpaid" ? "Not paid yet" : "Business account"}
                    value={moneyFmt(row.amount)}
                    action={<BusinessStatusBadge tone={tone}>{badge}</BusinessStatusBadge>}
                  />
                  );
                })}
              </BusinessSection>
            )}
            {(canWrite || canPersonal) && (
              expenseOpen ? (
                <div className="rounded-xl bg-card p-4">
                  <SpendForm
                    projectId={projectId}
                    date={today}
                    accounts={data.expenseAccounts}
                    people={data.people}
                    selfId={selfId}
                    canRecordPersonal={canPersonal}
                    canRecordBusiness={canWrite}
                    preset={expensePreset}
                    onSaved={reload}
                  />
                </div>
              ) : (
                <Button type="button" className="h-11" onClick={() => { setExpensePreset("business"); setExpenseOpen(true); }}>Record expense</Button>
              )
            )}
          </div>
        )}
        {section === "reports" && (
          <div className="space-y-3">
            {!report && (
              <>
                <BusinessPageHeader title="Reports" context={projectName} aside={<LearnButton compact onClick={() => openLearn("reports")} />} />
                <p className="text-sm text-muted-foreground">Understand where the business stands.</p>
                <div className="grid gap-2">
                  {[
                    ["pnl", "Profit & Loss", "What you earned and spent"],
                    ["balance", "Balance Sheet", "What you own and owe"],
                    ["cash", "Cash Flow", "Where your money moved"],
                    ["collect", "Receivables", "Who needs to pay you"],
                    ["pay", "Payables", "Who you need to pay"],
                  ].map(([id, title, body]) => (
                    <button key={id} type="button" className="rounded-lg border border-border/70 px-3 py-3 text-left" onClick={() => setReport(id!)}>
                      <span className="block text-sm font-medium">{title}</span>
                      <span className="block text-xs text-muted-foreground">{body}</span>
                    </button>
                  ))}
                  <button type="button" className="px-1 py-2 text-left text-sm text-muted-foreground" onClick={() => setReport("trial")}>Trial balance and general ledger</button>
                </div>
              </>
            )}
            {report && (
              <>
                <button type="button" className="min-h-11 text-sm text-muted-foreground" onClick={() => setReport(null)}>All reports</button>
                <Reports books={books} currency={currency} projectId={projectId} from={data.range.from} to={data.range.to} focus={report} onLearn={(concept) => openLearn("reports", concept)} />
              </>
            )}
          </div>
        )}
        {section === "equity" && canEquity && (
          <div className="space-y-3">
            <BusinessPageHeader title="Who owns this?" context={projectName} aside={<LearnButton compact onClick={() => openLearn("equity")} />} />
            {data.ownershipReminder && <p className="text-sm text-muted-foreground">{data.ownershipReminder}</p>}
            {data.holders.length === 0 && (
              <BusinessEmptyState title="Ownership isn't set up yet" body="Your team can use this business without having company shares." />
            )}
            <EquityPanel
              projectId={projectId}
              date={today}
              currency={currency}
              holders={data.holders}
              people={data.people}
              links={data.stakeholderLinks ?? []}
              canLink={can(data.role, "manage_equity")}
              draft={equityDraft}
              onSaved={async () => {
                setEquityDraft(null);
                await reload();
              }}
            />
          </div>
        )}
        {section === "reimbursements" && (
          <div className="space-y-3">
            <div className="flex justify-end"><LearnButton compact onClick={() => openLearn("reimbursements")} /></div>
            <ReimbursementDesk
              projectId={projectId}
              currency={currency}
              date={today}
              accounts={{ bank: data.bank, cash: data.cashBox, petty: data.petty }}
              onSaved={reload}
            />
          </div>
        )}
        {section === "money" && (
          <div className="space-y-4">
            <MoneyHub
              currency={currency}
              cash={data.cash}
              bank={data.bank}
              cashBox={data.cashBox}
              petty={data.petty}
              receivable={data.receivable}
              payable={data.payable}
              reimbursement={data.reimbursementDue}
              onOpen={(next) => open(next === "invoices" ? "invoices" : next)}
            />
            {canWrite && <TransferForm projectId={projectId} date={today} onSaved={reload} />}
          </div>
        )}
        {section === "settings" && (
          <div className="space-y-3">
            <BusinessPageHeader title="Settings" context={projectName} />
            <p className="text-sm text-muted-foreground">GSTIN, seller details, and accounting setup stay here so Sales stays about getting paid.</p>
            <Button type="button" className="h-11" onClick={() => { setInvoiceSetup(true); open("invoices"); }}>Invoice details</Button>
            <p className="text-sm text-muted-foreground">Kind: {data.businessKind || "Not set"}</p>
          </div>
        )}
        {(section === "vendors" || section === "bills" || section === "budgets" || section === "loans" || section === "assets") && (
          <div className="space-y-3">
            <LearnButton compact onClick={() => openLearn(section === "budgets" ? "reports" : "expenses")} />
            <BusinessOps projectId={projectId} mode={section} currency={currency} today={today} openingDone={data.openingDone} />
          </div>
        )}
        {section === "team" && (
          <div className="space-y-3">
            <div className="flex justify-end"><LearnButton compact onClick={() => openLearn("team")} /></div>
            <BusinessTeam
              projectId={projectId}
              name={projectName}
              onAssignOwnership={(draft) => {
                setEquityDraft(draft);
                open("equity");
              }}
            />
          </div>
        )}
        {section === "guide" && (
          <div className="space-y-3">
            <h2 className="font-display text-2xl">Kharcha Business Guide</h2>
            <p className="text-sm text-muted-foreground">Search a term in plain language. Numbers in the panel come from this business.</p>
            <LearnButton onClick={() => openLearn("guide")} />
          </div>
        )}
        {section === "developer" && canDev && (
          <div className="space-y-3">
            <LearnButton onClick={() => openLearn("developer")} />
            <DeveloperPortal projectId={projectId} />
          </div>
        )}
        {(canWrite || canPersonal) && add && (
          <div className="fixed inset-x-0 bottom-16 z-40 mx-auto max-w-lg rounded-t-2xl border border-border bg-card p-4 pb-6 shadow-[var(--elev-shadow)] lg:bottom-6">
            <p className="text-sm font-medium">Add</p>
            <div className="mt-3 grid gap-2">
              {canWrite && <Button type="button" variant="secondary" className="h-11" onClick={() => open("invoices")}>Create invoice</Button>}
              {(canWrite || canPersonal) && <Button type="button" variant="secondary" className="h-11" onClick={() => { setExpensePreset(canWrite ? "business" : "personal"); setExpenseOpen(true); open("expenses"); }}>Record expense</Button>}
              {canWrite && <Button type="button" variant="secondary" className="h-11" onClick={() => open("bills")}>Add bill</Button>}
              {canWrite && <Button type="button" variant="secondary" className="h-11" onClick={() => open("invoices")}>Record payment</Button>}
              {canWrite && <Button type="button" variant="secondary" className="h-11" onClick={() => { setMoney(true); open("home"); }}>Add money to business</Button>}
              {canPersonal && <Button type="button" variant="secondary" className="h-11" onClick={() => { setExpensePreset("personal"); setExpenseOpen(true); open("expenses"); }}>Paid personally</Button>}
              {canWrite && <Button type="button" variant="secondary" className="h-11" onClick={() => { setTransfer(true); open("home"); }}>Transfer money</Button>}
            </div>
            <Button type="button" variant="ghost" className="mt-2 h-11 w-full" onClick={() => setAdd(false)}>Close</Button>
          </div>
        )}
        </div>
        {learn && <LearnPanel page={learn} snapshot={snapshot} focusConcept={focusConcept} onClose={() => setLearn(null)} />}
        {prompt && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 pb-24 sm:items-center sm:pb-4" role="dialog" aria-modal="true" aria-labelledby="ownership-prompt-title">
            <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-[var(--elev-shadow)]">
              <h2 id="ownership-prompt-title" className="font-display text-xl tracking-tight">{prompt.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{prompt.body}</p>
              <div className="mt-4 grid gap-2">
                <Button
                  type="button"
                  className="h-11"
                  onClick={() => {
                    setSkippedPrompt(prompt.memberId);
                    openEquityFor(prompt);
                  }}
                >
                  Assign ownership
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11"
                  onClick={async () => {
                    try {
                      await decideBusinessOwnership({ data: { projectId, memberId: prompt.memberId, decision: "none" } });
                      toast.success("No shares assigned");
                      await reload();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Couldn't save that");
                    }
                  }}
                >
                  No shares
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11"
                  onClick={async () => {
                    try {
                      await decideBusinessOwnership({ data: { projectId, memberId: prompt.memberId, decision: "later" } });
                      await reload();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Couldn't save that");
                    }
                  }}
                >
                  Decide later
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`h-10 rounded-md px-1 text-sm ${active ? "bg-foreground text-background" : "text-muted-foreground"}`}>
      {label}
    </button>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="px-2 text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-1 grid">{children}</div>
    </div>
  );
}

function MoreGroup({
  title,
  items,
  section,
  open,
}: {
  title: string;
  items: readonly (readonly [string, string, string])[];
  section: Section;
  open: (next: Section) => void;
}) {
  return (
    <section>
      <p className="px-1 text-[11px] uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-1.5 overflow-hidden rounded-xl bg-card">
        {items.map(([id, label, hint]) => (
          <button
            key={`${title}-${label}`}
            type="button"
            className={`flex min-h-14 w-full items-center justify-between gap-3 border-b border-border/50 px-3 text-left last:border-0 ${section === id ? "bg-secondary/80" : ""}`}
            onClick={() => open(id as Section)}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block truncate text-xs text-muted-foreground">{hint}</span>
            </span>
            <span className="text-muted-foreground" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Side({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-md px-2 py-1.5 text-left text-sm ${active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-card"}`}>
      {label}
    </button>
  );
}

function AddMoney({ projectId, date, onSaved }: { projectId: string; date: string; onSaved: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [place, setPlace] = useState("bank");
  const [origin, setOrigin] = useState("founder");
  const [open, setOpen] = useState(false);
  return (
    <form
      className="grid gap-3 rounded-xl bg-card p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await postBusinessCapital({ data: { projectId, amount, date, place, origin, kind: "contribution" } });
          toast.success("Money added. It was not recorded as revenue.");
          setAmount("");
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't add that");
        }
      }}
    >
      <p className="text-sm font-medium">Add money to the business</p>
      <p className="text-sm text-muted-foreground">This is a new contribution, not the original starting balance.</p>
      <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" />
      <select className="h-11 rounded-md bg-secondary px-3" value={place} onChange={(event) => setPlace(event.target.value)}>
        <option value="bank">Bank account</option>
        <option value="cash">Cash</option>
        <option value="other">Other cash</option>
      </select>
      <select className="h-11 rounded-md bg-secondary px-3" value={origin} onChange={(event) => setOrigin(event.target.value)}>
        <option value="founder">Founder / owner investment</option>
        <option value="existing">Existing business balance</option>
        <option value="loan">Business loan</option>
        <option value="other">Other</option>
      </select>
      <button type="button" className="text-left text-sm text-muted-foreground underline" onClick={() => setOpen((value) => !value)}>View accounting details</button>
      {open && <p className="text-sm text-muted-foreground">The cash account increases. Owner capital, retained earnings, or a loan increases by the same amount. Sales do not.</p>}
      <Button type="submit" className="h-11">Add money</Button>
    </form>
  );
}

function Reports({
  books,
  currency,
  projectId,
  from,
  to,
  focus,
  onLearn,
}: {
  books: {
    ok: boolean;
    totalRevenue: string;
    grossProfit: string;
    ebitda: string;
    ebit: string;
    profitBeforeTax: string;
    netProfit: string;
    opex: { code: string; name: string; amount: string }[];
    totalAssets: string;
    totalLiabilities: string;
    totalEquity: string;
    openingCash: string;
    operating: string;
    investing: string;
    financing: string;
    closingCash: string;
    trialDebit: string;
    trialCredit: string;
    assets: { code: string; name: string; amount: string }[];
    liabilities: { code: string; name: string; amount: string }[];
    equity: { code: string; name: string; amount: string }[];
    currentEarnings: string;
  };
  currency: string;
  projectId: string;
  from: string;
  to: string;
  focus?: string | null;
  onLearn?: (concept: string) => void;
}) {
  const money = (value: string) => formatMoney(value, currency);
  const show = (id: string) => !focus || focus === id || ((focus === "collect" || focus === "pay") && id === "balance");
  const [drill, setDrill] = useState<{ label: string; lines: { date: string; memo: string | null; debit: string; credit: string; source: string }[]; documents: { ref: string; who: string; open: string }[] } | null>(null);
  const [check, setCheck] = useState<string>("");
  async function openAccount(code: string, label: string, basis: "period" | "balance") {
    const result = await accountActivity({ data: { projectId, code, from, to, basis } });
    setDrill({ label, lines: result?.lines ?? [], documents: result?.documents ?? [] });
  }
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <p className="text-sm text-muted-foreground">Tap a figure to see the journals behind it.</p>
      {focus === "collect" && <p className="text-sm text-muted-foreground">Customers still to collect sit in accounts receivable. Open invoices are under Sales.</p>}
      {focus === "pay" && <p className="text-sm text-muted-foreground">Vendor bills sit in accounts payable. Team reimbursements are a separate amount owed back to people.</p>}
      {show("pnl") && <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Profit and loss</h2>
        <Line label="Revenue" value={money(books.totalRevenue)} hint="Money earned from sales before expenses." />
        <Line label="Gross profit" value={money(books.grossProfit)} hint={METRIC_HELP["Gross Profit"]} />
        {books.opex.map((row) => (
          <Line key={row.code} label={row.name} value={money(row.amount)} onOpen={() => openAccount(row.code, row.name, "period")} />
        ))}
        <Line label="Operating profit" value={money(books.ebitda)} hint="Profit from normal operations before interest, tax and depreciation. Also called EBITDA." onLearn={onLearn ? () => onLearn("ebitda") : undefined} />
        <Line label="EBIT" value={money(books.ebit)} hint={METRIC_HELP.EBIT} />
        <Line label="Profit before tax" value={money(books.profitBeforeTax)} hint={METRIC_HELP["Profit Before Tax"]} />
        <Line label="Net profit" value={money(books.netProfit)} hint={METRIC_HELP["Net Profit"]} />
      </section>}
      {show("balance") && <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Balance sheet</h2>
        {books.assets.map((row) => <Line key={row.code} label={row.name} value={money(row.amount)} onOpen={() => openAccount(row.code, row.name, "balance")} />)}
        <Line label="Total assets" value={money(books.totalAssets)} />
        {books.liabilities.map((row) => <Line key={row.code} label={row.name} value={money(row.amount)} onOpen={() => openAccount(row.code, row.name, "balance")} />)}
        <Line label="Total liabilities" value={money(books.totalLiabilities)} />
        {books.equity.map((row) => <Line key={row.code} label={row.name} value={money(row.amount)} onOpen={() => openAccount(row.code, row.name, "balance")} />)}
        <Line label="Current earnings" value={money(books.currentEarnings)} />
        <Line label="Total equity" value={money(books.totalEquity)} />
        <p className="mt-2 text-xs text-muted-foreground">{books.ok ? "Assets equal liabilities plus equity." : "Out of balance."}</p>
      </section>}
      {drill && (
        <section className="rounded-xl bg-card p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">{drill.label}</h2>
            <button type="button" className="min-h-11 text-muted-foreground" onClick={() => setDrill(null)}>Close</button>
          </div>
          {drill.documents.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">Open documents</p>
              {drill.documents.map((row) => <p key={row.ref}>{row.who} · {row.ref.slice(0, 12)} · {money(row.open)}</p>)}
            </div>
          )}
          {drill.lines.length === 0 && <p className="mt-2 text-muted-foreground">No posted lines in this view.</p>}
          {drill.lines.map((line, index) => (
            <p key={`${line.date}-${index}`} className="mt-1">{line.date} · {line.source} · {line.memo || "Journal"} · Dr {money(line.debit)} · Cr {money(line.credit)}</p>
          ))}
        </section>
      )}
      {show("cash") && <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Cash flow</h2>
        <Line label="Opening cash" value={money(books.openingCash)} />
        <Line label="Operating" value={money(books.operating)} />
        <Line label="Investing" value={money(books.investing)} />
        <Line label="Financing" value={money(books.financing)} />
        <Line label="Closing cash" value={money(books.closingCash)} />
        <p className="mt-2 text-xs text-muted-foreground">Profit is not cash. Collections move cash. Unpaid invoices do not. Profit that is not taken out stays in the business.</p>
      </section>}
      {show("trial") && <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Trial balance</h2>
        <Line label="Debits" value={money(books.trialDebit)} />
        <Line label="Credits" value={money(books.trialCredit)} />
        <Button type="button" variant="secondary" className="mt-3 h-11" onClick={async () => {
          const result = await checkBooks({ data: { projectId, today: to } });
          setCheck(result?.ok ? "Books balance. No integrity issues." : (result?.issues.map((issue) => issue.detail).join(" ") || "Check failed"));
        }}>Check books</Button>
        {check && <p className="mt-2 text-xs text-muted-foreground">{check}</p>}
      </section>}
    </div>
  );
}

function Line({ label, value, hint, onLearn, onOpen }: { label: string; value: string; hint?: string; onLearn?: () => void; onOpen?: () => void }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm" title={hint}>
      <span>
        {onOpen ? (
          <button type="button" className="min-h-11 text-left underline-offset-2 hover:underline" onClick={onOpen}>{label}</button>
        ) : label}
        {onLearn && (
          <button type="button" className="ml-2 text-xs text-muted-foreground" aria-label={`Learn about ${label}`} onClick={onLearn}>💡</button>
        )}
      </span>
      <span className="tabular">{value}</span>
    </div>
  );
}

function EquityPanel({
  projectId,
  date,
  holders,
  people,
  links,
  canLink,
  draft,
  onSaved,
  currency,
}: {
  projectId: string;
  date: string;
  currency: string;
  holders: { name: string; shares: string; bps: string }[];
  people: { userId: string; name: string; role: string }[];
  links: { userId: string; holder: string }[];
  canLink: boolean;
  draft: { holder: string; linkUserId: string } | null;
  onSaved: () => Promise<void>;
}) {
  const [holder, setHolder] = useState(draft?.holder ?? "");
  const [linkUserId, setLinkUserId] = useState(draft?.linkUserId ?? "");
  const [shares, setShares] = useState("");
  const [amount, setAmount] = useState("");
  const [investment, setInvestment] = useState("5000000");
  const [preMoney, setPreMoney] = useState("45000000");
  const [sim, setSim] = useState<string | null>(null);
  const [setup, setSetup] = useState(holders.length > 0 || Boolean(draft));
  useEffect(() => {
    if (!draft) return;
    setHolder(draft.holder);
    setLinkUserId(draft.linkUserId);
    setSetup(true);
  }, [draft]);
  return (
    <div className="space-y-3">
      {holders.length > 0 && (
        <div className="divide-y divide-border/60">
          {holders.map((row) => {
            const linkedUser = links.find((link) => link.holder === row.name)?.userId ?? "";
            return (
              <div key={row.name} className="py-2">
                <p className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{row.name}</span>
                  <span className="tabular">{row.shares} · {(Number(row.bps) / 100).toFixed(2)}%</span>
                </p>
                {canLink && (
                  <select
                    className="mt-2 h-11 w-full rounded-md bg-secondary px-3 text-sm"
                    aria-label={`Link ${row.name} to a team login`}
                    value={linkedUser}
                    onChange={async (event) => {
                      const linkUserId = event.target.value;
                      if (!linkUserId) return;
                      try {
                        await linkBusinessStakeholder({ data: { projectId, holder: row.name, linkUserId } });
                        toast.success("Linked. The percent still comes from shares.");
                        await onSaved();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Couldn't link");
                      }
                    }}
                  >
                    <option value="">Not linked to a login</option>
                    {people.map((person) => (
                      <option key={person.userId} value={person.userId}>{person.name} · {person.role}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!setup && (
        <Button type="button" className="h-11" onClick={() => setSetup(true)}>Set up ownership</Button>
      )}
      {setup && (
      <>
      <form
        className="grid gap-3 rounded-xl bg-card p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await postBusinessShares({
              data: { projectId, holder, shares: Number(shares), amount: amount || null, date, linkUserId: linkUserId || null },
            });
            setHolder("");
            setLinkUserId("");
            setShares("");
            setAmount("");
            toast.success("Issuance recorded");
            await onSaved();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't issue");
          }
        }}
      >
        <Label htmlFor="holder">Shareholder</Label>
        <Input id="holder" value={holder} onChange={(event) => setHolder(event.target.value)} />
        <Label htmlFor="share-link">Link to a team login, optional</Label>
        <select id="share-link" className="h-11 rounded-md bg-secondary px-3" value={linkUserId} onChange={(event) => setLinkUserId(event.target.value)}>
          <option value="">No login link</option>
          {people.map((person) => (
            <option key={person.userId} value={person.userId}>{person.name} · {person.role}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Linking does not issue shares. Percent comes from the share count you save here.</p>
        <Label htmlFor="shares">Shares</Label>
        <Input id="shares" inputMode="numeric" value={shares} onChange={(event) => setShares(event.target.value)} />
        <Label htmlFor="paid-in">Amount paid in, optional</Label>
        <Input id="paid-in" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Button type="submit" className="h-11">Issue shares</Button>
      </form>
      <form
        className="grid gap-3 rounded-xl bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const round = simulateRound(
              holders.map((row) => ({ name: row.name, shares: BigInt(row.shares) })),
              toCents(investment),
              toCents(preMoney),
            );
            setSim(`${round.holders.map((row) => `${row.name} ${(Number(row.bps) / 100).toFixed(2)}%`).join(" · ")}. Post-money ${formatMoney(fromCents(round.postMoney), currency)}. Not saved.`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Can't simulate");
          }
        }}
      >
        <p className="text-sm font-medium">Dilution simulator</p>
        <p className="text-sm text-muted-foreground">This does not change the cap table.</p>
        <Label htmlFor="invest">Investment</Label>
        <Input id="invest" value={investment} onChange={(event) => setInvestment(event.target.value)} />
        <Label htmlFor="pre">Pre-money valuation</Label>
        <Input id="pre" value={preMoney} onChange={(event) => setPreMoney(event.target.value)} />
        <Button type="submit" variant="secondary">Simulate</Button>
        {sim && <p className="text-sm">{sim}</p>}
      </form>
      </>
      )}
    </div>
  );
}

