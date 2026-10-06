import assert from "node:assert/strict";
import test from "node:test";
import { assertBalanced } from "./ledger.ts";
import {
  assertOpeningAllowed,
  can,
  claimInvite,
  inviteState,
  periodRange,
  planExistingOpening,
  planStartingMoney,
} from "./biz-access.ts";

const rs = (n: number) => BigInt(n) * 100n;

test("twenty thousand opening cash is capital, not revenue, and cannot be posted twice", () => {
  const journal = planStartingMoney({ amount: rs(20_000), place: "bank", origin: "founder" });
  assertBalanced(journal);
  assert.equal(journal.find((line) => line.code === "1010")?.debit, rs(20_000));
  assert.equal(journal.find((line) => line.code === "3000")?.credit, rs(20_000));
  assert.equal(journal.some((line) => line.code.startsWith("4")), false);
  assert.throws(() => assertOpeningAllowed(true), /already recorded/);
  assert.doesNotThrow(() => assertOpeningAllowed(false));
});

test("an existing business does not dump every balance into share capital", () => {
  const quick = planStartingMoney({ amount: rs(20_000), place: "bank", origin: "existing" });
  assert.equal(quick.find((line) => line.code === "3200")?.credit, rs(20_000));
  assert.equal(quick.find((line) => line.code === "3000"), undefined);
  const full = planExistingOpening({
    bank: rs(20_000),
    cash: 0n,
    receivable: rs(10_000),
    payable: rs(5_000),
    loan: rs(8_000),
    assets: 0n,
    ownerCapital: null,
  });
  assertBalanced(full.lines);
  assert.equal(full.lines.find((line) => line.code === "3000")?.credit, rs(17_000));
  assert.equal(full.lines.find((line) => line.code === "4000"), undefined);
});

test("a viewer cannot change books, and an accountant cannot open API keys or equity", () => {
  assert.equal(can("viewer", "view_finance"), true);
  assert.equal(can("viewer", "create_records"), false);
  assert.equal(can("viewer", "manage_team"), false);
  assert.equal(can("member", "create_records"), true);
  assert.equal(can("member", "manage_api_keys"), false);
  assert.equal(can("member", "view_equity"), false);
  assert.equal(can("accountant", "create_records"), true);
  assert.equal(can("accountant", "view_reports"), true);
  assert.equal(can("accountant", "manage_api_keys"), false);
  assert.equal(can("accountant", "view_equity"), false);
  assert.equal(can("admin", "manage_team"), true);
  assert.equal(can("admin", "manage_api_keys"), false);
  assert.equal(can("admin", "delete_business"), false);
  assert.equal(can("owner", "manage_api_keys"), true);
});

test("invite tokens fail closed when expired, revoked, used, or accepted twice", () => {
  const now = Date.parse("2026-10-07T00:00:00Z");
  assert.equal(inviteState({ revokedAt: null, acceptedAt: null, expiresAt: "2026-10-08T00:00:00Z", now }), "open");
  assert.equal(inviteState({ revokedAt: "x", acceptedAt: null, expiresAt: "2026-10-08T00:00:00Z", now }), "revoked");
  assert.equal(inviteState({ revokedAt: null, acceptedAt: "x", expiresAt: "2026-10-08T00:00:00Z", now }), "used");
  assert.equal(inviteState({ revokedAt: null, acceptedAt: null, expiresAt: "2026-10-06T00:00:00Z", now }), "expired");
  assert.equal(claimInvite("open"), "claimed");
  assert.throws(() => claimInvite("used"), /already used/);
  assert.throws(() => claimInvite("revoked"), /revoked/);
  assert.throws(() => claimInvite("expired"), /expired/);
  assert.equal(periodRange("2026-10-07", "month").label, "This month");
  assert.equal(periodRange("2026-10-07", "year").from, "2026-04-01");
});
