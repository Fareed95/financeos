/**
 * Authenticated HTTP audit of business finance permissions, invites, and races.
 * Prints a JSON summary. Exits non-zero if a check fails.
 */
import { writeFileSync } from "node:fs";
import { toJSONAsync, fromCrossJSON } from "seroval";

const base = process.env.AUDIT_BASE || "http://127.0.0.1:8080";
const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);
const report = [];

function record(name, pass, expected, actual) {
  report.push({ name, pass, expected, actual: typeof actual === "string" ? actual.slice(0, 240) : actual });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
}

async function signUp(name) {
  const email = `${name.toLowerCase()}-${stamp}@audit.example`;
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ name, email, password: "audit-pass-123" }),
  });
  const raw = await res.text();
  const cookies = (res.headers.getSetCookie?.() ?? []).map((cookie) => cookie.split(";")[0]).join("; ");
  const json = JSON.parse(raw);
  if (res.status !== 200 || !json.user?.id) throw new Error(`signup ${name} ${res.status} ${raw.slice(0, 200)}`);
  return { name, id: json.user.id, cookie: cookies, email };
}

async function loadIds(path) {
  const text = await (await fetch(`${base}${path}`)).text();
  const map = {};
  const re = /export const (\w+) = createServerFn\b[\s\S]*?\.handler\(createClientRpc\("([^"]+)"\)\)/g;
  for (const match of text.matchAll(re)) map[match[1]] = match[2];
  return map;
}

