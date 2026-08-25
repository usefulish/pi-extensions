import { strict as assert } from "node:assert";
import { describe, it } from "mocha";
import { CONTENT_FREE_SAFE, createGuard, guardCheck, isSeverity, nextCycle, normalizeNote, parseReviewOutput, sanitizeNote } from "../lib/emission-guard";

describe("sanitizeNote", () => {
  it("strips control chars, zero-width, and bidi overrides", () => {
    assert.equal(sanitizeNote("clean note"), "clean note");
    assert.equal(sanitizeNote("invis\u200Bible\u2069"), "invisible");
    assert.equal(sanitizeNote("bad\u0000\u001Fcontrol"), "badcontrol");
    assert.equal(sanitizeNote("rtl\u202Eoverride"), "rtloverride");
  });

  it("guard-accepted notes are sanitized on accept", () => {
    const g = createGuard();
    const verdict = guardCheck(g, "nit", "note\u200Bwith\u202Ehidden");
    assert.equal(verdict.accepted, true);
    if (verdict.accepted) assert.equal(verdict.note, "notewithhidden");
  });
});

describe("normalizeNote", () => {
  it("lowercases, NFKC-normalizes, collapses non-alphanumerics, trims", () => {
    assert.equal(normalizeNote("  *Stop.* "), "stop");
    assert.equal(normalizeNote("LGTM!!"), "lgtm");
    assert.equal(normalizeNote("No-issue   CONTINUE"), "no issue continue");
    assert.equal(normalizeNote(""), "");
    assert.equal(normalizeNote("  ---  "), "");
  });
});

describe("guardCheck", () => {
  it("rejects empty notes", () => {
    const g = createGuard();
    assert.deepEqual(guardCheck(g, "nit", "   "), { accepted: false, reason: "empty" });
    assert.equal(g.counts.suppressed, 1);
  });

  it("rejects content-free phrases", () => {
    const g = createGuard();
    for (const phrase of ["stop", "LGTM", "*Done*", "no issue continue", "nothing to add", "looks good"]) {
      assert.deepEqual(guardCheck(g, "nit", phrase), { accepted: false, reason: "content-free" }, `phrase: ${phrase}`);
    }
  });

  it("rejects notes that end with a no-op verdict even when wrapped in prose (padv-c9 regression)", () => {
    const g = createGuard();
    const cases = [
      "Change made as requested (x>0 → x<0 in src/check.ts only). No verification step was run, but the edit is a trivial one-line inversion matching the request exactly. No note warranted.",
      "Everything looks correct and matches the request. Nothing to flag.",
      "The edit is fine as instructed. No action needed.",
      "No issues found — the change is correct.",
    ];
    for (const note of cases) {
      assert.deepEqual(guardCheck(g, "nit", note), { accepted: false, reason: "content-free" }, `note: ${note.slice(0, 60)}…`);
    }
  });

  it("still accepts a substantive note that merely mentions the words no note", () => {
    const g = createGuard();
    // ends with an actionable clause, not a no-op verdict
    const note = "No note was added to the changelog for this API change — add one before release";
    assert.equal(guardCheck(g, "nit", note).accepted, true);
  });

  it("accepts a substantive note once per cycle", () => {
    const g = createGuard();
    const verdict = guardCheck(g, "nit", "The edit targets src/old.ts but the caller imports lib/new.ts — verify the path");
    assert.equal(verdict.accepted, true);
  });

  it("rate-limits to one note per cycle", () => {
    const g = createGuard();
    assert.equal(guardCheck(g, "nit", "First substantive note about the build").accepted, true);
    assert.deepEqual(guardCheck(g, "nit", "Second different note about tests"), { accepted: false, reason: "rate-limit" });
    nextCycle(g);
    assert.equal(guardCheck(g, "nit", "Second different note about tests").accepted, true);
  });

  it("suppresses equal-or-lower severity duplicates, allows escalation", () => {
    const g = createGuard();
    assert.equal(guardCheck(g, "nit", "Wrong file path in the edit").accepted, true);
    nextCycle(g);
    // same text, same severity → duplicate (permanent by default window = Infinity)
    assert.deepEqual(guardCheck(g, "nit", "Wrong file path in the edit!"), { accepted: false, reason: "duplicate" });
    // same text, higher severity → escalation passes
    nextCycle(g);
    const escalated = guardCheck(g, "blocker", "Wrong file path in the edit");
    assert.equal(escalated.accepted, true);
    // after escalation, lower severity is again a duplicate
    nextCycle(g);
    assert.deepEqual(guardCheck(g, "concern", "Wrong file path in the edit"), { accepted: false, reason: "duplicate" });
  });

  it("same note re-delivers after the immuneTurns window, not before", () => {
    const g = createGuard();
    const window = 3;
    const text = "Consider error handling for empty input";
    // first review: accepted at n
    assert.equal(guardCheck(g, "nit", text, window).accepted, true);
    g.reviewIndex++;
    nextCycle(g);
    assert.deepEqual(guardCheck(g, "nit", text, window), { accepted: false, reason: "duplicate" }, "n+1 within window → still deduped");
    nextCycle(g);
    g.reviewIndex++;
    assert.deepEqual(guardCheck(g, "nit", text, window), { accepted: false, reason: "duplicate" }, "n+2 still within window");
    nextCycle(g);
    g.reviewIndex++;
    assert.deepEqual(guardCheck(g, "nit", text, window), { accepted: false, reason: "duplicate" }, "n+3 boundary still within");
    nextCycle(g);
    g.reviewIndex++;
    assert.equal(guardCheck(g, "nit", text, window).accepted, true, "n+window+1 outside window → re-delivered");
  });

  it("content-free phrase embedded in longer note is NOT suppressed", () => {
    const g = createGuard();
    assert.equal(guardCheck(g, "nit", "Stop the rename: package.json still imports the old name").accepted, true);
  });

  it("FIFO caps delivered history", () => {
    const g = createGuard();
    for (let i = 0; i < 1100; i++) {
      guardCheck(g, "nit", `unique note number ${i} with substance`);
      nextCycle(g);
    }
    assert.ok(g.delivered.size <= 1024, `delivered map size ${g.delivered.size}`);
  });
});

