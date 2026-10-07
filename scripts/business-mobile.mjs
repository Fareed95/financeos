import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { toJSONAsync, fromCrossJSON } from "seroval";

const base = "http://127.0.0.1:8080";
const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);
const widths = [390, 412, 430];

async function signUp() {
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ name: "Mobile", email: `mobile-${stamp}@audit.example`, password: "audit-pass-123" }),
  });
  const json = await res.json();
  const cookies = (res.headers.getSetCookie?.() ?? []).map((cookie) => {
    const [pair, ...attrs] = cookie.split(";").map((part) => part.trim());
    const [name, ...value] = pair.split("=");
    return { name, value: value.join("="), url: base, httpOnly: attrs.some((attr) => attr.toLowerCase() === "httponly") };
  });
  return { id: json.user.id, cookies };
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
  const res = await fetch(`${base}/_serverFn/${id}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-tsr-serverFn": "true",
      origin: base,
      cookie,
      "sec-fetch-site": "same-origin",
    },
    body,
  });
  const parsed = fromCrossJSON(JSON.parse(await res.text()), { plugins: [] });
  if (parsed?.error) throw new Error(parsed.error.message || "call failed");
  return parsed.result;
}

const user = await signUp();
const cookie = user.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
const ids = {
  ...(await loadIds("/src/lib/server/projects.ts")),
  ...(await loadIds("/src/lib/server/business.ts")),
  ...(await loadIds("/src/lib/server/bootstrap.ts")),
  ...(await loadIds("/src/lib/server/accounts.ts")),
  ...(await loadIds("/src/lib/server/biz-team.ts")),
  ...(await loadIds("/src/lib/server/ops.ts")),
};
await call(ids.updateProfile, cookie, { onboardingCompleted: true, fullName: "Mobile" });
await call(ids.upsertAccount, cookie, { name: "Cash", type: "cash", openingBalance: "1000" });
const project = await call(ids.upsertProject, cookie, { name: "Mobile Books", projectType: "business", budget: "0", status: "active" });
await call(ids.getBusiness, cookie, { projectId: project.id, today });
await call(ids.finishBusinessSetup, cookie, { projectId: project.id, legalName: "Mobile Books", stateCode: "MH", gst: "regular" });
await call(ids.postBusinessCapital, cookie, { projectId: project.id, amount: "20000", date: today, place: "cash", origin: "founder" });
const vendor = await call(ids.saveVendor, cookie, { projectId: project.id, displayName: "AWS India", stateCode: "MH", gstin: "27AAAAA0000A1Z5", paymentTerms: "30" });
await call(ids.saveBill, cookie, {
  projectId: project.id,
  vendorId: vendor.id,
  billDate: today,
  dueDate: today,
  placeOfSupply: "MH",
  expenseCode: "5400",
  description: "Software",
  quantity: "1",
  rate: "10000",
  gstRate: 18,
  post: true,
});

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.setExtraHTTPHeaders({ cookie });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/projects/${project.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const sections = ["Overview", "Sales", "Expenses", "More", "Invoices", "Reports", "Equity", "Money", "Vendors", "Bills", "Budgets", "Loans", "Assets", "Team", "Developer"];
  const sectionNotes = [];
  for (const label of sections) {
    let button = page.getByRole("button", { name: label, exact: true }).first();
    if ((await button.count()) === 0) {
      const more = page.getByRole("button", { name: "More", exact: true }).first();
      if (await more.count()) await more.click();
      await page.waitForTimeout(150);
      button = page.getByRole("button", { name: label, exact: true }).first();
    }
    if (await button.count()) await button.click();
    await page.waitForTimeout(250);
    if (label === "Vendors") {
      const vendorButton = page.getByRole("button", { name: /AWS India/ }).first();
      if (await vendorButton.count()) await vendorButton.click();
      await page.waitForTimeout(300);
    }
    if (label === "Bills") {
      const billButton = page.getByRole("button", { name: /AWS India/ }).first();
      if (await billButton.count()) await billButton.click();
      await page.waitForTimeout(300);
    }
    const metrics = await page.evaluate(() => {
      const nav = document.querySelector("nav.fos-tabbar");
      const navBox = nav ? nav.getBoundingClientRect() : null;
      const clipped = [...document.querySelectorAll("button, input, select, a")].filter((node) => {
        if (node.closest("nav.fos-tabbar")) return false;
        const box = node.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        const offRight = box.left < -1 || box.right > document.documentElement.clientWidth + 1;
        let scroller = false;
        let parent = node.parentElement;
        while (parent && parent !== document.body) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (overflowX === "auto" || overflowX === "scroll") {
            scroller = true;
            break;
          }
          parent = parent.parentElement;
        }
        let fixed = false;
        let el = node;
        while (el && el !== document.body) {
          const pos = getComputedStyle(el).position;
          if (pos === "fixed" || pos === "sticky") {
            fixed = true;
            break;
          }
          el = el.parentElement;
        }
        const underNav = fixed && navBox ? box.top < navBox.bottom && box.bottom > navBox.top : false;
        return (!scroller && offRight) || underNav;
      }).map((node) => (node.getAttribute("aria-label") || node.textContent || node.tagName).trim().slice(0, 40));
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clipped,
        text: document.body.innerText.slice(0, 180),
      };
    });
    sectionNotes.push({ label, overflow: metrics.pageOverflow, clipped: metrics.clipped });
  }
  const learn = page.getByRole("button", { name: /Learn/ }).first();
  if (await learn.count()) {
    await learn.click();
    await page.waitForTimeout(300);
  }
  const final = await page.evaluate(() => ({
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    learnOpen: document.body.innerText.includes("Learn") || document.body.innerText.includes("Revenue"),
  }));
  await page.screenshot({ path: `/workspace/screenshots/business-${width}.png`, fullPage: false });
  results.push({ width, errors, sectionNotes, final });
  await context.close();
}
await browser.close();
const bad = results.filter((row) => row.errors.length || row.final.pageOverflow > 1 || row.sectionNotes.some((note) => note.overflow > 1 || note.clipped.length > 0));
console.log(JSON.stringify({ ok: bad.length === 0, results }, null, 2));
if (bad.length) process.exit(1);
