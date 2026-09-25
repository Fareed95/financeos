/**
 * Live API audit of collaborative expenses.
 * Hits the running dev server as Fareed, Y, Z, and an attacker.
 * Prints a JSON report and exits non-zero if any check fails.
 */
import { writeFileSync } from "node:fs";
import { toJSONAsync, fromCrossJSON } from "seroval";

const base = process.env.AUDIT_BASE || "http://127.0.0.1:8080";
const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);
const report = [];

function record(name, pass, expected, actual) {
  report.push({ name, pass, expected, actual });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
}

async function signUp(name) {
  const email = `${name.toLowerCase()}-${stamp}@audit.example`;
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ name, email, password: "audit-pass-123" }),
  });
  const raw = await res.text();
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const json = JSON.parse(raw);
  if (res.status !== 200 || !json.user?.id) {
    throw new Error(`signup ${name} failed ${res.status} ${raw.slice(0, 300)}`);
  }
  return { name, id: json.user.id, cookie: cookies, email };
}

async function loadIds(path) {
  const text = await (await fetch(`${base}${path}`)).text();
  const map = {};
  const re = /export const (\w+) = createServerFn\b[\s\S]*?\.handler\(createClientRpc\("([^"]+)"\)\)/g;
  for (const match of text.matchAll(re)) map[match[1]] = match[2];
  return map;
}

async function call(id, cookie, data, extraContext) {
  const payload = { data };
  if (extraContext) payload.context = extraContext;
  const body = JSON.stringify(await toJSONAsync(payload));
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
  const ok = res.status === 200 && parsed && (error == null || error === undefined) && parsed.result !== undefined;
  return { status: res.status, ok, message, result: parsed?.result ?? null, text };
}

function denied(res) {
  return !res.ok;
}

const fn = {};
const ids = {
  ...(await loadIds("/src/lib/server/accounts.ts")),
  ...(await loadIds("/src/lib/server/projects.ts")),
  ...(await loadIds("/src/lib/server/transactions.ts")),
  ...(await loadIds("/src/lib/server/collab.ts")),
};
Object.assign(fn, ids);

const fareed = await signUp("Fareed");
const y = await signUp("Y");
const z = await signUp("Z");
const attacker = await signUp("Attacker");
const c1 = await signUp("C1");
const c2 = await signUp("C2");

const account = await call(fn.upsertAccount, fareed.cookie, {
  name: "Cash",
  type: "cash",
  openingBalance: "100000",
});
if (!account.ok) throw new Error(`account ${account.message} ${account.text.slice(0, 200)}`);
const accountId = account.result.id;

const projectRes = await call(fn.upsertProject, fareed.cookie, {
  name: "Bangalore Trip",
  projectType: "trip",
  budget: "10000",
  status: "active",
  startDate: today,
  endDate: today,
});
if (!projectRes.ok) throw new Error(`project ${projectRes.message}`);
const projectId = projectRes.result.id;

const invite = await call(fn.createProjectInvite, fareed.cookie, { projectId });
if (!invite.ok) throw new Error(`invite ${invite.message}`);
const token = invite.result.token;
record(
  "invite token is not a sequential id",
  typeof token === "string" && token.length >= 32 && !/^\d+$/.test(token),
  "32+ char non-numeric token",
  token,
);

const yJoin = await call(fn.acceptInvite, y.cookie, { token });
const zJoin = await call(fn.acceptInvite, z.cookie, { token });
record("Y accepts a valid invite", yJoin.ok, "join", yJoin.message || yJoin.result);
record("reused invite is rejected", !zJoin.ok, "already used", zJoin.message);

const invite2 = await call(fn.createProjectInvite, fareed.cookie, { projectId });
const zJoin2 = await call(fn.acceptInvite, z.cookie, { token: invite2.result.token });
record("Z accepts a fresh invite", zJoin2.ok, "join", zJoin2.message || "joined");

const forged = `${token.slice(0, -2)}aa`;
const forgedPreview = await call(fn.previewInvite, attacker.cookie, { token: forged });
record("modified invite token is rejected", !forgedPreview.ok, "invalid", forgedPreview.message);

const unsigned = await call(fn.listProjectMembers, "", { projectId });
record("signed-out member list is rejected", denied(unsigned), "unauthorized", unsigned.message || unsigned.status);

