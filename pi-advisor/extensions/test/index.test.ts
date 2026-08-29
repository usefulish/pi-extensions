import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, before, after } from "mocha";
import piAdvisor, { __setIsolatedForTest } from "../index";

// Redirect the homedir so config writes never touch real user settings.
let realHome: string | undefined;
let TMP: string;

function createFakePi() {
  const state: any = {
    activeTools: new Set<string>(),
    tools: new Map(),
    commands: new Map(),
    entryRenderers: new Map(),
    eventHandlers: new Map<string, ((event: any, ctx: any) => void)[]>(),
    entries: [] as any[],
    userMessages: [] as any[],
    sendMessageCalls: 0,
  };
  const pi: any = {
    registerTool: (tool: any) => { state.tools.set(tool.name, tool); },
    registerCommand: (name: string, def: any) => { state.commands.set(name, def); },
    getActiveTools: () => [...state.activeTools],
    setActiveTools: (tools: string[]) => { state.activeTools = new Set(tools); },
    registerEntryRenderer: (type: string, renderer: any) => { state.entryRenderers.set(type, renderer); },
    appendEntry: (customType: string, data: unknown) => { state.entries.push({ type: "custom", customType, data }); },
    sendMessage: () => { state.sendMessageCalls++; }, // would enter LLM context — must never be used for cards
    sendUserMessage: (content: string, options?: any) => { state.userMessages.push({ content, options }); },
    on: (channel: string, handler: (event: any, ctx: any) => void) => {
      const list = state.eventHandlers.get(channel) ?? [];
      list.push(handler);
      state.eventHandlers.set(channel, list);
      return () => {};
    },
  };
  return { pi, state };
}

function toolCalls(n: number): any[] {
  const list: any[] = [{ type: "message", id: "e0", parentId: null, timestamp: "0", message: { role: "user", content: [{ type: "text", text: "task" }], timestamp: 0 } }];
  for (let i = 1; i <= n; i++) {
    list.push({ type: "message", id: `t${i}`, parentId: list[list.length - 1].id, timestamp: `${i}`, message: { role: "assistant", content: [{ type: "toolCall", id: `tc${i}`, name: "read", arguments: {} }], timestamp: i } });
    list.push({ type: "message", id: `r${i}`, parentId: `t${i}`, timestamp: `${i}r`, message: { role: "toolResult", toolCallId: `tc${i}`, toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: i + 0.5 } });
  }
  list.push({ type: "message", id: `a${n}`, parentId: list[list.length - 1].id, timestamp: `${n}a`, message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: n + 1 } });
  return list;
}

function fakeCtx(entries: any[], sessionId = "test-session"): any {
  return {
    cwd: TMP,
    mode: "print",
    hasUI: false,
    isProjectTrusted: () => false,
    model: { provider: "test", id: "main-model" },
    modelRegistry: {
      getAvailable: () => [],
      refresh: async () => {},
      find: () => ({ provider: "test", id: "advisor-model", contextWindow: 32_768 }),
      getError: () => undefined,
    },
    getSystemPrompt: () => "Primary system prompt",
    sessionManager: { getEntries: () => entries, getLeafId: () => entries[entries.length - 1]?.id, getSessionId: () => sessionId },
    ui: { notify: () => {} },
  };
}

async function fire(pi: any, state: any, channel: string, ctx: any): Promise<void> {
  const handlers = state.eventHandlers.get(channel) ?? [];
  for (const h of handlers) await h({}, ctx);
}

