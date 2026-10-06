import type { Sql } from "@/lib/db";
import { webhookRetryDelayMs } from "@/lib/ops";
import { webhookSignature } from "@/lib/webhook-sign";

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
  const signature = webhookSignature(secret, timestamp, payload);
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
    if (row.endpoint_status !== "active" || !row.url.startsWith("https://") || !row.payload || !row.event_id) continue;
    await attemptDelivery(sql, row.id, row.url, row.secret, row.event, row.event_id, row.payload, row.attempts);
  }
}