describe("parseReviewOutput", () => {
  it("parses a strict JSON note line", () => {
    const note = parseReviewOutput('{"severity":"concern","note":"Verify the auth guard covers /api/v2"}');
    assert.deepEqual(note, { severity: "concern", note: "Verify the auth guard covers /api/v2" });
  });

  it("empty/blank output means no note", () => {
    assert.equal(parseReviewOutput(""), undefined);
    assert.equal(parseReviewOutput("   \n  "), undefined);
  });

  it("unparseable output is no note (conservative)", () => {
    assert.equal(parseReviewOutput("looks fine to me, keep going"), undefined);
    assert.equal(parseReviewOutput("{broken json"), undefined);
  });

  it("rejects invalid severity or missing note", () => {
    assert.equal(parseReviewOutput('{"severity":"urgent","note":"x"}'), undefined);
    assert.equal(parseReviewOutput('{"severity":"nit"}'), undefined);
    assert.equal(parseReviewOutput('{"severity":"nit","note":"   "}'), undefined);
  });

  it("clamps long notes to 280 chars", () => {
    const note = parseReviewOutput(`{"severity":"nit","note":"${"x".repeat(500)}"}`);
    assert.equal(note?.note.length, 280);
  });

  it("extracts JSON from surrounding prose", () => {
    const note = parseReviewOutput('Here is my review:\n{"severity":"blocker","note":"the deploy will fail"}\nthanks');
    assert.deepEqual(note, { severity: "blocker", note: "the deploy will fail" });
  });

  it("isSeverity narrows correctly", () => {
    assert.equal(isSeverity("nit"), true);
    assert.equal(isSeverity("blocker"), true);
    assert.equal(isSeverity("urgent"), false);
    assert.equal(isSeverity(undefined), false);
  });
});