describe("index wiring", () => {
  before(async () => {
    realHome = process.env.HOME;
    TMP = await mkdtemp(path.join(tmpdir(), "pi-advisor-index-"));
    process.env.HOME = TMP;
    __setIsolatedForTest(undefined);
  });
  after(() => {
    __setIsolatedForTest(undefined);
    if (realHome) process.env.HOME = realHome;
  });

  it("registers the advisor tool, /advisor command, and card renderer", () => {
    const { pi, state } = createFakePi();
    piAdvisor(pi);
    assert.ok(state.tools.has("advisor"), "advisor tool registered");
    assert.ok(state.commands.has("advisor"), "/advisor command registered");
    assert.ok(state.entryRenderers.has("pi-advisor"), "card renderer registered");
    assert.ok(state.eventHandlers.has("agent_settled"), "agent_settled hook registered");
  });

  it("nit flow steers via sendUserMessage (accepted notes all trigger a turn at settle)", async () => {
    const { pi, state } = createFakePi();
    piAdvisor(pi);
    await mkdir(path.join(TMP, ".pi", "agent"), { recursive: true });
    await writeFile(path.join(TMP, ".pi", "agent", "settings.json"), JSON.stringify({
      "pi-advisor": { model: "test/advisor-model" },
    }));
    let isolatedCalled = false;
    __setIsolatedForTest(async () => { isolatedCalled = true; return '{"severity":"nit","note":"unused import in foo.ts"}'; });
    await fire(pi, state, "session_start", fakeCtx([]));
    await fire(pi, state, "agent_settled", fakeCtx(toolCalls(4)));
    assert.ok(isolatedCalled, "review executed");
    assert.equal(state.sendMessageCalls, 0, "nit no longer goes through a non-interrupting sendMessage aside at settle");
    assert.equal(state.entries.length, 0, "nit is NOT a display-only appendEntry card");
    assert.equal(state.userMessages.length, 1, "nit triggers a follow-up turn (agent_settled is idle, no step boundary)");
  });

  it("concern steers via sendUserMessage and arms cooldown", async () => {
    const { pi, state } = createFakePi();
    piAdvisor(pi);
    await mkdir(path.join(TMP, ".pi", "agent"), { recursive: true });
    await writeFile(path.join(TMP, ".pi", "agent", "settings.json"), JSON.stringify({
      "pi-advisor": { model: "test/advisor-model" },
    }));
    __setIsolatedForTest(async () => '{"severity":"concern","note":"edit went to the wrong file"}');
    await fire(pi, state, "session_start", fakeCtx([]));
    await fire(pi, state, "agent_settled", fakeCtx(toolCalls(4)));
    assert.equal(state.userMessages.length, 1);
    assert.equal(state.userMessages[0].options.deliverAs, "followUp");
    assert.equal(state.entries.length, 0, "concern is a steer, not a card");
  });

  it("no advisor model → no review call at all", async () => {
    const { pi, state } = createFakePi();
    piAdvisor(pi);
    await mkdir(path.join(TMP, ".pi", "agent"), { recursive: true });
    await writeFile(path.join(TMP, ".pi", "agent", "settings.json"), JSON.stringify({ "pi-advisor": {} }));
    let calls = 0;
    __setIsolatedForTest(async () => { calls++; return '{"severity":"nit","note":"x"}'; });
    const ctx = fakeCtx(toolCalls(4));
    await fire(pi, state, "session_start", ctx);
    await fire(pi, state, "agent_settled", ctx);
    assert.equal(calls, 0, "no isolated call without a model");
    assert.equal(state.entries.length, 0);
  });

  it("migration is one-shot: disable then restart does not resurrect legacy model", async () => {
    const { pi, state } = createFakePi();
    piAdvisor(pi);
    // legacy pi-plan preference exists
    await mkdir(path.join(TMP, ".pi", "agent", "pi-plan"), { recursive: true });
    await writeFile(path.join(TMP, ".pi", "agent", "pi-plan", "preferences.json"), JSON.stringify({ advisorModel: "test/legacy-model" }));
    const ctx = fakeCtx([]);
    await fire(pi, state, "session_start", ctx); // migrates test/legacy-model
    const migrated = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(TMP, ".pi", "agent", "settings.json"), "utf8"));
    assert.equal(migrated["pi-advisor"].model, "test/legacy-model");

    // user runs /advisor off → model cleared
    const cmd = state.commands.get("advisor");
    await cmd.handler("off", ctx);

    // restart: session_start again — must NOT re-migrate
    await fire(pi, state, "session_start", fakeCtx([]));
    const rt = state.commands.get("advisor");
    void rt;
    // observable: settled turn with a configured-but-cleared model must not review
    let calls = 0;
    __setIsolatedForTest(async () => { calls++; return '{"severity":"nit","note":"x"}'; });
    await fire(pi, state, "agent_settled", fakeCtx(toolCalls(4)));
    assert.equal(calls, 0, "legacy model not resurrected after explicit disable");
  });

  it("/advisor completions offer keywords ahead of models, filtered by prefix", () => {
    const { pi, state } = createFakePi();
    piAdvisor(pi);
    const ctx = fakeCtx([]);
    ctx.modelRegistry.getAvailable = () => [
      { provider: "p", id: "m1", contextWindow: 8_000 },
      { provider: "p", id: "m2", contextWindow: 8_000 },
    ] as any;
    const cmd = state.commands.get("advisor");
    cmd.handler("status", ctx); // seeds the module-level registry from ctx
    const all = cmd.getArgumentCompletions("");
    const values = all.map((i: any) => i.value);
    for (const kw of ["on", "off", "status", "watch-off"]) {
      assert.ok(values.includes(kw), `keyword ${kw} offered at empty prefix`);
      assert.ok(values.indexOf(kw) < values.findIndex((v: string) => v.includes("/")), `keyword ${kw} sorts before model items`);
    }
    const o = cmd.getArgumentCompletions("o").map((i: any) => i.value);
    assert.ok(o.includes("on") && o.includes("off"), "keywords survive prefix filtering");
    assert.ok(!o.includes("status"), "non-matching keyword filtered out");
    const none = cmd.getArgumentCompletions("zzz");
    assert.equal(none, null, "no matches → null (popup suppressed)");
  });
});
