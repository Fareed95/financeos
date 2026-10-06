import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INDIA_STATES } from "@/lib/gst";
import { formatMoney } from "@/lib/money";
import {
  creditBusinessInvoice,
  downloadInvoicePdf,
  getInvoiceDesk,
  issueBusinessInvoice,
  payBusinessInvoice,
  saveBusinessCustomer,
  saveBusinessDraft,
  saveSellerProfile,
} from "@/lib/server/invoices";
import { todayISO } from "@/lib/utils";

export function InvoiceDesk({ projectId, currency }: { projectId: string; currency: string }) {
  const today = todayISO();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["invoices", projectId, today], queryFn: () => getInvoiceDesk({ data: { projectId, today } }) });
  async function reload() {
    await qc.invalidateQueries({ queryKey: ["invoices", projectId] });
    await qc.invalidateQueries({ queryKey: ["business", projectId] });
  }
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading invoices…</p>;
  if (!q.data) return <p className="text-sm text-expense">Couldn't load invoices.</p>;
  const data = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Receivable" value={formatMoney(data.aging.receivable, currency)} />
        <Stat label="Current" value={formatMoney(data.aging.current, currency)} />
        <Stat label="1–30 overdue" value={formatMoney(data.aging.d30, currency)} />
        <Stat label="31+ overdue" value={formatMoney(data.aging.d60, currency)} />
      </div>
      <SellerForm projectId={projectId} seller={data.seller} onSaved={reload} />
      <CustomerForm projectId={projectId} onSaved={reload} />
      <DraftForm projectId={projectId} today={today} customers={data.customers} sellerState={data.seller.stateCode} onSaved={reload} />
      {data.invoices.map((invoice) => (
        <article key={invoice.id} className="rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-medium">{invoice.number}</h3>
            <p className="text-xs capitalize text-muted-foreground">{invoice.displayStatus.replaceAll("_", " ")}</p>
          </div>
          <p className="text-sm text-muted-foreground">{invoice.customerName}</p>
          <p className="mt-1 tabular">{formatMoney(invoice.total, currency)}</p>
          <p className="text-xs text-muted-foreground">
            CGST {formatMoney(invoice.cgst, currency)} · SGST {formatMoney(invoice.sgst, currency)} · IGST {formatMoney(invoice.igst, currency)} · Due {formatMoney(invoice.balance, currency)}
          </p>
          {invoice.lines[0] && <p className="mt-1 text-sm">{invoice.lines.map((line) => line.description).join(", ")}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {invoice.status === "draft" && (
              <Button
                type="button"
                className="h-11"
                onClick={async () => {
                  if (!window.confirm("Issue this invoice? The number is locked and the books are posted.")) return;
                  try {
                    await issueBusinessInvoice({ data: { projectId, invoiceId: invoice.id } });
                    toast.success("Issued. GST is in tax payable, not in revenue.");
                    await reload();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Couldn't issue");
                  }
                }}
              >
                Issue
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              className="h-11"
              onClick={async () => {
                try {
                  const file = await downloadInvoicePdf({ data: { projectId, invoiceId: invoice.id } });
                  if (!file?.pdf) return;
                  const link = document.createElement("a");
                  link.href = `data:application/pdf;base64,${file.pdf}`;
                  link.download = `${invoice.number.replaceAll("/", "-")}.pdf`;
                  link.click();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Couldn't build the PDF");
                }
              }}
            >
              PDF
            </Button>
          </div>
          {invoice.status !== "draft" && invoice.status !== "cancelled" && invoice.balance !== "0.00" && (
            <PaymentForm projectId={projectId} invoiceId={invoice.id} today={today} balance={invoice.balance} onSaved={reload} />
          )}
        </article>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card p-4">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-display text-xl tabular">{value}</p>
    </div>
  );
}

function SellerForm({
  projectId,
  seller,
  onSaved,
}: {
  projectId: string;
  seller: { legalName: string; stateCode: string | null; gstin: string | null; pan: string | null };
  onSaved: () => Promise<void>;
}) {
  const [stateCode, setStateCode] = useState(seller.stateCode || "MH");
  const [gstin, setGstin] = useState(seller.gstin || "");
  return (
    <form
      className="grid gap-3 rounded-xl bg-card p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await saveSellerProfile({ data: { projectId, legalName: seller.legalName, stateCode, gstin } });
          toast.success("Seller profile saved");
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't save");
        }
      }}
    >
      <p className="text-sm font-medium">Seller</p>
      <p className="text-sm text-muted-foreground">State decides CGST+SGST or IGST. This is not a GST filing.</p>
      <Label>State</Label>
      <select className="h-11 rounded-md bg-secondary px-3" value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
        {INDIA_STATES.map((state) => (
          <option key={state.code} value={state.code}>{state.name}</option>
        ))}
      </select>
      <Label htmlFor="gstin">GSTIN</Label>
      <Input id="gstin" value={gstin} onChange={(event) => setGstin(event.target.value)} />
      <Button type="submit" variant="secondary">Save seller</Button>
    </form>
  );
}

function CustomerForm({ projectId, onSaved }: { projectId: string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("MH");
  return (
    <form
      className="grid gap-3 rounded-xl bg-card p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await saveBusinessCustomer({ data: { projectId, name, stateCode } });
          setName("");
          toast.success("Customer saved");
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't save");
        }
      }}
    >
      <p className="text-sm font-medium">Customer</p>
      <Label htmlFor="cname">Name</Label>
      <Input id="cname" value={name} onChange={(event) => setName(event.target.value)} />
      <Label>State</Label>
      <select className="h-11 rounded-md bg-secondary px-3" value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
        {INDIA_STATES.map((state) => (
          <option key={state.code} value={state.code}>{state.name}</option>
        ))}
      </select>
      <Button type="submit" variant="secondary">Add customer</Button>
    </form>
  );
}

