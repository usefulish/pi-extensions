import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "mocha";
import { createRuntime, reviewTurn, type WatcherHost, type IsolatedCall } from "../lib/watcher";
import type { AdvisorConfig } from "../lib/config";

// Injectable fake isolated-model call — tests never hit a provider.
let reply = "";
let failWith: Error | undefined;
let calls = 0;
const fake: IsolatedCall = async () => {
  calls++;
  if (failWith) throw failWith;
  return reply;
};

let host: any;
function makeHost(): any {
  const h = {
    cards: [] as any[],
    asides: [] as any[],
    userMessages: [] as any[],
    appendEntry: (customType: string, data: any) => h.cards.push({ customType, data }),
    sendMessage: (message: { customType: string; content: string; display: boolean; details?: unknown }) => h.asides.push(message),
    sendUserMessage: (content: string, options?: any) => h.userMessages.push({ content, options }),
  };
  return h;
}

function entries(toolCalls: number, startId = 1): any[] {
  const list: any[] = [{ type: "message", id: `m${startId}`, parentId: null, timestamp: `${startId}`, message: { role: "user", content: [{ type: "text", text: "do the thing" }], timestamp: startId } }];
  for (let i = 0; i < toolCalls; i++) {
    list.push({ type: "message", id: `t${startId}-${i}`, parentId: list[list.length - 1].id, timestamp: `${startId}${i}`, message: { role: "assistant", content: [{ type: "toolCall", id: `tc${startId}-${i}`, name: "read", arguments: {} }], timestamp: startId * 10 + i } });
    list.push({ type: "message", id: `r${startId}-${i}`, parentId: `t${startId}-${i}`, timestamp: `${startId}${i}r`, message: { role: "toolResult", toolCallId: `tc${startId}-${i}`, toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: startId * 10 + i + 0.5 } });
  }
  list.push({ type: "message", id: `a${startId}`, parentId: list[list.length - 1].id, timestamp: `${startId}a`, message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: startId * 10 + 9 } });
  return list;
}

function ctx(ents: any[], notifications?: { count: number }): any {
  return {
    sessionManager: {
      getEntries: () => ents,
      getLeafId: () => ents[ents.length - 1]?.id,
    },
    getSystemPrompt: () => "PRIMARY PROMPT",
    modelRegistry: { find: () => ({ contextWindow: 32_768 }) },
    ui: { notify: () => { if (notifications) notifications.count++; } },
  };
}

function config(over: Partial<AdvisorConfig["watch"]> = {}): AdvisorConfig {
  return { model: "prov/reviewer", watch: { enabled: true, minToolCalls: 3, immuneTurns: 3, ...over } };
}

function setup(toolCallCount: number, c: AdvisorConfig = config()) {
  return { rt: createRuntime(c, c.model), e: entries(toolCallCount) };
}

const asHost = (h: any): WatcherHost => h;

