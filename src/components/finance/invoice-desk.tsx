import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INDIA_STATES } from "@/lib/gst";
import { formatMoney, isZero } from "@/lib/money";
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

export function InvoiceDesk({ projectId, currency, startSetup = false }: { projectId: string; currency: string; startSetup?: boolean }) {
  const today = todayISO();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["invoices", projectId, today], queryFn: () => getInvoiceDesk({ data: { projectId, today } }) });
  const [panel, setPanel] = useState<"none" | "seller" | "customer" | "draft">(startSetup ? "seller" : "none");
  useEffect(() => {
    if (startSetup) setPanel("seller");
  }, [startSetup]);
  useEffect(() => {
    const open = () => setPanel("draft");
    window.addEventListener("kharcha-new-invoice", open);
    return () => window.removeEventListener("kharcha-new-invoice", open);
  }, []);
  async function reload() {
    await qc.invalidateQueries({ queryKey: ["invoices", projectId] });
    await qc.invalidateQueries({ queryKey: ["business", projectId] });
  }
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading invoices…</p>;
  if (!q.data) return <p className="text-sm text-expense">Couldn't load invoices.</p>;
  const data = q.data;
  const sellerState = INDIA_STATES.find((state) => state.code === data.seller.stateCode)?.name;
  const quiet = data.invoices.length === 0 && isZero(data.aging.receivable);
  return (
    <div className="space-y-4">
      {!quiet && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="To collect" value={formatMoney(data.aging.receivable, currency, { compact: true })} />
          <Stat label="Overdue" value={formatMoney(data.aging.d30, currency, { compact: true })} />
          <Stat label="Older" value={formatMoney(data.aging.d60, currency, { compact: true })} />
        </div>
      )}
      {quiet && panel === "none" && (
        <div className="rounded-xl bg-card px-4 py-4">
          <p className="font-medium">No sales yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Issue an invoice when someone owes you. A draft does not change the books.</p>
        </div>
      )}
      {data.invoices.map((invoice) => {
        const tax = [invoice.cgst, invoice.sgst, invoice.igst].some((value) => !isZero(value));
        const what = invoice.lines.map((line) => line.description).filter(Boolean).join(", ");
        return (
        <article key={invoice.id} className="rounded-xl bg-card px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{invoice.customerName}</p>
              <p className="truncate text-sm text-muted-foreground">{what || invoice.number}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-medium tabular">{formatMoney(invoice.total, currency, { compact: true })}</p>
              <p className="text-xs capitalize text-muted-foreground">{invoice.displayStatus.replaceAll("_", " ")}</p>
            </div>
          </div>
          {tax && (
            <p className="mt-2 text-xs text-muted-foreground">
              CGST {formatMoney(invoice.cgst, currency, { compact: true })} · SGST {formatMoney(invoice.sgst, currency, { compact: true })} · IGST {formatMoney(invoice.igst, currency, { compact: true })}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            {invoice.status === "draft" && (
              <Button
                type="button"
                className="h-10"
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
        );
      })}
      {panel === "draft" && (
        <DraftForm
          projectId={projectId}
          today={today}
          customers={data.customers}
          sellerState={data.seller.stateCode}
          onSaved={async () => { await reload(); setPanel("none"); }}
          onClose={() => setPanel("none")}
        />
      )}
      {panel === "seller" && (
        <SellerForm projectId={projectId} seller={data.seller} onSaved={async () => { await reload(); setPanel("none"); }} onClose={() => setPanel("none")} />
      )}
      {panel === "customer" && (
        <CustomerForm projectId={projectId} onSaved={async () => { await reload(); setPanel("none"); }} onClose={() => setPanel("none")} />
      )}
      {panel === "none" && (
        <>
          <Button type="button" className="h-11" onClick={() => setPanel("draft")}>Create invoice</Button>
          <div className="overflow-hidden rounded-xl bg-card">
            <button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-border/50 px-3 text-left" onClick={() => setPanel("seller")}>
              <span>
                <span className="block text-sm font-medium">Seller</span>
                <span className="block text-xs text-muted-foreground">{sellerState || "Add your state"}{data.seller.gstin ? ` · ${data.seller.gstin}` : ""}</span>
              </span>
              <span className="text-muted-foreground" aria-hidden="true">›</span>
            </button>
            <button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 px-3 text-left" onClick={() => setPanel("customer")}>
              <span>
                <span className="block text-sm font-medium">Customers</span>
                <span className="block text-xs text-muted-foreground">{data.customers.length === 0 ? "None yet" : `${data.customers.length} saved`}</span>
              </span>
              <span className="text-muted-foreground" aria-hidden="true">›</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-medium tabular">{value}</p>
    </div>
  );
}

function SellerForm({
  projectId,
  seller,
  onSaved,
  onClose,
}: {
  projectId: string;
  seller: { legalName: string; stateCode: string | null; gstin: string | null; pan: string | null };
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [stateCode, setStateCode] = useState(seller.stateCode || "MH");
  const [gstin, setGstin] = useState(seller.gstin || "");
  return (
    <form
      className="overflow-hidden rounded-xl bg-card"
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
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="font-medium">Your business</p>
        <button type="button" className="text-sm text-muted-foreground" onClick={onClose}>Close</button>
      </div>
      <p className="px-4 pb-3 text-xs text-muted-foreground">State picks CGST+SGST or IGST. This is not a GST return.</p>
      <label className="block border-t border-border/60 px-4 py-3">
        <span className="text-[11px] text-muted-foreground">State</span>
        <select className="mt-1 h-11 w-full bg-transparent text-base outline-none" value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
          {INDIA_STATES.map((state) => (
            <option key={state.code} value={state.code}>{state.name}</option>
          ))}
        </select>
      </label>
      <label className="block border-t border-border/60 px-4 py-3">
        <span className="text-[11px] text-muted-foreground">GSTIN, if you have one</span>
        <Input id="gstin" value={gstin} onChange={(event) => setGstin(event.target.value)} placeholder="Optional" className="mt-1 h-11 bg-transparent px-0 shadow-none focus-visible:shadow-none" />
      </label>
      <div className="border-t border-border/60 p-3">
        <Button type="submit" className="h-11 w-full">Save</Button>
      </div>
    </form>
  );
}

function CustomerForm({ projectId, onSaved, onClose }: { projectId: string; onSaved: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("MH");
  return (
    <form
      className="overflow-hidden rounded-xl bg-card"
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
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="font-medium">Customer</p>
        <button type="button" className="text-sm text-muted-foreground" onClick={onClose}>Close</button>
      </div>
      <label className="mt-3 block border-t border-border/60 px-4 py-3">
        <span className="text-[11px] text-muted-foreground">Name</span>
        <Input id="cname" value={name} onChange={(event) => setName(event.target.value)} placeholder="Who you bill" className="mt-1 h-11 bg-transparent px-0 shadow-none focus-visible:shadow-none" />
      </label>
      <label className="block border-t border-border/60 px-4 py-3">
        <span className="text-[11px] text-muted-foreground">State</span>
        <select className="mt-1 h-11 w-full bg-transparent text-base outline-none" value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
          {INDIA_STATES.map((state) => (
            <option key={state.code} value={state.code}>{state.name}</option>
          ))}
        </select>
      </label>
      <div className="border-t border-border/60 p-3">
        <Button type="submit" className="h-11 w-full">Save customer</Button>
      </div>
    </form>
  );
}

function DraftForm({
  projectId,
  today,
  customers,
  sellerState,
  onSaved,
  onClose,
}: {
  projectId: string;
  today: string;
  customers: { id: string; name: string; state_code: string | null }[];
  sellerState: string | null;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [customerName, setCustomerName] = useState("");
  const [description, setDescription] = useState("");
  const [rate, setRate] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [place, setPlace] = useState(sellerState || "MH");
  return (
    <form
      id="new-invoice"
      className="overflow-hidden rounded-xl bg-card"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          let id = customerId;
          if (!id) {
            const name = customerName.trim();
            if (!name) throw new Error("Who is this invoice for?");
            const created = await saveBusinessCustomer({ data: { projectId, name, stateCode: place } });
            id = created?.id || "";
          }
          if (!id) throw new Error("Couldn't add that customer");
          const saved = await saveBusinessDraft({
            data: {
              projectId,
              customerId: id,
              issueDate: today,
              placeOfSupply: place,
              items: [{ description: description.trim() || "Services", quantity: "1", rate, gstRate, revenueCode: "4100" }],
            },
          });
          toast.success(saved?.treatment === "incomplete" ? "Draft saved. Add state before you issue it." : `Draft saved. ${saved?.treatment === "inter" ? "IGST" : "CGST + SGST"} calculated. Not posted yet.`);
          await onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't save the draft");
        }
      }}
    >
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="font-medium">New invoice</p>
        <button type="button" className="text-sm text-muted-foreground" onClick={onClose}>Close</button>
      </div>
      <p className="px-4 pb-3 text-xs text-muted-foreground">Nothing hits the books until you issue it.</p>
      <label className="block border-t border-border/60 px-4 py-3">
        <span className="text-[11px] text-muted-foreground">What is it</span>
        <Input id="desc" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Design, software, consulting" className="mt-1 h-11 bg-transparent px-0 shadow-none focus-visible:shadow-none" />
      </label>
      <label className="block border-t border-border/60 px-4 py-3">
        <span className="text-[11px] text-muted-foreground">Amount</span>
        <Input id="rate" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="0" className="mt-1 h-11 bg-transparent px-0 shadow-none focus-visible:shadow-none" />
      </label>
      {customers.length > 0 && (
        <label className="block border-t border-border/60 px-4 py-3">
          <span className="text-[11px] text-muted-foreground">Customer</span>
          <select className="mt-1 h-11 w-full bg-transparent text-base outline-none" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
            <option value="">Someone new</option>
          </select>
        </label>
      )}
      {!customerId && (
        <label className="block border-t border-border/60 px-4 py-3">
          <span className="text-[11px] text-muted-foreground">Customer</span>
          <Input id="cname" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Name" className="mt-1 h-11 bg-transparent px-0 shadow-none focus-visible:shadow-none" />
        </label>
      )}
      <div className="border-t border-border/60 px-4 py-3">
        <p className="text-[11px] text-muted-foreground">GST</p>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {[0, 5, 12, 18, 28].map((rateOption) => (
            <button
              key={rateOption}
              type="button"
              className={`h-10 rounded-md text-sm ${gstRate === rateOption ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}
              onClick={() => setGstRate(rateOption)}
            >
              {rateOption}%
            </button>
          ))}
        </div>
      </div>
      <label className="block border-t border-border/60 px-4 py-3">
        <span className="text-[11px] text-muted-foreground">Place of supply</span>
        <select className="mt-1 h-11 w-full bg-transparent text-base outline-none" value={place} onChange={(event) => setPlace(event.target.value)}>
          {INDIA_STATES.map((state) => (
            <option key={state.code} value={state.code}>{state.name}</option>
          ))}
        </select>
      </label>
      <div className="border-t border-border/60 p-3">
        <Button type="submit" className="h-11 w-full">Save draft</Button>
      </div>
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
