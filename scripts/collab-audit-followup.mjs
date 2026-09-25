import { toJSONAsync, fromCrossJSON } from "seroval";

const base = "http://127.0.0.1:8080";
const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);

async function signUp(name) {
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ name, email: `${name}-${stamp}@audit.example`, password: "audit-pass-123" }),
  });
  const json = await res.json();
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { id: json.user.id, cookie };
}
async function ids(path) {
  const text = await (await fetch(`${base}${path}`)).text();
  const map = {};
  const re = /export const (\w+) = createServerFn\b[\s\S]*?\.handler\(createClientRpc\("([^"]+)"\)\)/g;
  for (const match of text.matchAll(re)) map[match[1]] = match[2];
  return map;
}
async function call(id, cookie, data) {
  const body = JSON.stringify(await toJSONAsync({ data }));
  const res = await fetch(`${base}/_serverFn/${id}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-tsr-serverFn": "true",
      origin: base,
      "sec-fetch-site": "same-origin",
      cookie,
    },
    body,
  });
  const parsed = fromCrossJSON(JSON.parse(await res.text()), { plugins: [] });
  return parsed.result;
}

const fn = {
  ...(await ids("/src/lib/server/accounts.ts")),
  ...(await ids("/src/lib/server/projects.ts")),
  ...(await ids("/src/lib/server/collab.ts")),
};
const f = await signUp("Fareed");
const z = await signUp("Zed");
const a = await signUp("Attacker");
const account = await call(fn.upsertAccount, f.cookie, { name: "Cash", type: "cash", openingBalance: "0" });
const project = await call(fn.upsertProject, f.cookie, {
  name: "Private check",
  projectType: "trip",
  budget: "10000",
  status: "active",
});
const inv = await call(fn.createProjectInvite, f.cookie, { projectId: project.id });
await call(fn.acceptInvite, z.cookie, { token: inv.token });
await call(fn.addProjectExpense, f.cookie, {
  projectId: project.id,
  accountId: account.id,
  amount: "600",
  description: "private-lantern-qa",
  transactionDate: today,
  visibility: "private",
  paidByUserId: f.id,
  method: "equal",
  parts: [{ userId: f.id, value: "1" }],
});
const detail = await call(fn.getProjectDetail, z.cookie, { id: project.id, today });
const amounts = (detail.transactions ?? []).map((t) => ({ description: t.description, amount: t.amount, visibility: t.visibility }));
const known = await call(fn.listProjectInvites, a.cookie, { projectId: project.id });
const unknown = await call(fn.listProjectInvites, a.cookie, { projectId: "00000000-0000-0000-0000-000000000000" });
console.log(JSON.stringify({
  zTransactions: amounts,
  zInsights: {
    totalCost: detail.insights?.totalCost,
    mySpend: detail.insights?.mySpend,
    sharedSpend: detail.insights?.sharedSpend,
    personalSpend: detail.insights?.personalSpend,
    remaining: detail.insights?.remaining,
  },
  attackerKnownProjectInvites: known,
  attackerUnknownProjectInvites: unknown,
}, null, 2));