function DraftForm({
  projectId,
  today,
  customers,
  sellerState,
  onSaved,
}: {
  projectId: string;
  today: string;
  customers: { id: string; name: string; state_code: string | null }[];
  sellerState: string | null;
  onSaved: () => Promise<void>;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [description, setDescription] = useState("Software Development");
  const [rate, setRate] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [place, setPlace] = useState(sellerState || "MH");
  return (
    <form
      className="grid gap-3 rounded-xl bg-card p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          const saved = await saveBusinessDraft({
            data: {
              projectId,
              customerId,
              issueDate: today,
              placeOfSupply: place,
              items: [{ description, quantity: "1", rate, gstRate, revenueCode: "4100" }],
            },
          });
          toast.success(saved?.treatment === "incomplete" ? "Draft saved. Add state before you issue it." : `Draft saved. ${saved?.treatment === "inter" ? "IGST" : "CGST + SGST"} calculated. Not posted yet.`);
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't save the draft");
        }
      }}
    >
      <p className="text-sm font-medium">New draft</p>
      <p className="text-sm text-muted-foreground">Nothing hits the books until you issue it.</p>
      <Label>Customer</Label>
      <select className="h-11 rounded-md bg-secondary px-3" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
        {customers.length === 0 && <option value="">Add a customer first</option>}
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>{customer.name}</option>
        ))}
      </select>
      <Label>Place of supply</Label>
      <select className="h-11 rounded-md bg-secondary px-3" value={place} onChange={(event) => setPlace(event.target.value)}>
        {INDIA_STATES.map((state) => (
          <option key={state.code} value={state.code}>{state.name}</option>
        ))}
      </select>
      <Label htmlFor="desc">Description</Label>
      <Input id="desc" value={description} onChange={(event) => setDescription(event.target.value)} />
      <Label htmlFor="rate">Rate</Label>
      <Input id="rate" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} />
      <Label>GST %</Label>
      <select className="h-11 rounded-md bg-secondary px-3" value={gstRate} onChange={(event) => setGstRate(Number(event.target.value))}>
        {[0, 5, 12, 18, 28].map((rateOption) => (
          <option key={rateOption} value={rateOption}>{rateOption}</option>
        ))}
      </select>
      <Button type="submit">Save draft</Button>
    </form>
  );
}

function PaymentForm({
  projectId,
  invoiceId,
  today,
  balance,
  onSaved,
}: {
  projectId: string;
  invoiceId: string;
  today: string;
  balance: string;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState("upi");
  const [accountCode, setAccountCode] = useState("1010");
  const [reference, setReference] = useState("");
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await payBusinessInvoice({ data: { projectId, invoiceId, amount, date: today, method, accountCode, reference } });
          toast.success("Payment posted to the account you chose. Revenue was not added again.");
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't record the payment");
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Input value={amount} onChange={(event) => setAmount(event.target.value)} />
        <select className="h-11 rounded-md bg-secondary px-3" value={method} onChange={(event) => setMethod(event.target.value)}>
          {["upi", "bank", "cash", "card", "cheque", "other"].map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>
      <select className="h-11 rounded-md bg-secondary px-3" value={accountCode} onChange={(event) => setAccountCode(event.target.value)}>
        <option value="1010">Bank</option>
        <option value="1000">Cash</option>
        <option value="1020">Petty cash</option>
      </select>
      <Input value={reference} placeholder="UTR or reference" onChange={(event) => setReference(event.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" className="h-11 flex-1">Record payment</Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          onClick={async () => {
            if (!window.confirm("Credit the open balance? This reverses revenue and GST. It does not delete the invoice.")) return;
            try {
              await creditBusinessInvoice({ data: { projectId, invoiceId, amount: balance, date: today, reason: "Credit note" } });
              toast.success("Credit note posted");
              await onSaved();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't credit");
            }
          }}
        >
          Credit note
        </Button>
      </div>
    </form>
  );
}
