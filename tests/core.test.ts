import { test } from "node:test";
import assert from "node:assert/strict";
import { lintBrand, autoFixBrand } from "../src/lib/brand";
import { availableSlots, isInBlackout, zonedParts, zonedToUtc, overlapsBlackout, dayBounds, weekBounds } from "../src/lib/time";
import { applyDictionary } from "../src/lib/dictation";
import { evalConditions, render } from "../src/lib/automations";
import { personalize } from "../src/lib/approvals";
import { signedMediaUrl, verifyMediaSig } from "../src/lib/outbound";
import { hashPassword, verifyPassword } from "../src/lib/crypto";
import { rangeResponse } from "../src/lib/http";

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

test("overlapsBlackout catches short intervals straddling a window edge", () => {
  // 14:58–15:02 Wed: 5-minute sampling used to probe only 14:58 and miss 15:00.
  assert.ok(overlapsBlackout(zonedToUtc(2026, 10, 21, 14, 58, TZ), zonedToUtc(2026, 10, 21, 15, 2, TZ), BLACKOUT, TZ));
  // Touching the edges is not an overlap ([start, end) semantics).
  assert.ok(!overlapsBlackout(zonedToUtc(2026, 10, 21, 14, 30, TZ), zonedToUtc(2026, 10, 21, 15, 0, TZ), BLACKOUT, TZ));
  assert.ok(!overlapsBlackout(zonedToUtc(2026, 10, 21, 17, 30, TZ), zonedToUtc(2026, 10, 21, 18, 0, TZ), BLACKOUT, TZ));
  // Weekend and multi-day spans.
  assert.ok(!overlapsBlackout(zonedToUtc(2026, 10, 24, 14, 0, TZ), zonedToUtc(2026, 10, 24, 18, 0, TZ), BLACKOUT, TZ));
  assert.ok(overlapsBlackout(zonedToUtc(2026, 10, 24, 9, 0, TZ), zonedToUtc(2026, 10, 26, 15, 1, TZ), BLACKOUT, TZ));
});

test("day and week bounds end at local midnight across DST", () => {
  // Sunday Nov 1 2026 is the fall-back day in Los Angeles (25 hours long).
  const d = dayBounds(zonedToUtc(2026, 11, 1, 12, 0, TZ), TZ);
  assert.equal(d.end.getTime() - d.start.getTime(), 25 * 3_600_000);
  assert.deepEqual([zonedParts(d.end, TZ).day, zonedParts(d.end, TZ).hour], [2, 0]);
  const w = weekBounds(zonedToUtc(2026, 10, 28, 12, 0, TZ), TZ); // week of Mon Oct 26
  assert.deepEqual([zonedParts(w.start, TZ).day, zonedParts(w.end, TZ).month, zonedParts(w.end, TZ).day, zonedParts(w.end, TZ).hour], [26, 11, 2, 0]);
});

test("personalize and dictionary insert '$' literally", () => {
  assert.equal(personalize("Hi {{first_name}}", { firstName: "$&$1", lastName: "", email: null, phone: null }), "Hi $&$1");
  assert.equal(applyDictionary("price is ten bucks", [{ from: "ten bucks", to: "$10" }]), "price is $10");
});

test("media signatures reject bad expiry and wrong sigs", () => {
  const url = new URL(signedMediaUrl("file-1"));
  const exp = url.searchParams.get("exp")!;
  const sig = url.searchParams.get("sig")!;
  assert.ok(verifyMediaSig("file-1", exp, sig));
  assert.ok(!verifyMediaSig("file-2", exp, sig));
  assert.ok(!verifyMediaSig("file-1", exp, sig.slice(0, -1)));
  assert.ok(!verifyMediaSig("file-1", "abc", sig));
  assert.ok(!verifyMediaSig("file-1", "1", sig));
});

test("password verification rejects malformed stored hashes", () => {
  assert.ok(verifyPassword("pw", hashPassword("pw")));
  assert.ok(!verifyPassword("other", hashPassword("pw")));
  assert.ok(!verifyPassword("anything", "scrypt$aa$zz"));
});

test("range responses honour suffix ranges and reject unsatisfiable ones", async () => {
  const data = Buffer.from("0123456789");
  const req = (range: string) => new Request("http://x/f", { headers: { range } });
  const tail = rangeResponse(req("bytes=-3"), data, "text/plain", "f.txt");
  assert.equal(tail.status, 206);
  assert.equal(await tail.text(), "789");
  assert.equal(tail.headers.get("content-range"), "bytes 7-9/10");
  assert.equal(rangeResponse(req("bytes=20-"), data, "text/plain", "f.txt").status, 416);
  assert.equal(await rangeResponse(req("bytes=2-4"), data, "text/plain", "f.txt").text(), "234");
});

test("lowercase brand name is flagged", () => {
  assert.ok(lintBrand("welcome to a cup of compassion").some((i) => i.code === "bare_name"));
});

test("share links are rewritten to direct downloads", async () => {
  const { directDownloadUrl } = await import("../src/lib/hub/sources");
  assert.equal(directDownloadUrl("https://drive.google.com/file/d/abc123/view?usp=sharing"), "https://drive.google.com/uc?export=download&id=abc123");
  assert.equal(directDownloadUrl("https://docs.google.com/document/d/XYZ/edit"), "https://docs.google.com/document/d/XYZ/export?format=pdf");
  assert.equal(directDownloadUrl("https://docs.google.com/spreadsheets/d/XYZ/edit#gid=0"), "https://docs.google.com/spreadsheets/d/XYZ/export?format=xlsx");
  assert.equal(directDownloadUrl("https://www.dropbox.com/scl/fi/a/b.pdf?rlkey=k&dl=0"), "https://www.dropbox.com/scl/fi/a/b.pdf?rlkey=k&dl=1");
  assert.equal(directDownloadUrl("https://example.com/a.pdf"), "https://example.com/a.pdf");
});

test("link imports refuse private network addresses", async () => {
  const { fetchRemote } = await import("../src/lib/hub/sources");
  for (const u of ["http://127.0.0.1/x", "http://localhost:3000/api/export", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "file:///etc/passwd"]) {
    await assert.rejects(fetchRemote(u), /private|http/i, u);
  }
});

test("MCP tools are limited by the key's scopes", async () => {
  const { toolsFor } = await import("../src/lib/hub/mcp");
  const key = (client: string, scopes: string[]) =>
    ({ id: "k", name: "test", client, scopes, tokenHash: "", tokenPrefix: "", lastUsedAt: null, revokedAt: null, createdAt: new Date() }) as Parameters<typeof toolsFor>[0];
  const writeOnly = toolsFor(key("meta", ["write"])).map((t) => t.name);
  assert.ok(writeOnly.includes("push_file") && writeOnly.includes("draft_email"));
  assert.ok(!writeOnly.includes("search_contacts") && !writeOnly.includes("get_file") && !writeOnly.includes("request_computer_task"));
  const claude = toolsFor(key("claude", ["read", "write", "computer"])).map((t) => t.name);
  assert.ok(claude.includes("request_computer_task") && !claude.includes("next_computer_task"));
  const hermes = toolsFor(key("hermes", ["computer"])).map((t) => t.name);
  assert.ok(hermes.includes("next_computer_task") && hermes.includes("finish_computer_task"));
});
