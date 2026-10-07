import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./db.ts";
import { webhookSignatureMatches } from "./webhook-sign.ts";
import { deliverTestPing, emitBusinessEvent, retryDueWebhooks } from "./server/webhooks.ts";

function asSql(db: PGlite): Sql {
  const run = async <T>(text: string, params: unknown[]) => (await db.query<T>(text, params)).rows;
  const sql = (async <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => run<T>(text, params);
  return sql;
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table biz_webhook_endpoints (
      id text primary key,
      business_id text not null,
      url text not null,
      secret text not null,
      events text not null,
      status text not null default 'active',
      environment text not null default 'live'
    );
    create table biz_webhook_deliveries (
      id text primary key,
      business_id text not null,
      event text not null,
      status text not null,
      attempts integer not null default 0,
      event_id text,
      endpoint_id text,
      http_status integer,
      duration_ms integer,
      response_summary text,
      next_retry_at timestamptz,
      payload text,
      environment text not null default 'live',
      created_at timestamptz not null default now()
    );
  `);
  const sql = asSql(db);
  await sql`
    insert into biz_webhook_endpoints (id, business_id, url, secret, events, status, environment)
    values ('ep', 'biz', 'https://hooks.test/kharcha', 'whsec_one', 'bill.paid,test.ping', 'active', 'live')
  `;
  return { db, sql };
}

test("a controlled receiver verifies the raw body, and failures retry without a new event id", async () => {
  const { db, sql } = await fixture();
  const seen: { body: string; header: string; timestamp: string; event: string | null; delivery: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    assert.equal(String(url).startsWith("https://"), true);
    const headers = new Headers(init?.headers);
    const body = String(init?.body);
    seen.push({
      body,
      header: headers.get("x-kharcha-signature") || "",
      timestamp: headers.get("x-kharcha-timestamp") || "",
      event: headers.get("x-kharcha-event"),
      delivery: headers.get("x-kharcha-delivery"),
    });
    assert.equal(body.includes("kh_live_") || body.includes("whsec_"), false);
    if (seen.length === 1) return new Response("no", { status: 500 });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    const first = await deliverTestPing(sql, "biz", { id: "ep", url: "https://hooks.test/kharcha", secret: "whsec_one" });
    assert.equal(first.status, "retrying");
    assert.equal(first.http, 500);
    assert.equal(await webhookSignatureMatches("whsec_one", seen[0]!.timestamp, seen[0]!.body, seen[0]!.header), true);
    assert.equal(await webhookSignatureMatches("whsec_one", seen[0]!.timestamp, JSON.stringify({ ...JSON.parse(seen[0]!.body), extra: true }), seen[0]!.header), false);
    const eventId = JSON.parse(seen[0]!.body).id;
    await sql`update biz_webhook_deliveries set next_retry_at = now() - interval '1 minute' where event_id = ${eventId}`;
    await retryDueWebhooks(sql, "biz");
    assert.equal(seen.length, 2);
    assert.equal(JSON.parse(seen[1]!.body).id, eventId);
    assert.equal(seen[1]!.delivery, seen[0]!.delivery);
    assert.equal(await webhookSignatureMatches("whsec_one", seen[1]!.timestamp, seen[1]!.body, seen[1]!.header), true);
    const row = await sql<{ status: string; attempts: number }>`select status, attempts from biz_webhook_deliveries where event_id = ${eventId}`;
    assert.equal(row[0]?.status, "delivered");
    assert.equal(row[0]?.attempts, 2);
  } finally {
    globalThis.fetch = original;
    await db.close();
  }
});

test("http destinations are refused, a disabled endpoint is not called, and a rotated secret signs the next try", async () => {
  const { db, sql } = await fixture();
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls += 1;
    const headers = new Headers(init?.headers);
    const body = String(init?.body);
    assert.equal(await webhookSignatureMatches("whsec_two", headers.get("x-kharcha-timestamp") || "", body, headers.get("x-kharcha-signature") || ""), true);
    assert.equal(await webhookSignatureMatches("whsec_one", headers.get("x-kharcha-timestamp") || "", body, headers.get("x-kharcha-signature") || ""), false);
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    await emitBusinessEvent(sql, "biz", "live", "bill.paid", { id: "bill-1" });
    assert.equal(calls, 1);
    await sql`update biz_webhook_endpoints set url = 'http://hooks.test/kharcha' where id = 'ep'`;
    await emitBusinessEvent(sql, "biz", "live", "bill.paid", { id: "bill-2" });
    await sql`update biz_webhook_endpoints set url = 'https://hooks.test/kharcha', status = 'disabled', secret = 'whsec_two' where id = 'ep'`;
    await emitBusinessEvent(sql, "biz", "live", "bill.paid", { id: "bill-3" });
    assert.equal(calls, 1);
    await sql`
      insert into biz_webhook_deliveries (id, business_id, event, status, attempts, event_id, endpoint_id, payload, environment, next_retry_at)
      values ('old', 'biz', 'bill.paid', 'retry', 1, 'evt-old', 'ep', '{"id":"evt-old","type":"bill.paid","data":{"id":"bill-1"}}', 'live', now() - interval '1 minute')
    `;
    await sql`update biz_webhook_endpoints set status = 'active' where id = 'ep'`;
    await retryDueWebhooks(sql, "biz");
    assert.equal(calls, 2);
    await sql`update biz_webhook_endpoints set status = 'disabled' where id = 'ep'`;
    await sql`
      insert into biz_webhook_deliveries (id, business_id, event, status, attempts, event_id, endpoint_id, payload, environment, next_retry_at)
      values ('dead', 'biz', 'bill.paid', 'retry', 1, 'evt-dead', 'ep', '{"id":"evt-dead"}', 'live', now() - interval '1 minute')
    `;
    await retryDueWebhooks(sql, "biz");
    const dead = await sql<{ status: string }>`select status from biz_webhook_deliveries where id = 'dead'`;
    assert.equal(dead[0]?.status, "failed");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
    await db.close();
  }
});

test("retries stop after the last delay, and two workers cannot both send one due delivery", async () => {
  const { db, sql } = await fixture();
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response("down", { status: 503 });
  }) as typeof fetch;
  try {
    await sql`
      insert into biz_webhook_deliveries (id, business_id, event, status, attempts, event_id, endpoint_id, payload, environment, next_retry_at)
      values ('race', 'biz', 'bill.paid', 'retry', 0, 'evt-race', 'ep', '{"id":"evt-race","type":"bill.paid","data":{}}', 'live', now() - interval '1 second')
    `;
    await Promise.all([retryDueWebhooks(sql, "biz"), retryDueWebhooks(sql, "biz")]);
    assert.equal(calls, 1);
    await sql`update biz_webhook_deliveries set status = 'retry', attempts = 4, next_retry_at = now() - interval '1 second' where id = 'race'`;
    globalThis.fetch = (async () => {
      throw new Error("The operation was aborted due to timeout");
    }) as typeof fetch;
    await retryDueWebhooks(sql, "biz");
    const row = await sql<{ status: string; attempts: number }>`select status, attempts from biz_webhook_deliveries where id = 'race'`;
    assert.equal(row[0]?.status, "failed");
    assert.equal(row[0]?.attempts, 5);
    await retryDueWebhooks(sql, "biz");
    const again = await sql<{ attempts: number }>`select attempts from biz_webhook_deliveries where id = 'race'`;
    assert.equal(again[0]?.attempts, 5);
  } finally {
    globalThis.fetch = original;
    await db.close();
  }
});
