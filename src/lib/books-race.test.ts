import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { claimInvite } from "./biz-access.ts";
import { webhookSignature, webhookSignatureMatches } from "./webhook-sign.ts";

test("two bill payments cannot together exceed the bill", async () => {
  const db = new PGlite();
  await db.exec(`
    create table biz_bills (
      id text primary key,
      total numeric(14,2) not null,
      amount_paid numeric(14,2) not null default 0
    );
    insert into biz_bills values ('aws', 11800, 0);
  `);
  async function pay(amount: string) {
    const result = await db.query<{ amount_paid: string }>(
      `update biz_bills set amount_paid = amount_paid + $1::numeric
       where id = 'aws' and amount_paid + $1::numeric <= total
       returning amount_paid::text`,
      [amount],
    );
    return result.rows.length;
  }
  const first = await pay("7000");
  const second = await pay("7000");
  const left = await db.query<{ amount_paid: string }>("select amount_paid::text as amount_paid from biz_bills");
  assert.equal(first, 1);
  assert.equal(second, 0);
  assert.equal(left.rows[0]?.amount_paid, "7000.00");
  await db.close();
});

test("two invoice payments cannot together exceed the invoice", async () => {
  const db = new PGlite();
  await db.exec(`
    create table biz_invoices (
      id text primary key,
      total numeric(14,2) not null,
      amount_paid numeric(14,2) not null default 0,
      amount_credited numeric(14,2) not null default 0,
      status text not null
    );
    insert into biz_invoices values ('inv', 100, 0, 0, 'issued');
  `);
  async function pay(amount: string) {
    const result = await db.query(
      `update biz_invoices set amount_paid = amount_paid + $1::numeric
       where id = 'inv' and status not in ('draft', 'void', 'cancelled')
         and amount_paid + amount_credited + $1::numeric <= total
       returning id`,
      [amount],
    );
    return result.rows.length;
  }
  const first = await pay("80");
  const second = await pay("80");
  assert.equal(first + second, 1);
  await db.close();
});

test("two depreciation inserts for the same period cannot both land", async () => {
  const db = new PGlite();
  await db.exec(`
    create table dep (asset_id text, period text, unique (asset_id, period));
  `);
  await db.query("insert into dep values ('laptop', '2026-10')");
  await assert.rejects(() => db.query("insert into dep values ('laptop', '2026-10')"));
  const rows = await db.query<{ n: number }>("select count(*)::int as n from dep");
  assert.equal(Number(rows.rows[0]?.n), 1);
  await db.close();
});

test("two invite accepts cannot both claim the open row", async () => {
  const db = new PGlite();
  await db.exec(`
    create table biz_invites (
      id text primary key,
      accepted_at timestamptz,
      revoked_at timestamptz,
      expires_at timestamptz not null
    );
    insert into biz_invites values ('inv', null, null, now() + interval '1 day');
  `);
  async function accept() {
    const result = await db.query(
      `update biz_invites set accepted_at = now()
       where id = 'inv' and accepted_at is null and revoked_at is null and expires_at > now()
       returning id`,
    );
    return result.rows.length === 1;
  }
  const a = await accept();
  const b = await accept();
  assert.equal(a, true);
  assert.equal(b, false);
  assert.throws(() => claimInvite("used"), /already used/);
  assert.throws(() => claimInvite("expired"), /expired/);
  assert.throws(() => claimInvite("revoked"), /revoked/);
  await db.close();
});

test("an expired invite row cannot be claimed", async () => {
  const db = new PGlite();
  await db.exec(`
    create table biz_invites (
      id text primary key,
      accepted_at timestamptz,
      revoked_at timestamptz,
      expires_at timestamptz not null
    );
    insert into biz_invites values ('old', null, null, now() - interval '1 minute');
  `);
  const claimed = await db.query(
    `update biz_invites set accepted_at = now()
     where id = 'old' and accepted_at is null and revoked_at is null and expires_at > now()
     returning id`,
  );
  assert.equal(claimed.rows.length, 0);
  await db.close();
});

test("webhook verification uses the raw body, and a rotated secret no longer matches", async () => {
  const body = '{"id":"evt_1","type":"test.ping","data":{"ok":true}}';
  const signature = await webhookSignature("whsec_one", "1710000000", body);
  assert.equal(await webhookSignatureMatches("whsec_one", "1710000000", body, signature.header), true);
  assert.equal(await webhookSignatureMatches("whsec_one", "1710000000", JSON.stringify(JSON.parse(body)), signature.header), true);
  const reordered = '{"data":{"ok":true},"id":"evt_1","type":"test.ping"}';
  assert.equal(await webhookSignatureMatches("whsec_one", "1710000000", reordered, signature.header), false);
  assert.equal(await webhookSignatureMatches("whsec_rotated", "1710000000", body, signature.header), false);
  assert.equal(signature.header.startsWith("sha256="), true);
  assert.equal(body.includes("kh_live_"), false);
});
