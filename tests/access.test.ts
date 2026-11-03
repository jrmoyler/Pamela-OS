import { test } from "node:test";
import assert from "node:assert/strict";
import { computerGate, looksOutbound, trustUntil, permissionReply } from "../src/lib/hub/access";

const ALL = ["browser", "computer", "files"];
const now = new Date("2026-11-03T20:00:00Z");

test("computer gate: ask, allow, block, kinds and trust windows", () => {
  assert.equal(computerGate({ policy: "ask", kinds: ALL, trustUntil: null }, "browser", now).decision, "ask");
  assert.deepEqual(computerGate({ policy: "allow", kinds: ALL, trustUntil: null }, "files", now), { decision: "queue", via: "allowed" });
  assert.equal(computerGate({ policy: "block", kinds: ALL, trustUntil: null }, "browser", now).decision, "block");
  // A kind she didn't allow is refused even when the agent is always allowed.
  assert.equal(computerGate({ policy: "allow", kinds: ["browser"], trustUntil: null }, "computer", now).decision, "block");
  const later = new Date(now.getTime() + 3600_000);
  const earlier = new Date(now.getTime() - 1);
  assert.deepEqual(computerGate({ policy: "ask", kinds: ALL, trustUntil: later }, "browser", now), { decision: "queue", via: "trusted" });
  assert.equal(computerGate({ policy: "ask", kinds: ALL, trustUntil: earlier }, "browser", now).decision, "ask");
  // Blocking wins over a leftover trust window.
  assert.equal(computerGate({ policy: "block", kinds: ALL, trustUntil: later }, "browser", now).decision, "block");
});

test("trust windows end after the hours asked, or at local midnight", () => {
  assert.equal(trustUntil("1h", now).getTime(), now.getTime() + 3600_000);
  assert.equal(trustUntil("4h", now).getTime(), now.getTime() + 4 * 3600_000);
  // 20:00 UTC on Nov 3 is 12:00 PST; midnight Los Angeles is 08:00 UTC Nov 4.
  assert.equal(trustUntil("today", now, "America/Los_Angeles").toISOString(), "2026-11-04T08:00:00.000Z");
});

test("outbound heuristic flags sends and payments, not downloads", () => {
  assert.ok(looksOutbound("Send this email to the client"));
  assert.ok(looksOutbound("Click check out and pay the invoice"));
  assert.ok(!looksOutbound("Download the payment history PDF"));
  assert.ok(!looksOutbound("Sign in to the LegalShield associate portal"));
});

test("permission replies tell Hermes exactly what to do", () => {
  const base = { id: "p", taskId: "t", agentKeyId: null, requestedBy: "hermes", category: "sign_in", action: "Sign in", detail: null, url: null, note: null, decidedAt: null, expiresAt: null, createdAt: now };
  assert.match(permissionReply({ ...base, status: "pending" }).instruction, /don't do the step yet/);
  assert.match(permissionReply({ ...base, status: "approved", note: "use the work profile" }).instruction, /Do only this step.*work profile/);
  assert.match(permissionReply({ ...base, status: "denied" }).instruction, /Skip this step/);
  assert.match(permissionReply({ ...base, status: "expired" }).instruction, /didn't answer in time/);
});
