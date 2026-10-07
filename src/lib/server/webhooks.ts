import type { Sql } from "../db.ts";
import { webhookRetryDelayMs } from "../ops.ts";
import { webhookSignature } from "../webhook-sign.ts";

export const WEBHOOK_EVENTS = [
  "invoice.created",
  "invoice.issued",
  "invoice.partially_paid",
  "invoice.paid",
  "payment.created",
  "customer.created",
  "expense.created",
  "bill.created",
  "bill.paid",
] as const;

const MAX_ATTEMPTS = 5;

export async function emitBusinessEvent(
  sql: Sql,
  businessId: string,
  environment: "live" | "test",
  event: (typeof WEBHOOK_EVENTS)[number],
  data: Record<string, unknown>,
) {
  const eventId = crypto.randomUUID();
  const endpoints = await sql<{ id: string; url: string; secret: string; events: string }>`
    select id, url, secret, events from biz_webhook_endpoints
    where business_id = ${businessId} and environment = ${environment} and status = 'active'
  `;
  for (const endpoint of endpoints) {
    if (!endpoint.events.split(",").includes(event)) continue;
    if (!endpoint.url.startsWith("https://")) continue;
    const payload = JSON.stringify({ id: eventId, type: event, data });
    const deliveryId = crypto.randomUUID();
    await sql`
      insert into biz_webhook_deliveries (
        id, business_id, event, status, attempts, event_id, endpoint_id, payload, environment
      ) values (
        ${deliveryId}, ${businessId}, ${event}, 'pending', 0, ${eventId}, ${endpoint.id}, ${payload}, ${environment}
      )
    `;
    await attemptDelivery(sql, deliveryId, endpoint.url, endpoint.secret, event, eventId, payload, 0);
  }
}

async function attemptDelivery(
  sql: Sql,
  deliveryId: string,
  url: string,
  secret: string,
  event: string,
  eventId: string,
  payload: string,
  attempt: number,
) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await webhookSignature(secret, timestamp, payload);
  const started = Date.now();
  let status = 0;
  let summary = "";
  let ok = false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kharcha-event": event,
        "x-kharcha-delivery": deliveryId,
        "x-kharcha-timestamp": timestamp,
        "x-kharcha-signature": signature.header,
      },
      body: payload,
      signal: AbortSignal.timeout(8000),
    });
    status = response.status;
    summary = (await response.text()).slice(0, 300);
    ok = response.ok;
  } catch (error) {
    summary = error instanceof Error ? error.message.slice(0, 300) : "Delivery failed";
  }
  const delay = ok ? null : webhookRetryDelayMs(attempt);
  const next = delay == null ? null : new Date(Date.now() + delay).toISOString();
  await sql`
    update biz_webhook_deliveries set
      status = ${ok ? "delivered" : delay == null ? "failed" : "retry"},
      attempts = ${attempt + 1},
      http_status = ${status},
      duration_ms = ${Date.now() - started},
      response_summary = ${summary},
      next_retry_at = ${next}
    where id = ${deliveryId}
  `;
}

export async function retryDueWebhooks(sql: Sql, businessId: string) {
  await sql`
    update biz_webhook_deliveries
    set status = 'retry'
    where business_id = ${businessId} and status = 'delivering' and next_retry_at is not null and next_retry_at <= now()
  `;
  const due = await sql<{
    id: string;
    event: string;
    event_id: string;
    payload: string;
    attempts: number;
    url: string;
    secret: string;
    endpoint_status: string;
  }>`
    select d.id, d.event, d.event_id, d.payload, d.attempts, e.url, e.secret, e.status as endpoint_status
    from biz_webhook_deliveries d
    join biz_webhook_endpoints e on e.id = d.endpoint_id
    where d.business_id = ${businessId} and d.status = 'retry' and d.next_retry_at <= now() and d.attempts < ${MAX_ATTEMPTS}
  `;
  for (const row of due) {
    const claimed = await sql<{ id: string }>`
      update biz_webhook_deliveries
      set status = 'delivering', next_retry_at = now() + interval '2 minutes'
      where id = ${row.id} and business_id = ${businessId} and status = 'retry' and next_retry_at <= now() and attempts < ${MAX_ATTEMPTS}
      returning id
    `;
    if (!claimed[0]) continue;
    if (row.endpoint_status !== "active" || !row.url.startsWith("https://") || !row.payload || !row.event_id) {
      await sql`
        update biz_webhook_deliveries set status = 'failed', response_summary = 'Endpoint is not active'
        where id = ${row.id}
      `;
      continue;
    }
    await attemptDelivery(sql, row.id, row.url, row.secret, row.event, row.event_id, row.payload, row.attempts);
  }
}

export async function deliverTestPing(
  sql: Sql,
  businessId: string,
  endpoint: { id: string; url: string; secret: string },
) {
  const eventId = crypto.randomUUID();
  const deliveryId = crypto.randomUUID();
  const payload = JSON.stringify({ id: eventId, type: "test.ping", data: { ok: true } });
  await sql`
    insert into biz_webhook_deliveries (id, business_id, event, status, attempts, event_id, endpoint_id, payload, environment)
    values (${deliveryId}, ${businessId}, 'test.ping', 'pending', 0, ${eventId}, ${endpoint.id}, ${payload}, 'live')
  `;
  await attemptDelivery(sql, deliveryId, endpoint.url, endpoint.secret, "test.ping", eventId, payload, 0);
  const rows = await sql<{ status: string; http_status: number | null; duration_ms: number | null; attempts: number }>`
    select status, http_status, duration_ms, attempts from biz_webhook_deliveries where id = ${deliveryId}
  `;
  const row = rows[0];
  return {
    status: row?.status === "delivered" ? "delivered" : row?.status === "retry" ? "retrying" : "failed",
    http: row?.http_status ?? 0,
    durationMs: row?.duration_ms ?? 0,
    attempts: row?.attempts ?? 1,
    eventId,
  };
}
