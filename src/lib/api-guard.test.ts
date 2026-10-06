import assert from "node:assert/strict";
import test from "node:test";
import { assertScope, idempotencyDecision, keyStatus } from "./api-guard.ts";

test("a key without the scope is rejected", () => {
  assert.throws(() => assertScope(["invoices:read"], "transactions:create"), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 403);
    return true;
  });
  assert.doesNotThrow(() => assertScope(["invoices:create", "payments:create"], "payments:create"));
});

test("revoked and expired keys are rejected", () => {
  assert.equal(keyStatus({ revokedAt: "2026-01-01", expiresAt: null, now: Date.parse("2026-04-01") }), "revoked");
  assert.equal(keyStatus({ revokedAt: null, expiresAt: "2026-01-01T00:00:00.000Z", now: Date.parse("2026-04-01") }), "expired");
  assert.equal(keyStatus({ revokedAt: null, expiresAt: null, now: Date.now() }), "active");
});

test("the same idempotency key returns one result and a different body conflicts", () => {
  const stored = { hash: "abc", status: 201, body: "{\"id\":\"1\"}" };
  assert.equal(idempotencyDecision(null, "abc").kind, "fresh");
  const replay = idempotencyDecision(stored, "abc");
  assert.equal(replay.kind, "replay");
  if (replay.kind === "replay") assert.equal(replay.body, stored.body);
  assert.equal(idempotencyDecision(stored, "other").kind, "conflict");
});
