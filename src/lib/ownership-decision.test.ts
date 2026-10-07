import assert from "node:assert/strict";
import test from "node:test";
import {
  accessGrantFromInvite,
  assignOwnershipIntent,
  buildOwnershipView,
  linkExistingHolder,
  ownershipDecisionWrite,
  sharesFromActivity,
  type OwnershipPerson,
} from "./ownership-decision.ts";

function person(patch: Partial<OwnershipPerson> & Pick<OwnershipPerson, "name" | "role">): OwnershipPerson {
  return {
    id: patch.id ?? patch.name.toLowerCase(),
    userId: patch.userId ?? patch.name.toLowerCase(),
    name: patch.name,
    role: patch.role,
    linked: patch.linked ?? false,
    shares: patch.shares ?? 0n,
    bps: patch.bps ?? 0n,
    decision: patch.decision ?? null,
  };
}

const fareed = person({ id: "owner", userId: "fareed", name: "Fareed", role: "owner", linked: true, shares: 600_000n, bps: 6000n });
const aamir = person({ id: "aamir-member", userId: "aamir", name: "Aamir", role: "admin" });
const zaid = person({ id: "zaid-member", userId: "zaid", name: "Zaid", role: "accountant" });

test("invite accepted does not issue shares or split ownership", () => {
  for (const role of ["admin", "accountant", "member", "viewer"]) {
    const grant = accessGrantFromInvite(role);
    assert.equal(grant.role, role);
    assert.equal(grant.shares, 0n);
    assert.equal(grant.decision, null);
    assert.deepEqual(grant.shareEvents, []);
  }
  assert.throws(() => accessGrantFromInvite("owner"), /Ownership can't be invited/);
  const joined = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "owner",
    members: [fareed, aamir, zaid],
  });
  assert.equal(joined.members.find((member) => member.name === "Aamir")?.ownershipLabel, "Undecided");
  assert.equal(joined.members.every((member) => member.ownershipLabel !== "50%" && member.ownershipLabel !== "33.33%"), true);
});

test("an eligible admin or member gets one ownership prompt until a decision is recorded", () => {
  const open = buildOwnershipView({ businessName: "Munafa", viewerRole: "owner", members: [fareed, aamir, zaid] });
  assert.equal(open.prompt?.title, "Set ownership for Aamir?");
  assert.equal(open.prompt?.body, "Aamir has joined Munafa as a team member, but no company ownership has been assigned.");
  assert.equal(open.prompt?.memberId, "aamir-member");
  assert.equal(open.members.find((member) => member.name === "Fareed")?.ownershipLabel, "60%");
  assert.equal(open.members.find((member) => member.name === "Aamir")?.ownershipLabel, "Undecided");
  assert.equal(open.members.find((member) => member.name === "Zaid")?.ownershipLabel, "No shares");
  const memberToo = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "owner",
    members: [person({ name: "Sam", role: "member" })],
  });
  assert.equal(memberToo.prompt?.name, "Sam");
  const again = buildOwnershipView({ businessName: "Munafa", viewerRole: "owner", members: [fareed, aamir] });
  assert.equal(again.prompt?.memberId, open.prompt?.memberId);
});

test("no shares records a review and the prompt does not return", () => {
  const write = ownershipDecisionWrite("none");
  assert.deepEqual(write.shareEvents, []);
  const view = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "owner",
    members: [fareed, { ...aamir, decision: write.decision }],
  });
  assert.equal(view.prompt, null);
  assert.equal(view.undecided, 0);
  assert.equal(view.reminder, null);
  assert.equal(view.members.find((member) => member.name === "Aamir")?.ownershipLabel, "No shares");
});

test("decide later hides the prompt and leaves a subtle reminder", () => {
  const write = ownershipDecisionWrite("later");
  assert.deepEqual(write.shareEvents, []);
  const view = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "owner",
    members: [fareed, { ...aamir, decision: write.decision }, person({ name: "Rafi", role: "member" })],
  });
  assert.equal(view.prompt?.name, "Rafi");
  const onlyLater = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "owner",
    members: [fareed, { ...aamir, decision: "later" }],
  });
  assert.equal(onlyLater.prompt, null);
  assert.equal(onlyLater.undecided, 1);
  assert.equal(onlyLater.reminder, "1 team member has ownership undecided");
  assert.equal(onlyLater.members.find((member) => member.name === "Aamir")?.ownershipLabel, "Undecided");
  const two = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "admin",
    members: [
      { ...aamir, decision: "later" },
      { ...person({ name: "Rafi", role: "member" }), decision: "later" },
    ],
  });
  assert.equal(two.prompt, null);
  assert.equal(two.reminder, "2 team members have ownership undecided");
});

test("assign ownership opens the equity flow and does not issue shares", () => {
  const intent = assignOwnershipIntent(aamir);
  assert.equal(intent.type, "open-equity");
  assert.equal(intent.holder, "Aamir");
  assert.equal(intent.linkUserId, "aamir");
  assert.deepEqual(intent.shareEvents, []);
  const linked = linkExistingHolder({ holder: "Fareed", linkUserId: "fareed" });
  assert.deepEqual(linked.shareEvents, []);
  const issued = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "owner",
    members: [{ ...aamir, linked: true, shares: 300_000n, bps: 3000n }],
  });
  assert.equal(issued.prompt, null);
  assert.equal(issued.members[0]?.ownershipLabel, "30%");
  assert.equal(issued.reminder, null);
  const owner = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "owner",
    members: [{ ...fareed, linked: true, name: linked.holder, userId: linked.linkUserId }],
  });
  assert.equal(owner.members[0]?.ownershipLabel, "60%");
  assert.equal(owner.prompt, null);
});

test("accountant and viewer do not get an ownership prompt", () => {
  const viewer = person({ name: "Viewer", role: "viewer" });
  const view = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "owner",
    members: [zaid, viewer],
  });
  assert.equal(view.prompt, null);
  assert.equal(view.undecided, 0);
  assert.equal(view.reminder, null);
  assert.equal(view.members.every((member) => member.ownershipLabel === "No shares"), true);
  const asAccountant = buildOwnershipView({ businessName: "Munafa", viewerRole: "accountant", members: [aamir] });
  assert.equal(asAccountant.prompt, null);
  assert.equal(asAccountant.reminder, null);
  const asMember = buildOwnershipView({ businessName: "Munafa", viewerRole: "member", members: [aamir] });
  assert.equal(asMember.prompt, null);
});

test("reimbursement, personal payments, headcount, and role do not create ownership", () => {
  const activity = sharesFromActivity({ teamCount: 3, role: "admin", personalPaid: 120_000n, reimbursement: 120_000n });
  assert.equal(activity.shares, 0n);
  assert.equal(activity.decision, null);
  assert.deepEqual(activity.shareEvents, []);
  const view = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "owner",
    members: [{ ...aamir, shares: activity.shares, decision: activity.decision, linked: false }],
  });
  assert.equal(view.members[0]?.ownershipLabel, "Undecided");
  assert.equal(view.members[0]?.shares, 0n);
  assert.notEqual(view.members[0]?.ownershipLabel, "33.33%");
  const unlinkedShares = buildOwnershipView({
    businessName: "Munafa",
    viewerRole: "owner",
    members: [{ ...aamir, linked: false, shares: 300_000n, bps: 3000n }],
  });
  assert.equal(unlinkedShares.members[0]?.ownershipLabel, "Undecided");
});