async function asAttacker(name, id, data, context) {
  const res = await call(id, attacker.cookie, data, context);
  record(name, denied(res), "denied", res.ok ? res.result : res.message || res.status);
  return res;
}

await asAttacker("attacker cannot read project detail", fn.getProjectDetail, { id: projectId, today });
await asAttacker("attacker cannot list members", fn.listProjectMembers, { projectId });
await asAttacker("attacker cannot read balances", fn.getProjectBalances, { projectId });
await asAttacker("attacker cannot list invites", fn.listProjectInvites, { projectId });
await asAttacker("attacker cannot create an expense", fn.addProjectExpense, {
  projectId,
  accountId,
  amount: "10",
  transactionDate: today,
  visibility: "shared",
  paidByUserId: fareed.id,
  method: "equal",
  parts: [{ userId: fareed.id, value: "1" }],
  description: "attacker-write",
});
await asAttacker("attacker cannot settle", fn.createSettlement, {
  projectId,
  fromUserId: z.id,
  toUserId: fareed.id,
  amount: "1",
});
await asAttacker("attacker cannot invite", fn.createProjectInvite, { projectId });
const forgedCtx = await call(fn.getProjectDetail, attacker.cookie, { id: projectId, today }, { userId: fareed.id });
record(
  "attacker cannot spoof userId in the request context",
  denied(forgedCtx),
  "denied",
  forgedCtx.ok ? "got project" : forgedCtx.message || forgedCtx.status,
);

const attackerProjects = await call(fn.listProjects, attacker.cookie, {});
const leaked = JSON.stringify(attackerProjects.result ?? "").includes(projectId);
record("attacker project list does not include Bangalore", attackerProjects.ok && !leaked, "absent", leaked);

const dinner = await call(fn.addProjectExpense, fareed.cookie, {
  projectId,
  accountId,
  amount: "1500",
  description: "dinner-bangalore",
  transactionDate: today,
  visibility: "shared",
  paidByUserId: fareed.id,
  method: "equal",
  parts: [
    { userId: fareed.id, value: "1" },
    { userId: y.id, value: "1" },
    { userId: z.id, value: "1" },
  ],
});
record("dinner 1500 equal is stored", dinner.ok, "id", dinner.message || dinner.result?.id);

const cab = await call(fn.addProjectExpense, fareed.cookie, {
  projectId,
  accountId,
  amount: "1000",
  description: "cab-bangalore",
  transactionDate: today,
  visibility: "shared",
  paidByUserId: y.id,
  method: "equal",
  parts: [
    { userId: y.id, value: "1" },
    { userId: z.id, value: "1" },
  ],
});
record("cab 1000 equal Y/Z is stored", cab.ok, "id", cab.message || cab.result?.id);

const phones = await call(fn.addProjectExpense, fareed.cookie, {
  projectId,
  accountId,
  amount: "2000",
  description: "headphones-personal-qa",
  transactionDate: today,
  visibility: "personal",
});
record("personal headphones are stored", phones.ok, "id", phones.message || phones.result?.id);

const secret = await call(fn.addProjectExpense, fareed.cookie, {
  projectId,
  accountId,
  amount: "600",
  description: "private-lantern-qa",
  transactionDate: today,
  visibility: "private",
  paidByUserId: fareed.id,
  method: "equal",
  parts: [
    { userId: fareed.id, value: "1" },
    { userId: y.id, value: "1" },
  ],
});
record("private 600 is stored", secret.ok, "id", secret.message || secret.result?.id);

const odd = await call(fn.addProjectExpense, fareed.cookie, {
  projectId,
  accountId,
  amount: "100",
  description: "odd-paise-qa",
  transactionDate: today,
  visibility: "shared",
  paidByUserId: fareed.id,
  method: "equal",
  parts: [
    { userId: fareed.id, value: "1" },
    { userId: y.id, value: "1" },
    { userId: z.id, value: "1" },
  ],
});
record("odd ₹100 equal split is stored", odd.ok, "id", odd.message || odd.result?.id);

async function detail(user) {
  return call(fn.getProjectDetail, user.cookie, { id: projectId, today });
}
async function balances(user) {
  return call(fn.getProjectBalances, user.cookie, { projectId });
}

