import assert from "node:assert/strict";
import test from "node:test";
import { API_ROUTES, matchApiRoute } from "./api-routes.ts";

test("every documented route resolves, and nothing undocumented is required to exist", () => {
  const ids = new Set<string>();
  for (const route of API_ROUTES) {
    assert.ok(route.summary.length > 20);
    assert.ok(route.scope.includes(":"));
    assert.equal(ids.has(route.id), false);
    ids.add(route.id);
    const sample = route.pattern.replace(":id", "inv_1");
    const hit = matchApiRoute(route.method, sample);
    assert.equal(hit?.route.id, route.id);
    assert.equal(route.summary.toLowerCase().includes("webhook"), false);
  }
  assert.equal(matchApiRoute("GET", "foo"), null);
  assert.equal(API_ROUTES.some((route) => route.pattern === "invoices/:id/pdf"), true);
});
