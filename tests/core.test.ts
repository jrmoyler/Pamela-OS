import { test } from "node:test";
import assert from "node:assert/strict";
import { lintBrand, autoFixBrand } from "../src/lib/brand";
import { availableSlots, isInBlackout, zonedParts, zonedToUtc, overlapsBlackout } from "../src/lib/time";
import { applyDictionary } from "../src/lib/dictation";
import { evalConditions, render } from "../src/lib/automations";
import { personalize } from "../src/lib/approvals";

const TZ = "America/Los_Angeles";
const BLACKOUT = [{ days: [1, 2, 3, 4, 5], start: "15:00", end: "17:30", label: "family" }];

test("brand lint flags abbreviations, bare name and phone format", () => {
  const issues = lintBrand("Thanks from ACOC and cup of compassion! Call 323-943-2287").map((i) => i.code);
  assert.ok(issues.includes("abbrev"));
  assert.ok(issues.includes("bare_name"));
  assert.ok(issues.includes("phone"));
  assert.deepEqual(lintBrand("A Cup of Compassion — call (323) 943-ACUP"), []);
});

test("brand autofix produces the exact name and phone", () => {
  const fixed = autoFixBrand("Join the cup of compassion gala (ACOC). Call 323.943.2287");
  assert.equal(fixed, "Join A Cup of Compassion gala (A Cup of Compassion). Call (323) 943-ACUP");
  assert.deepEqual(lintBrand(fixed), []);
});

test("blackout window is weekdays 3:00–5:30 PM local", () => {
  const wed4pm = zonedToUtc(2026, 10, 21, 16, 0, TZ);
  const wed545 = zonedToUtc(2026, 10, 21, 17, 45, TZ);
  const sat4pm = zonedToUtc(2026, 10, 24, 16, 0, TZ);
  assert.ok(isInBlackout(wed4pm, BLACKOUT, TZ));
  assert.equal(isInBlackout(wed545, BLACKOUT, TZ), null);
  assert.equal(isInBlackout(sat4pm, BLACKOUT, TZ), null);
  assert.ok(overlapsBlackout(zonedToUtc(2026, 10, 21, 14, 45, TZ), zonedToUtc(2026, 10, 21, 15, 15, TZ), BLACKOUT, TZ));
});

test("zonedToUtc round-trips across DST", () => {
  for (const [m, d] of [[3, 9], [11, 2], [7, 1]]) {
    const utc = zonedToUtc(2026, m, d, 9, 30, TZ);
    const p = zonedParts(utc, TZ);
    assert.deepEqual([p.month, p.day, p.hour, p.minute], [m, d, 9, 30]);
  }
});

test("slots never land in the blackout or on busy times", () => {
  const from = zonedToUtc(2026, 10, 19, 0, 0, TZ); // Monday
  const busy = [{ startsAt: zonedToUtc(2026, 10, 19, 10, 0, TZ), endsAt: zonedToUtc(2026, 10, 19, 10, 30, TZ) }];
  const slots = availableSlots({
    hours: { mon: [{ start: "09:00", end: "18:00" }] },
    durationMin: 30,
    bufferMin: 0,
    from,
    days: 1,
    busy,
    blackouts: BLACKOUT,
    tz: TZ,
    minLeadMin: 0,
  });
  const labels = slots.map((s) => {
    const p = zonedParts(s, TZ);
    return `${p.hour}:${String(p.minute).padStart(2, "0")}`;
  });
  assert.ok(labels.includes("9:00"));
  assert.ok(!labels.includes("10:00"));
  assert.ok(!labels.some((l) => ["15:00", "15:30", "16:00", "16:30", "17:00"].includes(l)));
  assert.ok(labels.includes("17:30"));
  assert.ok(labels.includes("14:30"));
});

test("custom dictionary fixes terms case-insensitively", () => {
  assert.equal(applyDictionary("ask legal  shield about a cup of compassion", [
    { from: "legal shield", to: "LegalShield" },
    { from: "a cup of compassion", to: "A Cup of Compassion" },
  ]), "ask LegalShield about A Cup of Compassion");
});

test("automation conditions and templating", () => {
  const ctx = {
    event: { id: "e", type: "call.completed", source: "t", payload: {}, createdAt: new Date(), processedAt: null },
    payload: { urgency: "urgent", summary: "Needs help" },
    contact: { firstName: "Ruth", lastName: "B", tags: ["vip"], relationshipTypes: ["Board"] } as never,
  };
  assert.ok(evalConditions([{ field: "payload.urgency", op: "eq", value: "urgent" }], ctx));
  assert.ok(evalConditions([{ field: "contact.tags", op: "contains", value: "vip" }], ctx));
  assert.ok(!evalConditions([{ field: "payload.urgency", op: "eq", value: "normal" }], ctx));
  assert.equal(render("Hi {{first_name}}: {{payload.summary}}", ctx), "Hi Ruth: Needs help");
});

test("campaign personalization", () => {
  assert.equal(personalize("Hi {{first_name}}!", { firstName: "", lastName: "", email: null, phone: null }), "Hi friend!");
  assert.equal(personalize("Hi {{ firstName }} {{last_name}}", { firstName: "Ann", lastName: "Lee", email: null, phone: null }), "Hi Ann Lee");
});