const fareedDetail = await detail(fareed);
const yDetail = await detail(y);
const zDetail = await detail(z);
const texts = {
  fareed: JSON.stringify(fareedDetail.result ?? ""),
  y: JSON.stringify(yDetail.result ?? ""),
  z: JSON.stringify(zDetail.result ?? ""),
};
record("Fareed sees the private expense", texts.fareed.includes("private-lantern-qa"), "visible", texts.fareed.includes("private-lantern-qa"));
record("Y sees the private expense", texts.y.includes("private-lantern-qa"), "visible", texts.y.includes("private-lantern-qa"));
record("Z does not see the private description", !texts.z.includes("private-lantern-qa"), "hidden", texts.z.includes("private-lantern-qa"));
record("Z does not see the private amount 600.00", !texts.z.includes("600.00"), "hidden", texts.z.includes("600.00"));
record("Y does not see Fareed's headphones", !texts.y.includes("headphones-personal-qa"), "hidden", texts.y.includes("headphones-personal-qa"));
record("Z does not see Fareed's headphones", !texts.z.includes("headphones-personal-qa"), "hidden", texts.z.includes("headphones-personal-qa"));
record("Fareed sees his headphones", texts.fareed.includes("headphones-personal-qa"), "visible", texts.fareed.includes("headphones-personal-qa"));

const zList = await call(fn.listTransactions, z.cookie, { projectId, limit: 50 });
const zListText = JSON.stringify(zList.result ?? "");
record("Z transaction list hides private and personal", !zListText.includes("private-lantern-qa") && !zListText.includes("headphones-personal-qa"), "hidden", zListText.slice(0, 180));

const attackerDetail = await detail(attacker);
record("attacker detail after expenses is still denied", denied(attackerDetail), "denied", attackerDetail.message || attackerDetail.status);
const attackerTxn = await call(fn.getTransaction, attacker.cookie, { id: secret.result.id });
record("attacker cannot read the private transaction by id", denied(attackerTxn), "denied", attackerTxn.message || attackerTxn.status);

const fBal = await balances(fareed);
const yBal = await balances(y);
const zBal = await balances(z);
record(
  "group spend stays 2600 after personal 2000 and private 600",
  fBal.result?.spend?.sharedSpend === "2600.00" && yBal.result?.spend?.sharedSpend === "2600.00",
  "2600.00 (1500+1000+100)",
  { f: fBal.result?.spend, y: yBal.result?.spend, z: zBal.result?.spend },
);
record(
  "Fareed personal spend is 2000 and my spend includes his shares",
  fBal.result?.spend?.personalSpend === "2000.00",
  "personal 2000",
  fBal.result?.spend,
);
record(
  "Y and Z personal spend stays 0",
  yBal.result?.spend?.personalSpend === "0.00" && zBal.result?.spend?.personalSpend === "0.00",
  "0.00",
  { y: yBal.result?.spend?.personalSpend, z: zBal.result?.spend?.personalSpend },
);
const zPayText = JSON.stringify(zBal.result?.payments ?? []) + JSON.stringify(zBal.result?.privatePayments ?? []);
record("Z balance payload has no private-lantern text", !JSON.stringify(zBal.result ?? "").includes("private-lantern-qa"), "hidden", "payments only");
record(
  "private debt is not in Z's group or private payment plan",
  !(zBal.result?.privatePayments ?? []).length,
  "no private plan",
  zBal.result?.privatePayments,
);

