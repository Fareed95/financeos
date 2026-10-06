import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { rupeesInWords } from "@/lib/gst";
import { toCents } from "@/lib/money";

type Detail = {
  number: string;
  customerName: string;
  issueDate: string;
  dueDate: string | null;
  displayStatus: string;
  total: string;
  amountPaid: string;
  balance: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  placeOfSupply: string | null;
  notes: string | null;
  terms: string | null;
  lines: { description: string; hsnSac: string | null; quantity: string; rate: string; gstRate: number; taxable: string; total: string }[];
};

type Seller = {
  legal_name: string;
  state_code: string | null;
  state_name: string | null;
  gstin: string | null;
  pan: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  postal_code: string | null;
  invoice_terms: string | null;
  upi_id: string | null;
  bank_holder: string | null;
  bank_name: string | null;
  bank_account_masked: string | null;
  bank_ifsc: string | null;
};

export async function buildInvoicePdf(input: { detail: Detail; seller: Seller }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.12);
  const muted = rgb(0.4, 0.4, 0.4);
  let y = 800;
  const draw = (text: string, x: number, size: number, face = font, color = ink) => {
    page.drawText(text.slice(0, 110), { x, y, size, font: face, color });
  };
  draw(input.detail.displayStatus === "draft" ? "PROFORMA" : "TAX INVOICE", 48, 16, bold);
  y -= 22;
  draw(input.seller.legal_name, 48, 12, bold);
  y -= 16;
  const address = [input.seller.address_line1, input.seller.city, input.seller.state_name, input.seller.postal_code].filter(Boolean).join(", ");
  if (address) {
    draw(address, 48, 9, font, muted);
    y -= 14;
  }
  if (input.seller.gstin) {
    draw(`GSTIN ${input.seller.gstin}`, 48, 9);
    y -= 14;
  }
  if (input.seller.pan) {
    draw(`PAN ${input.seller.pan}`, 48, 9);
    y -= 14;
  }
  y -= 10;
  draw(input.detail.number, 48, 12, bold);
  draw(input.detail.issueDate, 360, 10);
  y -= 16;
  draw(`Bill to ${input.detail.customerName}`, 48, 10);
  y -= 14;
  if (input.detail.placeOfSupply) {
    draw(`Place of supply ${input.detail.placeOfSupply}`, 48, 9, font, muted);
    y -= 14;
  }
  if (input.detail.dueDate) {
    draw(`Due ${input.detail.dueDate}`, 48, 9, font, muted);
    y -= 16;
  }
  y -= 8;
  draw("Description", 48, 8, bold, muted);
  draw("HSN", 250, 8, bold, muted);
  draw("Qty", 320, 8, bold, muted);
  draw("GST", 380, 8, bold, muted);
  draw("Amount", 470, 8, bold, muted);
  y -= 14;
  for (const line of input.detail.lines) {
    draw(line.description, 48, 9);
    draw(line.hsnSac || "—", 250, 9);
    draw(line.quantity, 320, 9);
    draw(`${line.gstRate}%`, 380, 9);
    draw(line.total, 470, 9);
    y -= 16;
    if (y < 160) break;
  }
  y -= 8;
  draw(`Taxable ${input.detail.taxable}`, 48, 10);
  y -= 14;
  draw(`CGST ${input.detail.cgst}   SGST ${input.detail.sgst}   IGST ${input.detail.igst}`, 48, 10);
  y -= 16;
  draw(`Total ${input.detail.total}`, 48, 12, bold);
  y -= 16;
  draw(`Paid ${input.detail.amountPaid}   Balance ${input.detail.balance}`, 48, 10);
  y -= 18;
  draw(rupeesInWords(toCents(input.detail.total)), 48, 9, font, muted);
  y -= 20;
  if (input.seller.upi_id) {
    draw(`UPI ${input.seller.upi_id}`, 48, 9);
    y -= 14;
  }
  if (input.seller.bank_name || input.seller.bank_account_masked) {
    draw([input.seller.bank_holder, input.seller.bank_name, input.seller.bank_account_masked, input.seller.bank_ifsc].filter(Boolean).join(" · "), 48, 8, font, muted);
    y -= 14;
  }
  const terms = input.detail.terms || input.seller.invoice_terms;
  if (terms) draw(terms, 48, 8, font, muted);
  return doc.save();
}
