import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INDIA_STATES } from "@/lib/gst";
import { finishBusinessSetup } from "@/lib/server/biz-team";
import { postBusinessCapital } from "@/lib/server/business";
import { todayISO } from "@/lib/utils";

const KINDS = ["Freelancer", "Sole proprietorship", "Partnership", "LLP", "Private limited", "Other"];

export function BusinessSetup({ projectId, name, onDone }: { projectId: string; name: string; onDone: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState("Freelancer");
  const [gst, setGst] = useState("unsure");
  const [stateCode, setStateCode] = useState("MH");
  const [gstin, setGstin] = useState("");
  const [fresh, setFresh] = useState<"new" | "existing">("new");
  const [full, setFull] = useState(false);
  const [amount, setAmount] = useState("");
  const [place, setPlace] = useState("bank");
  const [origin, setOrigin] = useState("founder");
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);

  async function finish(posted: boolean) {
    await finishBusinessSetup({
      data: { projectId, legalName: name, kind, gst, stateCode: gst === "yes" ? stateCode : undefined, gstin: gst === "yes" ? gstin : undefined },
    });
    if (!posted) toast.success("You can add money later.");
    await onDone();
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">Set up {name}</p>
      {step === 0 && (
        <section className="space-y-3 rounded-xl bg-card p-4">
          <h2 className="font-display text-2xl">Tell us about your business</h2>
          <label className="grid gap-1 text-sm">Kind
            <select className="h-11 rounded-md bg-secondary px-3" value={kind} onChange={(event) => setKind(event.target.value)}>
              {KINDS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <p className="text-sm">GST registered?</p>
          <div className="grid grid-cols-3 gap-2">
            {[["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]].map(([value, label]) => (
              <button key={value} type="button" className={`h-11 rounded-md text-sm ${gst === value ? "bg-foreground text-background" : "bg-secondary"}`} onClick={() => setGst(value)}>{label}</button>
            ))}
          </div>
          {gst === "yes" && (
            <>
              <select className="h-11 rounded-md bg-secondary px-3" value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
                {INDIA_STATES.map((state) => <option key={state.code} value={state.code}>{state.name}</option>)}
              </select>
              <Input value={gstin} placeholder="GSTIN" onChange={(event) => setGstin(event.target.value)} />
            </>
          )}
          <Button type="button" className="h-11 w-full" onClick={() => setStep(1)}>Continue</Button>
        </section>
      )}
      {step === 1 && (
        <section className="space-y-3 rounded-xl bg-card p-4">
          <h2 className="font-display text-2xl">Where does the business keep money?</h2>
          <p className="text-sm text-muted-foreground">Bank, cash, and petty cash are already on the books. You can use whichever you actually have.</p>
          <Button type="button" className="h-11 w-full" onClick={() => setStep(2)}>Continue</Button>
          <Button type="button" variant="ghost" className="h-11 w-full" onClick={() => setStep(2)}>Skip</Button>
        </section>
      )}
      {step === 2 && (
        <section className="space-y-3 rounded-xl bg-card p-4">
          <h2 className="font-display text-2xl">Add your starting balance</h2>
          <p className="text-sm text-muted-foreground">Tell us how much money the business is starting with and where it came from. This is not a sale.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`h-11 rounded-md text-sm ${fresh === "new" ? "bg-foreground text-background" : "bg-secondary"}`} onClick={() => setFresh("new")}>New business</button>
            <button type="button" className={`h-11 rounded-md text-sm ${fresh === "existing" ? "bg-foreground text-background" : "bg-secondary"}`} onClick={() => setFresh("existing")}>Existing business</button>
          </div>
          {fresh === "existing" && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Quick setup records only the cash or bank you type. Customers who owe you, bills, and loans are not invented.</p>
              <button type="button" className="underline" onClick={() => setFull((value) => !value)}>{full ? "Use quick setup" : "Set up full opening balances"}</button>
              {full && <p>Enter the bank figure below as what is in the bank today. Receivables and bills can be added as their own records after setup, so we don't guess them.</p>}
            </div>
          )}
          <Input inputMode="decimal" value={amount} placeholder="Amount" onChange={(event) => setAmount(event.target.value)} />
          <label className="grid gap-1 text-sm">Where is the money?
            <select className="h-11 rounded-md bg-secondary px-3" value={place} onChange={(event) => setPlace(event.target.value)}>
              <option value="bank">Bank account</option>
              <option value="cash">Cash</option>
              <option value="other">Other cash</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">Where did it come from?
            <select className="h-11 rounded-md bg-secondary px-3" value={origin} onChange={(event) => setOrigin(event.target.value)}>
              <option value="founder">Founder / owner investment</option>
              <option value="existing">Existing business balance</option>
              <option value="loan">Business loan</option>
              <option value="other">Other</option>
            </select>
          </label>
          <button type="button" className="text-left text-sm text-muted-foreground underline" onClick={() => setDetails((value) => !value)}>View accounting details</button>
          {details && (
            <p className="text-sm text-muted-foreground">
              {origin === "founder" && "Bank or cash goes up. Owner capital goes up by the same amount. Revenue does not."}
              {origin === "existing" && "This is prior money, so it increases retained earnings, not a new share issue and not revenue."}
              {origin === "loan" && "Cash goes up and a loan payable is recorded. It is not income."}
              {origin === "other" && "Cash goes up and additional paid-in capital is recorded. It is not income."}
            </p>
          )}
          <Button
            type="button"
            className="h-11 w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (amount.trim()) {
                  await postBusinessCapital({
                    data: {
                      projectId,
                      amount,
                      date: todayISO(),
                      place,
                      origin: fresh === "existing" && origin === "founder" ? "existing" : origin,
                      kind: "opening",
                    },
                  });
                  toast.success("Starting balance saved. It is not counted as revenue.");
                }
                await finish(Boolean(amount.trim()));
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't save");
                setBusy(false);
              }
            }}
          >
            Start tracking my business
          </Button>
          <Button type="button" variant="ghost" className="h-11 w-full" onClick={() => void finish(false)}>Skip for now</Button>
        </section>
      )}
    </div>
  );
}