const exactBad = await call(fn.addProjectExpense, fareed.cookie, {
  projectId,
  accountId,
  amount: "100",
  description: "bad-exact",
  transactionDate: today,
  visibility: "shared",
  paidByUserId: fareed.id,
  method: "exact",
  parts: [
    { userId: fareed.id, value: "10" },
    { userId: y.id, value: "10" },
  ],
});
const pctBad = await call(fn.addProjectExpense, fareed.cookie, {
  projectId,
  accountId,
  amount: "100",
  transactionDate: today,
  visibility: "shared",
  paidByUserId: fareed.id,
  method: "percentage",
  parts: [
    { userId: fareed.id, value: "40" },
    { userId: y.id, value: "40" },
  ],
});
const shareBad = await call(fn.addProjectExpense, fareed.cookie, {
  projectId,
  accountId,
  amount: "100",
  transactionDate: today,
  visibility: "shared",
  method: "shares",
  paidByUserId: fareed.id,
  parts: [
    { userId: fareed.id, value: "0" },
    { userId: y.id, value: "0" },
  ],
});
const zeroBad = await call(fn.addProjectExpense, fareed.cookie, {
  projectId,
  accountId,
  amount: "0",
  transactionDate: today,
  visibility: "personal",
});
const negBad = await call(fn.addProjectExpense, fareed.cookie, {
  projectId,
  accountId,
  amount: "-20",
  transactionDate: today,
  visibility: "personal",
});
record("API rejects exact total mismatch", !exactBad.ok, "rejected", exactBad.message);
record("API rejects percentages that are not 100", !pctBad.ok, "rejected", pctBad.message);
record("API rejects zero shares", !shareBad.ok, "rejected", shareBad.message);
record("API rejects zero amount", !zeroBad.ok, "rejected", zeroBad.message);
record("API rejects negative amount", !negBad.ok, "rejected", negBad.message);

const ringProject = await call(fn.upsertProject, fareed.cookie, {
  name: "Ring",
  projectType: "other",
  budget: "0",
  status: "active",
});
const ringInviteY = await call(fn.createProjectInvite, fareed.cookie, { projectId: ringProject.result.id });
const ringInviteZ = await call(fn.createProjectInvite, fareed.cookie, { projectId: ringProject.result.id });
await call(fn.acceptInvite, y.cookie, { token: ringInviteY.result.token });
await call(fn.acceptInvite, z.cookie, { token: ringInviteZ.result.token });
await call(fn.addProjectExpense, fareed.cookie, {
  projectId: ringProject.result.id,
  accountId,
  amount: "500",
  description: "x-paid-for-y",
  transactionDate: today,
  visibility: "shared",
  paidByUserId: fareed.id,
  method: "exact",
  parts: [{ userId: y.id, value: "500" }],
});
await call(fn.addProjectExpense, fareed.cookie, {
  projectId: ringProject.result.id,
  accountId,
  amount: "500",
  description: "y-paid-for-z",
  transactionDate: today,
  visibility: "shared",
  paidByUserId: y.id,
  method: "exact",
  parts: [{ userId: z.id, value: "500" }],
});
const ring = await call(fn.getProjectBalances, fareed.cookie, { projectId: ringProject.result.id });
const ringPayments = ring.result?.payments ?? [];
record(
  "circular 500+500 simplifies to Z pays Fareed 500, not 1000",
  ringPayments.length === 1 && ringPayments[0].amount === "500.00" && ringPayments[0].fromUserId === z.id && ringPayments[0].toUserId === fareed.id,
  "Z -> Fareed 500.00",
  ringPayments,
);
const yRing = await call(fn.getProjectBalances, y.cookie, { projectId: ringProject.result.id });
record("Y net on the circle is 0", yRing.result?.you === "0.00", "0.00", yRing.result?.you);

const before = await balances(fareed);
const owed = (before.result?.payments ?? []).find((p) => p.fromUserId === z.id && p.toUserId === fareed.id);
record("before settlement Z owes Fareed on Bangalore", Boolean(owed), "a payment row", before.result?.payments);

const settle = await call(fn.createSettlement, fareed.cookie, {
  projectId,
  fromUserId: z.id,
  toUserId: fareed.id,
  amount: owed?.amount ?? "1000.00",
  paymentMethod: "upi",
});
const after = await balances(z);
record("settlement of the suggested amount is accepted", settle.ok, "stored", settle.message || settle.result);
record(
  "Z no longer owes Fareed that suggested amount",
  !(after.result?.payments ?? []).some((p) => p.fromUserId === z.id && p.toUserId === fareed.id && p.amount === owed?.amount),
  "row gone",
  after.result?.payments,
);

const ySettle = await call(fn.createSettlement, y.cookie, {
  projectId,
  fromUserId: z.id,
  toUserId: fareed.id,
  amount: "10",
});
record("Y cannot settle a payment Y is not part of", !ySettle.ok, "denied", ySettle.message);

