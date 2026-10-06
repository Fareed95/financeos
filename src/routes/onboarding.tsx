import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { BrandLoader } from "@/components/brand-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getBootstrap, updateProfile } from "@/lib/server/bootstrap";
import { upsertAccount } from "@/lib/server/accounts";
import { upsertBudget } from "@/lib/server/budgets";
import { ACCOUNT_TYPE_LABELS, CURRENCY_LABELS } from "@/lib/constants";
import { CURRENCIES, type AccountType } from "@/lib/types";
import { endOfMonthISO, startOfMonthISO } from "@/lib/utils";
import { consumeReturn } from "@/lib/return-to";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

function Onboarding() {
  const { user, isPending } = useCurrentUserState();
  const qc = useQueryClient();
  const from = startOfMonthISO();
  const to = endOfMonthISO();
  const query = useQuery({
    queryKey: ["bootstrap", from, to, user?.id],
    enabled: Boolean(user),
    queryFn: () =>
      getBootstrap({ data: { from, to, displayName: user?.displayName ?? user?.primaryEmail ?? null } }),
  });

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [accountName, setAccountName] = useState("UPI");
  const [accountType, setAccountType] = useState<AccountType>("upi");
  const [opening, setOpening] = useState("0");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const sent = useRef(false);
  const needsAccount = (query.data?.accounts.length ?? 0) === 0;
  const readyToLeave = Boolean(query.data?.profile.onboardingCompleted && !needsAccount);

  useEffect(() => {
    if (!readyToLeave || sent.current) return;
    sent.current = true;
    const back = consumeReturn();
    window.location.replace(back ?? "/");
  }, [readyToLeave]);

  if (isPending || (user && query.isPending) || readyToLeave) {
    return <BrandLoader />;
  }
  if (!user) return <RedirectToSignIn />;

  function goNext() {
    const back = consumeReturn();
    window.location.href = back ?? "/";
  }

  async function saveAccount() {
    const account = accountName.trim();
    if (!account) throw new Error("Add an account. You can't log money without one.");
    await upsertAccount({
      data: {
        name: account,
        type: accountType,
        openingBalance: opening || "0",
        currency,
      },
    });
  }

  async function finish() {
    setBusy(true);
    try {
      await updateProfile({
        data: {
          fullName: name.trim() || query.data?.profile.fullName || user?.displayName || undefined,
          currency,
          onboardingCompleted: true,
        },
      });
      if (needsAccount) await saveAccount();
      if (budget.trim()) {
        await upsertBudget({
          data: {
            name: `${new Date().toLocaleString("en-IN", { month: "long" })} budget`,
            amount: budget,
            period: "monthly",
            startDate: from,
            endDate: to,
          },
        });
      }
      await qc.invalidateQueries();
      goNext();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't finish setup");
      setBusy(false);
    }
  }

  async function saveAccountOnly() {
    setBusy(true);
    try {
      await saveAccount();
      await qc.invalidateQueries();
      goNext();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that account");
      setBusy(false);
    }
  }

  const steps = [
    {
      title: "What should we call you?",
      body: (
        <div className="grid gap-1.5">
          <Label htmlFor="ob-name">Name</Label>
          <Input
            id="ob-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={user.displayName ?? "Your name"}
          />
        </div>
      ),
    },
    {
      title: "Home currency",
      body: (
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c} — {CURRENCY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      title: "First account",
      body: (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">Required. Money needs a place to land — UPI, bank, or cash.</p>
          <div className="grid gap-1.5">
            <Label htmlFor="ob-acc">Name</Label>
            <Input id="ob-acc" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={accountType} onValueChange={(v) => setAccountType(v as AccountType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ob-open">Opening balance</Label>
            <Input id="ob-open" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </div>
        </div>
      ),
    },
    {
      title: "Monthly budget",
      body: (
        <div className="grid gap-1.5">
          <Label htmlFor="ob-budget">Optional</Label>
          <Input
            id="ob-budget"
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="e.g. 40000"
          />
          <p className="text-xs text-muted-foreground">You can set this later.</p>
        </div>
      ),
    },
  ];

  const current = steps[step]!;
  const accountOnly = query.data?.profile.onboardingCompleted && needsAccount;

  if (accountOnly) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
        <p className="font-display text-2xl tracking-tight">Kharcha</p>
        <h1 className="mt-8 font-display text-3xl tracking-tight">Add an account</h1>
        <p className="mt-2 text-sm text-muted-foreground">You need one account before you can log money.</p>
        <div className="mt-6">{steps[2]!.body}</div>
        <Button type="button" className="mt-8" disabled={busy} onClick={() => void saveAccountOnly()}>
          {busy ? "Saving…" : "Save account"}
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <p className="font-display text-2xl tracking-tight">Kharcha</p>
      <p className="mt-8 text-xs tracking-wide text-muted-foreground uppercase">
        Step {step + 1} of {steps.length}
      </p>
      <h1 className="mt-2 font-display text-3xl tracking-tight">{current.title}</h1>
      <div className="mt-6">{current.body}</div>
      <div className="mt-8 flex gap-2">
        {step > 0 && (
          <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button
            type="button"
            className="flex-1"
            onClick={() => {
              if (step === 2 && needsAccount && !accountName.trim()) {
                toast.error("Add an account. You can't log money without one.");
                return;
              }
              setStep(step + 1);
            }}
          >
            Continue
          </Button>
        ) : (
          <Button type="button" className="flex-1" disabled={busy} onClick={() => void finish()}>
            {busy ? "Saving…" : "Get started"}
          </Button>
        )}
      </div>
    </main>
  );
}
