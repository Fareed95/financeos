import { createFileRoute } from "@tanstack/react-router";
import { assertScope, idempotencyDecision, keyStatus } from "@/lib/api-guard";
import { matchApiRoute } from "@/lib/api-routes";
import { getSql, type Sql } from "@/lib/db";
import { dispatchApi } from "@/lib/server/api-handlers";

async function sha256(value: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fail(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status);
}

async function authenticate(sql: Sql, request: Request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.includes(" ")) return { error: fail("invalid_api_key", "Use Authorization: Bearer kh_test_… or kh_live_…", 401) };
  const rows = await sql<{
    id: string;
    business_id: string;
    scopes: string;
    environment: string;
    revoked_at: string | null;
    expires_at: string | null;
    window_start: string | null;
    window_count: number;
  }>`
    select id, business_id, scopes, environment, revoked_at::text as revoked_at, expires_at::text as expires_at,
           window_start::text as window_start, window_count
    from biz_api_keys where hashed_secret = ${await sha256(token)}
  `;
  const key = rows[0];
  if (!key) return { error: fail("invalid_api_key", "Unknown API key.", 401) };
  const status = keyStatus({ revokedAt: key.revoked_at, expiresAt: key.expires_at, now: Date.now() });
  if (status === "revoked") return { error: fail("revoked_key", "This API key has been revoked.", 401) };
  if (status === "expired") return { error: fail("expired_key", "This API key has expired.", 401) };
  const expected = token.startsWith("kh_live_") ? "live" : token.startsWith("kh_test_") ? "test" : "";
  if (!expected || key.environment !== expected) return { error: fail("invalid_api_key", "Key environment does not match.", 401) };
  const windowStart = key.window_start ? Date.parse(key.window_start) : 0;
  const fresh = Date.now() - windowStart > 60_000;
  if (!fresh && key.window_count >= 120) return { error: fail("rate_limited", "Too many requests. Wait a minute.", 429) };
  await sql`
    update biz_api_keys set
      last_used_at = now(),
      window_start = ${fresh ? new Date().toISOString() : key.window_start},
      window_count = ${fresh ? 1 : key.window_count + 1}
    where id = ${key.id}
  `;
  return { key, scopes: key.scopes.split(",").filter(Boolean), environment: key.environment as "live" | "test" };
}

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
      PATCH: ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  let businessId = "";
  let keyId = "";
  let environment = "";
  try {
    const sql = await getSql();
    const auth = await authenticate(sql, request);
    if ("error" in auth && auth.error) return auth.error;
    const session = auth as { key: { id: string; business_id: string }; scopes: string[]; environment: "live" | "test" };
    businessId = session.key.business_id;
    keyId = session.key.id;
    environment = session.environment;
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1\/?/, "");
    const hit = matchApiRoute(request.method, path);
    if (!hit) return fail("not_found", "That endpoint does not exist.", 404);
    assertScope(session.scopes, hit.route.scope);
    const bodyText = request.method === "GET" ? "" : await request.text();
    const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
    const idem = request.headers.get("idempotency-key");
    const run = () =>
      dispatchApi(hit.route, {
        sql,
        businessId,
        environment: session.environment,
        params: hit.params,
        body,
        today: new Date().toISOString().slice(0, 10),
      });
    let response: Response;
    if (request.method !== "GET" && idem) {
      const hash = await sha256(`${request.method} ${path} ${bodyText}`);
      const prior = await sql<{ request_hash: string; status_code: number; response_body: string }>`
        select request_hash, status_code, response_body from biz_idempotency
        where business_id = ${businessId} and idempotency_key = ${idem}
      `;
      const decision = idempotencyDecision(
        prior[0] ? { hash: prior[0].request_hash, status: prior[0].status_code, body: prior[0].response_body } : null,
        hash,
      );
      if (decision.kind === "conflict") return fail("idempotency_conflict", "That Idempotency-Key was already used with a different request.", 409);
      if (decision.kind === "replay") {
        response = new Response(decision.body, { status: decision.status, headers: { "content-type": "application/json", "x-request-id": requestId } });
      } else {
        response = await run();
        const text = response.headers.get("content-type")?.includes("json") ? await response.clone().text() : "";
        if (text) {
          await sql`
            insert into biz_idempotency (id, business_id, idempotency_key, request_hash, status_code, response_body)
            values (${crypto.randomUUID()}, ${businessId}, ${idem}, ${hash}, ${response.status}, ${text})
          `;
        }
      }
    } else {
      response = await run();
    }
    await log(sql, { businessId, keyId, requestId, method: request.method, path: `/${path}`, status: response.status, environment, errorCode: null, started });
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (err) {
    const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 400;
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : status === 403 ? "insufficient_scope" : "invalid_request";
    const message = err instanceof Error ? err.message : "Request failed";
    if (businessId) {
      const sql = await getSql();
      await log(sql, { businessId, keyId, requestId, method: request.method, path: new URL(request.url).pathname.replace(/^\/api\/v1/, "") || "/", status, environment, errorCode: code, started }).catch(() => undefined);
    }
    return fail(code, message, status || 400);
  }
}

async function log(
  sql: Sql,
  input: { businessId: string; keyId: string; requestId: string; method: string; path: string; status: number; environment: string; errorCode: string | null; started: number },
) {
  await sql`
    insert into biz_api_logs (id, business_id, key_id, request_id, method, path, status, duration_ms, error_code, environment)
    values (
      ${crypto.randomUUID()}, ${input.businessId}, ${input.keyId}, ${input.requestId}, ${input.method}, ${input.path},
      ${input.status}, ${Date.now() - input.started}, ${input.errorCode}, ${input.environment || "live"}
    )
  `;
}