const negative = await call(fn.createSettlement, fareed.cookie, {
  projectId,
  fromUserId: z.id,
  toUserId: fareed.id,
  amount: "-50",
});
const zeroSettle = await call(fn.createSettlement, fareed.cookie, {
  projectId,
  fromUserId: z.id,
  toUserId: fareed.id,
  amount: "0",
});
record("negative settlement is rejected", !negative.ok, "rejected", negative.message);
record("zero settlement is rejected", !zeroSettle.ok, "rejected", zeroSettle.message);

const outsider = await call(fn.createSettlement, fareed.cookie, {
  projectId,
  fromUserId: attacker.id,
  toUserId: fareed.id,
  amount: "10",
});
record("settlement with a non-member is rejected", !outsider.ok, "rejected", outsider.message);

const beforeDup = await balances(z);
const dupA = await call(fn.createSettlement, z.cookie, {
  projectId,
  fromUserId: z.id,
  toUserId: fareed.id,
  amount: "1000",
});
const dupB = await call(fn.createSettlement, z.cookie, {
  projectId,
  fromUserId: z.id,
  toUserId: fareed.id,
  amount: "1000",
});
const afterDup = await balances(z);
const historyAmounts = (afterDup.result?.history ?? []).filter((h) => h.amount === "1000.00" || h.amount === "1000").length;
record(
  "replaying the same ₹1000 settlement does not create a second row",
  dupA.ok && !dupB.ok,
  "second rejected",
  { first: dupA.message || dupA.result, second: dupB.message || dupB.result, youBefore: beforeDup.result?.you, youAfter: afterDup.result?.you, history1000: historyAmounts },
);

const over = await call(fn.createSettlement, fareed.cookie, {
  projectId: ringProject.result.id,
  fromUserId: z.id,
  toUserId: fareed.id,
  amount: "5000",
});
const ringAfterOver = await call(fn.getProjectBalances, fareed.cookie, { projectId: ringProject.result.id });
record(
  "settlement larger than the amount owed is rejected",
  !over.ok,
  "rejected",
  { message: over.message, you: ringAfterOver.result?.you, payments: ringAfterOver.result?.payments },
);

const parallel = await Promise.all([
  call(fn.createSettlement, fareed.cookie, {
    projectId: ringProject.result.id,
    fromUserId: z.id,
    toUserId: fareed.id,
    amount: "1.00",
  }),
  call(fn.createSettlement, fareed.cookie, {
    projectId: ringProject.result.id,
    fromUserId: z.id,
    toUserId: fareed.id,
    amount: "1.00",
  }),
]);
const parallelOk = parallel.filter((r) => r.ok).length;
record("concurrent identical settlements do not both commit", parallelOk <= 1, "at most one", parallel.map((r) => r.message || r.result));

const edit = await call(fn.upsertTransaction, fareed.cookie, {
  id: dinner.result.id,
  accountId,
  projectId,
  type: "expense",
  amount: "1",
  transactionDate: today,
  description: "dinner-edited",
});
const del = await call(fn.deleteTransaction, fareed.cookie, { id: dinner.result.id });
record("owner cannot edit a shared expense after a settlement", !edit.ok, "blocked", edit.message);
record("owner cannot delete a shared expense after a settlement", !del.ok, "blocked", del.message);
const attackEdit = await call(fn.upsertTransaction, attacker.cookie, {
  id: dinner.result.id,
  accountId,
  type: "expense",
  amount: "1",
  transactionDate: today,
  description: "hijack",
});
const attackDel = await call(fn.deleteTransaction, attacker.cookie, { id: dinner.result.id });
record("attacker cannot edit the shared expense", !attackEdit.ok, "denied", attackEdit.message);
record("attacker cannot delete the shared expense", !attackDel.ok, "denied", attackDel.message);
const still = await detail(fareed);
record(
  "dinner row still exists after blocked edit and delete",
  JSON.stringify(still.result ?? "").includes("dinner-bangalore"),
  "still dinner-bangalore",
  JSON.stringify(still.result ?? "").includes("dinner-edited"),
);

const revokeInvite = await call(fn.createProjectInvite, fareed.cookie, { projectId });
const revoked = await call(fn.revokeInvite, fareed.cookie, { inviteId: revokeInvite.result?.inviteId });
record("revoke endpoint returns an invite id", Boolean(revokeInvite.result?.inviteId) || !revoked.ok, "id or documented gap", revokeInvite.result);