describe("reviewTurn", () => {
  beforeEach(() => {
    reply = "";
    failWith = undefined;
    calls = 0;
    host = makeHost();
  });

  it("never reviews when no advisor model is configured (primary model must not self-review)", async () => {
    const rt = createRuntime(config(), undefined);
    await reviewTurn(rt, ctx(entries(5)), asHost(host), fake);
    assert.equal(calls, 0);
    assert.equal(rt.stats.reviews, 0);
  });

  it("skips trivial turns below minToolCalls without a model call", async () => {
    const { rt, e } = setup(2);
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    assert.equal(calls, 0);
    assert.equal(rt.stats.skippedTrivial, 1);
    assert.equal(rt.stats.reviews, 0);
  });

  it("threshold 0 reviews every turn", async () => {
    const { rt, e } = setup(1, config({ minToolCalls: 0 }));
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    assert.equal(calls, 1);
    assert.equal(rt.stats.reviews, 1);
  });

  it("second distinct concern steers again; stats counted once per note", async () => {
    reply = '{"severity":"concern","note":"first concern about imports"}';
    const { rt, e } = setup(5);
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    reply = '{"severity":"concern","note":"second distinct concern about tests"}';
    await reviewTurn(rt, ctx([...e, ...entries(4, 2)]), asHost(host), fake);
    assert.equal(host.userMessages.length, 2, "both concerns steer");
    assert.equal(host.asides.length, 0, "no silent aside downgrade");
    assert.equal(host.cards.length, 0);
    assert.equal(rt.stats.concerns, 2, "counted once per delivered note");
    assert.equal(rt.stats.nits, 0);
  });

  it("nit card goes to appendEntry (not LLM-visible sendMessage)", async () => {
    reply = '{"severity":"nit","note":"unused import in foo.ts"}';
    const { rt, e } = setup(5);
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    assert.equal(host.cards.length, 0, "nits now go to sendMessage asides, not appendEntry cards");
    assert.equal(host.asides.length, 1);
    assert.equal(host.asides[0].customType, "pi-advisor");
    assert.ok(host.asides[0].content.includes("unused import in foo.ts"));
  });

  it("concern steers via sendUserMessage followUp", async () => {
    reply = '{"severity":"concern","note":"edit went to the wrong file"}';
    const { rt, e } = setup(5);
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    assert.equal(host.userMessages.length, 1);
    assert.equal(host.userMessages[0].options?.deliverAs, "followUp");
    assert.ok(host.userMessages[0].content.includes("wrong file"));
    assert.equal(rt.stats.concerns, 1);
  });

  it("concern steers again on a second distinct concern (no silent downgrade)", async () => {
    reply = '{"severity":"concern","note":"first concern about imports"}';
    const { rt, e } = setup(5);
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    assert.equal(host.userMessages.length, 1);
    // distinct note — must steer again, not sit as an aside
    reply = '{"severity":"concern","note":"second distinct concern about tests"}';
    await reviewTurn(rt, ctx([...e, ...entries(4, 2)]), asHost(host), fake);
    assert.equal(host.userMessages.length, 2, "second concern steers too");
    assert.equal(host.asides.length, 0, "no silent downgrade to aside");
    assert.equal(host.cards.length, 0);
    assert.equal(rt.stats.concerns, 2);
  });

  it("blocker steers via followUp", async () => {
    reply = '{"severity":"concern","note":"first concern about imports"}';
    const { rt, e } = setup(5);
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    reply = '{"severity":"blocker","note":"escalation: the migration drops data"}';
    await reviewTurn(rt, ctx([...e, ...entries(4, 2)]), asHost(host), fake);
    assert.equal(host.userMessages.length, 2, "blocker steers");
    assert.equal(host.asides.length, 0);
    assert.equal((host.userMessages[1].content as any).includes("(blocker"), true);
    assert.equal(rt.stats.blockers, 1);
  });

  it("duplicate note is suppressed by the guard", async () => {
    reply = '{"severity":"nit","note":"unused import in foo.ts"}';
    const { rt, e } = setup(5);
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    await reviewTurn(rt, ctx([...e, ...entries(4, 2)]), asHost(host), fake);
    assert.equal(host.asides.length, 1, "identical note not repeated");
    assert.equal(rt.guard.counts.suppressed, 1);
  });

  it("empty and unparseable output are no-ops, unparseable counted", async () => {
    const { rt, e } = setup(5);
    reply = "";
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    assert.equal(rt.stats.reviews, 1);
    assert.equal(rt.stats.parseFailures, 0);
    reply = "I think everything is fine!";
    await reviewTurn(rt, ctx([...e, ...entries(4, 2)]), asHost(host), fake);
    assert.equal(rt.stats.parseFailures, 1);
    assert.equal(host.cards.length + host.userMessages.length, 0);
  });

  it("pauses after 3 consecutive model failures and notifies once", async () => {
    failWith = new Error("boom");
    const { rt, e } = setup(5);
    const notes = { count: 0 };
    let list = e;
    for (let turn = 1; turn <= 4; turn++) {
      await reviewTurn(rt, ctx(list, notes), asHost(host), fake);
      if (turn < 4) list = [...list, ...entries(4, turn + 1)];
    }
    assert.equal(rt.stats.modelFailures, 3, "third failure pauses; fourth skipped");
    assert.equal(rt.stats.paused, true);
    assert.equal(notes.count, 1, "one pause notification");
  });

  it("resumes after enableWatch clears pause", async () => {
    failWith = new Error("boom");
    const { rt, e } = setup(5);
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    await reviewTurn(rt, ctx([...e, ...entries(4, 2)]), asHost(host), fake);
    await reviewTurn(rt, ctx([...e, ...entries(4, 2), ...entries(4, 3)]), asHost(host), fake);
    assert.equal(rt.stats.paused, true);
    rt.stats.paused = false; rt.failures = 0; // what enableWatch does
    failWith = undefined;
    reply = '{"severity":"nit","note":"fresh note after recovery"}';
    await reviewTurn(rt, ctx([...e, ...entries(4, 2), ...entries(4, 3), ...entries(4, 4)]), asHost(host), fake);
    assert.equal(rt.stats.reviews, 1);
  });

  it("cursor still advances past the failed review", async () => {
    failWith = new Error("quota");
    const { rt, e } = setup(5);
    await reviewTurn(rt, ctx(e), asHost(host), fake);
    assert.equal(rt.cursor, e[e.length - 1].id);
  });
});

describe("cursor semantics", () => {
  beforeEach(() => {
    reply = "";
    failWith = undefined;
    calls = 0;
    host = makeHost();
  });

  it("counts only new tool calls since the previous review", async () => {
    const rt = createRuntime(config({ minToolCalls: 3 }), "prov/reviewer");
    const first = entries(4);
    await reviewTurn(rt, ctx(first), asHost(host), fake);
    assert.equal(calls, 1);
    const second = [...first, ...entries(1, 2)]; // only 1 new tool call
    await reviewTurn(rt, ctx(second), asHost(host), fake);
    assert.equal(calls, 1, "second turn below threshold — no review");
    assert.equal(rt.stats.skippedTrivial, 1);
    const third = [...second, ...entries(5, 3)]; // 5 new tool calls
    await reviewTurn(rt, ctx(third), asHost(host), fake);
    assert.equal(calls, 2);
  });
});
