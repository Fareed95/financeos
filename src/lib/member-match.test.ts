import assert from "node:assert/strict";
import test from "node:test";
import { matchMember } from "./member-match.ts";

const people = [
  { userId: "f", name: "Fareed Sayed" },
  { userId: "y", name: "Yunus" },
];

test("me is the signed-in member", () => {
  assert.equal(matchMember(people, "me", "f").userId, "f");
  assert.equal(matchMember(people, "maine", "f").name, "Fareed Sayed");
});

test("first name matches when it is unique", () => {
  assert.equal(matchMember(people, "yunus", "f").userId, "y");
});

test("unknown name says who is on the project", () => {
  assert.throws(() => matchMember(people, "Zara", "f"), /Fareed Sayed, Yunus/);
});