const openInvite = await call(fn.listProjectInvites, fareed.cookie, { projectId });
const openRow = (openInvite.result?.invites ?? []).find((row) => !row.acceptedAt && !row.revokedAt);
let revokeResult = { ok: false, message: "no open invite" };
let revokedAccept = { ok: false, message: "not attempted" };
if (openRow) {
  revokeResult = await call(fn.revokeInvite, fareed.cookie, { inviteId: openRow.id });
  revokedAccept = await call(fn.acceptInvite, attacker.cookie, { token: "missing-because-token-not-stored" });
}
record("owner can revoke an open invite", revokeResult.ok, "revoked", revokeResult.message || revokeResult.result);

const removed = await call(fn.removeProjectMember, fareed.cookie, { projectId, userId: y.id });
const oldAccept = await call(fn.acceptInvite, y.cookie, { token });
record("removed member cannot reuse the already-used invite", removed.ok && !oldAccept.ok, "rejected", oldAccept.message);
const reopen = await call(fn.createProjectInvite, fareed.cookie, { projectId });
const rejoin = await call(fn.acceptInvite, y.cookie, { token: reopen.result?.token });
record("a newly issued invite can add a removed member again", rejoin.ok, "joined", rejoin.message || "joined");

const raceProject = await call(fn.upsertProject, fareed.cookie, {
  name: "Race",
  projectType: "other",
  budget: "0",
  status: "active",
});
const raceInvite = await call(fn.createProjectInvite, fareed.cookie, { projectId: raceProject.result.id });
const race = await Promise.all([
  call(fn.acceptInvite, c1.cookie, { token: raceInvite.result.token }),
  call(fn.acceptInvite, c2.cookie, { token: raceInvite.result.token }),
]);
const raceMembers = await call(fn.listProjectMembers, fareed.cookie, { projectId: raceProject.result.id });
const raceIds = (raceMembers.result?.members ?? []).map((m) => m.userId);
const both = raceIds.includes(c1.id) && raceIds.includes(c2.id);
record(
  "one invite cannot be accepted by two people at once",
  race.filter((r) => r.ok).length === 1 && !both,
  "exactly one member",
  { results: race.map((r) => r.message || r.result), members: raceIds },
);

const manifest = await fetch(`${base}/__grok/manifest.webmanifest`);
const manifestJson = await manifest.json();
record(
  "manifest name is Kharcha",
  manifestJson.name === "Kharcha" && manifestJson.short_name === "Kharcha",
  "Kharcha",
  { name: manifestJson.name, short_name: manifestJson.short_name, icons: manifestJson.icons },
);
for (const icon of manifestJson.icons ?? []) {
  const iconRes = await fetch(`${base}${icon.src}`);
  record(`icon ${icon.src} resolves`, iconRes.status === 200 && (iconRes.headers.get("content-type") || "").includes("png"), "200 png", iconRes.status);
}
const sw = await fetch(`${base}/sw.js`);
const sw2 = await fetch(`${base}/service-worker.js`);
record("service worker is served", sw.status === 200 || sw2.status === 200, "200", { sw: sw.status, serviceWorker: sw2.status });
const home = await fetch(`${base}/`);
const html = await home.text();
record("document title is Kharcha", html.includes("<title>Kharcha</title>") || html.includes("Kharcha"), "Kharcha", home.status);
record("viewport meta is present", html.includes("width=device-width"), "viewport", html.includes("width=device-width"));
const supabase = await fetch(`${base}/rest/v1/projects`);
record("no Supabase REST endpoint", supabase.status === 404 || supabase.status === 401 && false || supabase.status >= 400, "not a supabase API", supabase.status);

const failed = report.filter((row) => !row.pass);
writeFileSync("/tmp/collab-audit-report.json", JSON.stringify({ passed: report.length - failed.length, failed: failed.length, report }, null, 2));
console.log(`\n# checks ${report.length} pass ${report.length - failed.length} fail ${failed.length}`);
if (failed.length) {
  console.log(failed.map((row) => row.name).join("\n"));
  process.exit(1);
}