async function call(id, cookie, data) {
  const body = JSON.stringify(await toJSONAsync({ data }));
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    "x-tsr-serverFn": "true",
    origin: base,
    "sec-fetch-site": "same-origin",
  };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}/_serverFn/${id}`, { method: "POST", headers, body });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = fromCrossJSON(JSON.parse(text), { plugins: [] });
  } catch {
    parsed = null;
  }
  const error = parsed?.error;
  const message =
    (error && typeof error === "object" && "message" in error && String(error.message)) ||
    (typeof error === "string" ? error : "") ||
    (res.status >= 400 ? text.slice(0, 240) : "");
  const ok = res.status === 200 && parsed && error == null && parsed.result !== undefined;
  return { status: res.status, ok, message, result: parsed?.result ?? null };
}

const ids = {
  ...(await loadIds("/src/lib/server/projects.ts")),
  ...(await loadIds("/src/lib/server/business.ts")),
  ...(await loadIds("/src/lib/server/ops.ts")),
  ...(await loadIds("/src/lib/server/biz-team.ts")),
  ...(await loadIds("/src/lib/server/collab.ts")),
  ...(await loadIds("/src/lib/server/invoices.ts")),
};

const owner = await signUp("Owner");
const accountant = await signUp("Accountant");
const member = await signUp("Member");
const viewer = await signUp("Viewer");
const attacker = await signUp("Attacker");
const rival = await signUp("Rival");
const outsider = await signUp("Outsider");

const project = await call(ids.upsertProject, owner.cookie, {
  name: "Munafa Audit",
  projectType: "business",
  budget: "0",
  status: "active",
  startDate: today,
});
if (!project.ok) throw new Error(`project ${project.message}`);
const projectId = project.result.id;

const loaded = await call(ids.getBusiness, owner.cookie, { projectId, today, period: "month" });
record("owner can open the business", loaded.ok, "books", loaded.message || loaded.result?.role);
const setup = await call(ids.finishBusinessSetup, owner.cookie, {
  projectId,
  legalName: "Munafa",
  kind: "services",
  gst: "regular",
  stateCode: "MH",
});
record("owner finishes setup", setup.ok, "ok", setup.message || "ok");
const capital = await call(ids.postBusinessCapital, owner.cookie, {
  projectId,
  amount: "20000",
  date: today,
  place: "cash",
  origin: "founder",
});
record("owner funds ₹20,000", capital.ok, "posted", capital.message || "posted");

const vendor = await call(ids.saveVendor, owner.cookie, {
  projectId,
  displayName: "AWS India",
  vendorType: "company",
  stateCode: "MH",
  gstin: "27AAAAA0000A1Z5",
  paymentTerms: "30",
});
record("vendor persists", vendor.ok && Boolean(vendor.result?.id), "id", vendor.message || vendor.result?.id);
const bill = await call(ids.saveBill, owner.cookie, {
  projectId,
  vendorId: vendor.result.id,
  billDate: today,
  dueDate: "2026-09-01",
  placeOfSupply: "MH",
  expenseCode: "5400",
  description: "Software",
  quantity: "1",
  rate: "10000",
  gstRate: 18,
  post: true,
});
record("AWS bill posts ₹11,800", bill.ok && bill.result?.total === "11800.00", "11800.00", bill.message || bill.result?.total);
const partial = await call(ids.payBill, owner.cookie, {
  projectId,
  billId: bill.result.id,
  amount: "5000",
  date: today,
  method: "cash",
  accountCode: "1000",
});
record("partial payment leaves ₹6,800", partial.ok && partial.result?.balance === "6800.00", "6800.00", partial.message || partial.result?.balance);
const finalPay = await call(ids.payBill, owner.cookie, {
  projectId,
  billId: bill.result.id,
  amount: "6800",
  date: today,
  method: "cash",
  accountCode: "1000",
});
record("final payment clears the payable", finalPay.ok && finalPay.result?.balance === "0.00", "0.00", finalPay.message || finalPay.result?.balance);
const books = await call(ids.getBusiness, owner.cookie, { projectId, today, period: "month" });
const statements = books.result?.statements;
record("cash is ₹8,200 and expense stays ₹10,000", statements?.closingCash === "8200.00" && statements?.opex?.some((row) => row.code === "5400" && row.amount === "10000.00"), "8200 / 10000", `${statements?.closingCash} / ${statements?.opex?.map((row) => row.amount).join(",")}`);
const integrity = await call(ids.checkBooks, owner.cookie, { projectId, today });
record("integrity checker passes", integrity.ok && integrity.result?.ok === true, "ok", integrity.message || JSON.stringify(integrity.result?.issues ?? []));
const detail = await call(ids.getVendorDetail, owner.cookie, { projectId, vendorId: vendor.result.id });
record("vendor detail is stored, not UI state", detail.ok && detail.result?.spent === "10000.00" && detail.result?.due === "0.00", "spent 10000", detail.message || detail.result?.spent);

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const file = await call(ids.addBillAttachment, owner.cookie, {
  projectId,
  billId: bill.result.id,
  fileName: "aws.png",
  mime: "image/png",
  dataUrl: png,
});
record("bill attachment is stored", file.ok, "id", file.message || file.result?.id);

async function invite(role) {
  const created = await call(ids.inviteBusinessMember, owner.cookie, { projectId, role });
  if (!created.ok) throw new Error(`invite ${role} ${created.message}`);
  return created.result.path.split("/").pop();
}

async function join(user, role) {
  const token = await invite(role);
  const preview = await call(ids.previewInvite, user.cookie, { token });
  const accepted = await call(ids.acceptInvite, user.cookie, { token });
  return { token, preview, accepted };
}

const accountantJoin = await join(accountant, "accountant");
record("accountant preview names the business", accountantJoin.preview.ok && accountantJoin.preview.result?.projectName === "Munafa Audit", "Munafa Audit", accountantJoin.preview.message || accountantJoin.preview.result?.projectName);
record("accountant accept succeeds", accountantJoin.accepted.ok, "joined", accountantJoin.accepted.message || "joined");
const again = await call(ids.acceptInvite, rival.cookie, { token: accountantJoin.token });
record("used invite is rejected", !again.ok, "used", again.message);
const forged = await call(ids.previewInvite, attacker.cookie, { token: `${accountantJoin.token.slice(0, -2)}zz` });
record("modified invite token is rejected", !forged.ok, "invalid", forged.message);
const revokedToken = await invite("viewer");
const team = await call(ids.getBusinessTeam, owner.cookie, { projectId });
const openInvite = (team.result?.invites ?? []).find((row) => row.role === "viewer" && row.state === "open");
const revoked = await call(ids.revokeBusinessInvite, owner.cookie, { projectId, inviteId: openInvite?.id });
const revokedAccept = await call(ids.acceptInvite, viewer.cookie, { token: revokedToken });
record("revoked invite cannot be accepted", revoked.ok && !revokedAccept.ok, "revoked", revokedAccept.message);

const memberJoin = await join(member, "member");
const viewerJoin = await join(viewer, "viewer");
record("member joins", memberJoin.accepted.ok, "joined", memberJoin.accepted.message || "joined");
record("viewer joins", viewerJoin.accepted.ok, "joined", viewerJoin.accepted.message || "joined");

const raceToken = await invite("member");
const [raceA, raceB] = await Promise.all([
  call(ids.acceptInvite, rival.cookie, { token: raceToken }),
  call(ids.acceptInvite, attacker.cookie, { token: raceToken }),
]);
record("only one concurrent invite accept wins", Number(raceA.ok) + Number(raceB.ok) === 1, "one winner", `${raceA.ok}/${raceB.ok} ${raceA.message} ${raceB.message}`);

const accountantVendor = await call(ids.saveVendor, accountant.cookie, { projectId, displayName: "Accountant Vendor", stateCode: "MH" });
const accountantBill = await call(ids.saveBill, accountant.cookie, {
  projectId,
  vendorId: accountantVendor.result?.id,
  billDate: today,
  dueDate: today,
  placeOfSupply: "MH",
  expenseCode: "5400",
  description: "Hosting",
  quantity: "1",
  rate: "100",
  gstRate: 0,
  post: true,
});
const accountantPay = await call(ids.payBill, accountant.cookie, {
  projectId,
  billId: accountantBill.result?.id,
  amount: "100",
  date: today,
  method: "bank",
  accountCode: "1010",
});
record("accountant can create, post, and pay a bill", accountantVendor.ok && accountantBill.ok && accountantPay.ok, "allowed", `${accountantVendor.message} ${accountantBill.message} ${accountantPay.message}`);
const accountantReports = await call(ids.checkBooks, accountant.cookie, { projectId, today });
record("accountant can view the integrity report", accountantReports.ok, "ok", accountantReports.message || accountantReports.result?.ok);
const accountantShares = await call(ids.postBusinessShares, accountant.cookie, { projectId, holder: "No", shares: 10, amount: "1", date: today });
const accountantKey = await call(ids.createBusinessApiKey, accountant.cookie, { projectId, name: "nope", environment: "test", scopes: ["reports:read"] });
record("accountant cannot change equity or API keys", !accountantShares.ok && !accountantKey.ok, "denied", `${accountantShares.message} | ${accountantKey.message}`);

const memberVendor = await call(ids.saveVendor, member.cookie, { projectId, displayName: "Member Vendor", stateCode: "MH" });
const memberPay = await call(ids.payBill, member.cookie, {
  projectId,
  billId: bill.result.id,
  amount: "1",
  date: today,
  method: "cash",
  accountCode: "1000",
});
const memberShares = await call(ids.postBusinessShares, member.cookie, { projectId, holder: "No", shares: 1, date: today });
record("member can add a vendor but cannot pay or issue shares", memberVendor.ok && !memberPay.ok && !memberShares.ok, "split", `${memberVendor.ok}/${memberPay.ok}/${memberShares.ok}`);

const viewerRead = await call(ids.getOpsDesk, viewer.cookie, { projectId, today });
const viewerWrite = await call(ids.saveVendor, viewer.cookie, { projectId, displayName: "Nope", stateCode: "MH" });
const viewerFile = await call(ids.readBillAttachment, viewer.cookie, { projectId, attachmentId: file.result.id });
const viewerRemove = await call(ids.removeBillAttachment, viewer.cookie, { projectId, attachmentId: file.result.id });
record("viewer can read the desk and the file", viewerRead.ok && viewerRead.result?.vendors?.some((row) => row.name === "AWS India") && viewerFile.ok, "read", viewerRead.message || viewerFile.message);
record("viewer cannot write or remove a file", !viewerWrite.ok && !viewerRemove.ok, "denied", `${viewerWrite.message} | ${viewerRemove.message}`);

for (const [name, id, data] of [
  ["business", ids.getBusiness, { projectId, today }],
  ["vendors", ids.getOpsDesk, { projectId, today }],
  ["vendor detail", ids.getVendorDetail, { projectId, vendorId: vendor.result.id }],
  ["attachment", ids.readBillAttachment, { projectId, attachmentId: file.result.id }],
  ["reports", ids.checkBooks, { projectId, today }],
  ["team", ids.getBusinessTeam, { projectId }],
  ["api keys", ids.createBusinessApiKey, { projectId, name: "stolen", environment: "live", scopes: ["reports:read"] }],
  ["equity", ids.postBusinessShares, { projectId, holder: "Attacker", shares: 100, date: today }],
  ["pay", ids.payBill, { projectId, billId: bill.result.id, amount: "1", date: today, method: "cash", accountCode: "1000" }],
]) {
  const res = await call(id, outsider.cookie, data);
  record(`attacker cannot reach ${name}`, !res.ok, "denied", res.message || res.status);
}

const beforeRemove = await call(ids.getBusinessTeam, owner.cookie, { projectId });
const accountantMember = (beforeRemove.result?.members ?? []).find((row) => row.role === "accountant");
const removed = await call(ids.removeBusinessMember, owner.cookie, { projectId, memberId: accountantMember?.id });
const after = await call(ids.getBusiness, accountant.cookie, { projectId, today });
const stillThere = await call(ids.getVendorDetail, owner.cookie, { projectId, vendorId: accountantVendor.result.id });
record("removed accountant loses access immediately", removed.ok && !after.ok, "denied", after.message);
record("their vendor record remains", stillThere.ok && stillThere.result?.vendor?.display_name === "Accountant Vendor", "kept", stillThere.message || stillThere.result?.vendor?.display_name);

const raceBill = await call(ids.saveBill, owner.cookie, {
  projectId,
  vendorId: vendor.result.id,
  billDate: today,
  dueDate: today,
  placeOfSupply: "MH",
  expenseCode: "5400",
  description: "Race",
  quantity: "1",
  rate: "100",
  gstRate: 0,
  post: true,
});
const [payA, payB] = await Promise.all([
  call(ids.payBill, owner.cookie, { projectId, billId: raceBill.result.id, amount: "80", date: today, method: "cash", accountCode: "1000" }),
  call(ids.payBill, owner.cookie, { projectId, billId: raceBill.result.id, amount: "80", date: today, method: "cash", accountCode: "1000" }),
]);
record("two ₹80 payments cannot both clear a ₹100 bill", Number(payA.ok) + Number(payB.ok) === 1, "one winner", `${payA.ok} ${payA.result?.balance || payA.message} / ${payB.ok} ${payB.result?.balance || payB.message}`);

const asset = await call(ids.buyAsset, owner.cookie, {
  projectId,
  name: "Laptop",
  category: "Computer",
  date: today,
  cost: "36000",
  residual: "0",
  lifeMonths: 36,
  paid: true,
  accountCode: "1010",
});
const [depA, depB] = await Promise.all([
  call(ids.postAssetDepreciation, owner.cookie, { projectId, assetId: asset.result?.id, date: today }),
  call(ids.postAssetDepreciation, owner.cookie, { projectId, assetId: asset.result?.id, date: today }),
]);
record("depreciation for the same month posts once", Number(depA.ok) + Number(depB.ok) === 1, "one winner", `${depA.message || depA.result?.period} / ${depB.message || depB.result?.period}`);

const second = await call(ids.upsertProject, owner.cookie, {
  name: "Opening Race",
  projectType: "business",
  budget: "0",
  status: "active",
});
await call(ids.getBusiness, owner.cookie, { projectId: second.result.id, today });
await call(ids.finishBusinessSetup, owner.cookie, { projectId: second.result.id, stateCode: "MH" });
const [openA, openB] = await Promise.all([
  call(ids.postFullOpening, owner.cookie, { projectId: second.result.id, date: today, cash: "100", bank: "0", receivable: "0", payable: "0", loan: "0", assets: "0" }),
  call(ids.postFullOpening, owner.cookie, { projectId: second.result.id, date: today, cash: "100", bank: "0", receivable: "0", payable: "0", loan: "0", assets: "0" }),
]);
record("two opening submissions do not both create a new journal", Number(openA.ok) + Number(openB.ok) === 1, "one winner", `${openA.ok} ${openA.message} / ${openB.ok} ${openB.message}`);

const draftRace = await call(ids.saveBill, owner.cookie, {
  projectId,
  vendorId: vendor.result.id,
  billDate: today,
  dueDate: today,
  placeOfSupply: "MH",
  expenseCode: "5400",
  description: "Double post",
  quantity: "1",
  rate: "50",
  gstRate: 0,
  post: false,
});
const [billPostA, billPostB] = await Promise.all([
  call(ids.postBill, owner.cookie, { projectId, billId: draftRace.result?.id }),
  call(ids.postBill, owner.cookie, { projectId, billId: draftRace.result?.id }),
]);
record("two posts of one bill do not both succeed", draftRace.ok && Number(billPostA.ok) + Number(billPostB.ok) === 1, "one winner", `${billPostA.ok} ${billPostA.message || billPostA.result?.status} / ${billPostB.ok} ${billPostB.message || billPostB.result?.status}`);

const key = await call(ids.createBusinessApiKey, owner.cookie, {
  projectId,
  name: "Audit",
  environment: "test",
  scopes: ["vendors:create", "bills:create"],
});
const idem = `audit-${stamp}`;
async function api(body) {
  return fetch(`${base}/api/v1/vendors`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key.result.token}`,
      "content-type": "application/json",
      "idempotency-key": idem,
    },
    body: JSON.stringify(body),
  });
}
const firstApi = await api({ display_name: "Idempotent Vendor", state_code: "MH" });
const firstBody = await firstApi.json();
const replay = await api({ display_name: "Idempotent Vendor", state_code: "MH" });
const replayBody = await replay.json();
const clash = await api({ display_name: "Different", state_code: "MH" });
record("same idempotency key replays one vendor", firstApi.status === 201 && replay.status === 201 && firstBody.id === replayBody.id, "same id", `${firstApi.status} ${replay.status}`);
record("same key with a different body conflicts", clash.status === 409, "409", clash.status);
const noScope = await fetch(`${base}/api/v1/reports/pnl`, { headers: { authorization: `Bearer ${key.result.token}` } });
record("API scope blocks a report the key cannot read", noScope.status === 403, "403", noScope.status);

