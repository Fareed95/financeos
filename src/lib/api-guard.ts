export function assertScope(scopes: string[], needed: string) {
  if (!scopes.includes(needed)) {
    const error = new Error(`This API key requires ${needed}.`) as Error & { status: number; code: string };
    error.status = 403;
    error.code = "insufficient_scope";
    throw error;
  }
}

export function keyStatus(input: { revokedAt: string | null; expiresAt: string | null; now: number }) {
  if (input.revokedAt) return "revoked" as const;
  if (input.expiresAt && Date.parse(input.expiresAt) <= input.now) return "expired" as const;
  return "active" as const;
}

export function idempotencyDecision(
  existing: { hash: string; status: number; body: string } | null,
  hash: string,
) {
  if (!existing) return { kind: "fresh" as const };
  if (existing.hash !== hash) return { kind: "conflict" as const };
  return { kind: "replay" as const, status: existing.status, body: existing.body };
}