const customer = await call(ids.saveBusinessCustomer, owner.cookie, { projectId, name: "ABC Ltd", stateCode: "MH" });
const draft = await call(ids.saveBusinessDraft, owner.cookie, {
  projectId,
  customerId: customer.result?.id,
  issueDate: today,
  placeOfSupply: "MH",
  items: [{ description: "Work", quantity: "1", rate: "100", gstRate: 0 }],
});
const [issueA, issueB] = await Promise.all([
  call(ids.issueBusinessInvoice, owner.cookie, { projectId, invoiceId: draft.result?.id }),
  call(ids.issueBusinessInvoice, owner.cookie, { projectId, invoiceId: draft.result?.id }),
]);
record("two invoice issues do not both succeed", customer.ok && draft.ok && Number(issueA.ok) + Number(issueB.ok) === 1, "one winner", `${issueA.ok} ${issueA.message || issueA.result?.number} / ${issueB.ok} ${issueB.message}`);
const issuedId = (issueA.ok ? issueA : issueB).result?.id || draft.result?.id;
const [invPayA, invPayB] = await Promise.all([
  call(ids.payBusinessInvoice, owner.cookie, { projectId, invoiceId: issuedId, amount: "80", date: today, method: "upi", accountCode: "1010" }),
  call(ids.payBusinessInvoice, owner.cookie, { projectId, invoiceId: issuedId, amount: "80", date: today, method: "upi", accountCode: "1010" }),
]);
record("two invoice payments cannot both clear ₹100", Number(invPayA.ok) + Number(invPayB.ok) === 1, "one winner", `${invPayA.ok} ${invPayA.result?.balance || invPayA.message} / ${invPayB.ok} ${invPayB.result?.balance || invPayB.message}`);

const cron = await fetch(`${base}/api/cron/webhooks`);
const cronBody = await cron.json();
record("webhook cron refuses to run without its secret", cron.status === 503 && String(cronBody.error).includes("worker/cron"), "503", `${cron.status} ${cronBody.error}`);

const hook = await call(ids.saveWebhookEndpoint, owner.cookie, { projectId, url: "https://example.com/kharcha-hook", events: ["bill.paid"] });
const ping = await call(ids.sendTestWebhook, owner.cookie, { projectId, endpointId: hook.result?.id });
record("test webhook attempts HTTPS and does not return the secret", hook.ok && ping.ok && !JSON.stringify(ping.result).includes(hook.result.secret), ping.result?.status, JSON.stringify(ping.result));
const desk = await call(ids.webhookDesk, owner.cookie, { projectId });
record("opening webhooks does not hide the delivery result", (desk.result?.deliveries ?? []).some((row) => row.event === "test.ping"), "visible", (desk.result?.deliveries ?? []).map((row) => row.event).join(","));

const passed = report.filter((row) => row.pass).length;
const failed = report.length - passed;
writeFileSync("/tmp/business-audit.json", JSON.stringify({ passed, failed, report }, null, 2));
console.log(`AUDIT ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
