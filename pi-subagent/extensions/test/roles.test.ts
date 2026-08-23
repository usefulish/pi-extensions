/**
 * Role-based model routing tests: defaults preservation, settings layering,
 * @role expansion (nesting/cycles/unknown), :thinking suffix parsing, and
 * per-agent overrides.
 */

import * as assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_ROLES,
  expandModelCandidates,
  readSubagentRoles,
  readSubagentRolesGlobal,
  resolveAgentModelChain,
  splitThinkingSuffix,
  type RolesConfig,
} from "../roles.ts";
import { buildRows, buildRolesPanelCfg, cfgToPatch } from "../roles-panel.ts";
import { discoverAgents, getModelCandidates } from "../agents.ts";
import type { AgentConfig } from "../agents.ts";

const BUNDLED_DIR = path.resolve(import.meta.dirname, "..", "..", "agents");

function emptyRoles(): RolesConfig {
  return { roles: {}, agentModels: {} };
}

describe("splitThinkingSuffix", () => {
  it("splits a known trailing level", () => {
    assert.deepEqual(splitThinkingSuffix("opencode-go/deepseek-v4-pro:high"), {
      name: "opencode-go/deepseek-v4-pro",
      thinking: "high",
    });
  });

  it("keeps openrouter :free ids intact", () => {
    assert.deepEqual(splitThinkingSuffix("openrouter/nvidia/nemotron-3-super-120b-a12b:free"), {
      name: "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    });
  });

  it("returns name only when no colon", () => {
    assert.deepEqual(splitThinkingSuffix("zai-coding-cn/glm-5-turbo"), { name: "zai-coding-cn/glm-5-turbo" });
  });

  it("ignores unknown trailing segments", () => {
    assert.deepEqual(splitThinkingSuffix("provider/model:whatever"), { name: "provider/model:whatever" });
  });
});

describe("expandModelCandidates", () => {
  it("passes concrete candidates through, deduped", () => {
    const { candidates, unresolved } = expandModelCandidates(["a/b", "a/b", "c/d"], emptyRoles().roles);
    assert.deepEqual(candidates, ["a/b", "c/d"]);
    assert.deepEqual(unresolved, []);
  });

  it("expands @role to its chain in place", () => {
    const roles = { fast: ["a/one", "a/two"] };
    const { candidates } = expandModelCandidates(["@fast", "a/backup"], roles);
    assert.deepEqual(candidates, ["a/one", "a/two", "a/backup"]);
  });

  it("accepts comma-string role values", () => {
    const { candidates } = expandModelCandidates(["@fast"], { fast: "a/one, a/two" });
    assert.deepEqual(candidates, ["a/one", "a/two"]);
  });

  it("supports one-level nested roles", () => {
    const { candidates } = expandModelCandidates(["@outer"], { outer: "@fast", fast: ["a/one"] });
    assert.deepEqual(candidates, ["a/one"]);
  });

  it("cycle-safe: recursive roles do not loop", () => {
    const { candidates } = expandModelCandidates(["@a"], { a: "@b", b: "@a" });
    assert.deepEqual(candidates, []);
  });

  it("unknown role → recorded in unresolved and skipped", () => {
    const { candidates, unresolved } = expandModelCandidates(["@missing", "a/fallback"], emptyRoles().roles);
    assert.deepEqual(candidates, ["a/fallback"]);
    assert.deepEqual(unresolved, ["@missing"]);
  });

  it("* and @default mean parent fallback (empty candidates)", () => {
    assert.deepEqual(expandModelCandidates(["*"], emptyRoles().roles).candidates, []);
    assert.deepEqual(expandModelCandidates(["@default"], emptyRoles().roles).candidates, []);
  });

  it("captures :thinking suffix per candidate", () => {
    const { candidates, thinkingByCandidate } = expandModelCandidates(
      ["a/deep:high", "a/cheap"],
      emptyRoles().roles,
    );
    assert.deepEqual(candidates, ["a/deep", "a/cheap"]);
    assert.equal(thinkingByCandidate.get("a/deep"), "high");
    assert.equal(thinkingByCandidate.get("a/cheap"), undefined);
  });

  it("role chains carry :thinking per entry", () => {
    const { thinkingByCandidate } = expandModelCandidates(["@smart"], { smart: ["a/x:high", "a/y"] });
    assert.equal(thinkingByCandidate.get("a/x"), "high");
  });
});

describe("resolveAgentModelChain", () => {
  it("behavior preservation: bundled agents + DEFAULT_ROLES equal today's chains", () => {
    const rolesCfg: RolesConfig = { roles: structuredClone(DEFAULT_ROLES), agentModels: {} };
    const discovery = discoverAgents(os.tmpdir(), "user", BUNDLED_DIR);
    const byName = new Map(discovery.agents.map((a) => [a.name, a]));

    const scout = byName.get("scout")!;
    assert.deepEqual(getModelCandidates(scout), ["@fast"]);
    assert.deepEqual(resolveAgentModelChain(scout, rolesCfg).candidates, [
      "zai-coding-cn/glm-5-turbo",
      "nvidia/openai/gpt-oss-20b",
      "opencode-go/deepseek-v4-flash",
    ]);

    const planner = byName.get("planner")!;
    assert.deepEqual(resolveAgentModelChain(planner, rolesCfg).candidates, [
      "zai-coding-cn/glm-5.3",
      "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
      "opencode-go/deepseek-v4-pro",
    ]);

    const worker = byName.get("worker")!;
    assert.deepEqual(resolveAgentModelChain(worker, rolesCfg).candidates, [
      "zai-coding-cn/glm-5.1",
      "nvidia/mistralai/mistral-small-4-119b-2603",
      "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
      "opencode-go/deepseek-v4-flash",
    ]);
  });

  it("agentModels override replaces the whole candidate list", () => {
    const rolesCfg: RolesConfig = { roles: structuredClone(DEFAULT_ROLES), agentModels: { scout: "a/custom" } };
    const agent: Pick<AgentConfig, "name" | "model" | "models"> = { name: "scout", model: "@fast", models: [] };
    const chain = resolveAgentModelChain(agent, rolesCfg);
    assert.deepEqual(chain.candidates, ["a/custom"]);
    assert.equal(chain.overridden, true);
  });

  it("agentModels override may reference a role with :thinking", () => {
    const rolesCfg: RolesConfig = { roles: structuredClone(DEFAULT_ROLES), agentModels: { reviewer: "@smart:high" } };
    const agent: Pick<AgentConfig, "name" | "model" | "models"> = { name: "reviewer", model: "@smart", models: [] };
    const chain = resolveAgentModelChain(agent, rolesCfg);
    assert.deepEqual(chain.candidates, ["zai-coding-cn/glm-5.3", "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free", "opencode-go/deepseek-v4-pro"]);
    assert.equal(chain.thinkingByCandidate.get("zai-coding-cn/glm-5.3"), "high");
  });

  it("no candidates → parent fallback (empty list)", () => {
    const rolesCfg: RolesConfig = { roles: structuredClone(DEFAULT_ROLES), agentModels: { scout: "*" } };
    const agent: Pick<AgentConfig, "name" | "model" | "models"> = { name: "scout", model: "@fast", models: [] };
    assert.deepEqual(resolveAgentModelChain(agent, rolesCfg).candidates, []);
  });
});

describe("readSubagentRoles settings layering", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-roles-"));
    process.env.PI_CODING_AGENT_DIR = tmpHome;
  });

  afterEach(() => {
    delete process.env.PI_CODING_AGENT_DIR;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("no settings → DEFAULT_ROLES", () => {
    const cfg = readSubagentRoles();
    assert.deepEqual(cfg.roles, DEFAULT_ROLES);
    assert.deepEqual(cfg.agentModels, {});
  });

  it("global settings.json overrides role chains", () => {
    writeFileSync(path.join(tmpHome, "settings.json"), JSON.stringify({
      subagent: { roles: { fast: ["nvidia/openai/gpt-oss-20b"] }, agentModels: { tester: "a/t" } },
    }));
    const cfg = readSubagentRoles();
    assert.deepEqual(cfg.roles.fast, ["nvidia/openai/gpt-oss-20b"]);
    assert.deepEqual(cfg.roles.coder, DEFAULT_ROLES.coder); // untouched
    assert.equal(cfg.agentModels.tester, "a/t");
  });

  it("accepts comma-string role values in settings", () => {
    writeFileSync(path.join(tmpHome, "settings.json"), JSON.stringify({
      subagent: { roles: { fast: "a/one, a/two" } },
    }));
    const cfg = readSubagentRoles();
    assert.deepEqual(cfg.roles.fast, ["a/one", "a/two"]);
  });

  it("ignores garbage settings sections", () => {
    writeFileSync(path.join(tmpHome, "settings.json"), JSON.stringify({
      subagent: { roles: "not-an-object", agentModels: [1, 2] },
    }));
    const cfg = readSubagentRoles();
    assert.deepEqual(cfg.roles, DEFAULT_ROLES);
    assert.deepEqual(cfg.agentModels, {});
  });

  it("untrusted repo .pi/settings.json is ignored", () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-repo-"));
    mkdirSync(path.join(repo, ".pi"));
    writeFileSync(path.join(repo, ".pi", "settings.json"), JSON.stringify({
      subagent: { roles: { fast: ["evil/repo"] } },
    }));
    const cfg = readSubagentRoles({ cwd: repo, isProjectTrusted: () => false } as any);
    assert.deepEqual(cfg.roles.fast, DEFAULT_ROLES.fast);
    rmSync(repo, { recursive: true, force: true });
  });

  it("trusted repo .pi/settings.json overlays global per key", () => {
    writeFileSync(path.join(tmpHome, "settings.json"), JSON.stringify({
      subagent: { roles: { fast: ["global/fast"] }, agentModels: { scout: "global/s" } },
    }));
    const repo = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-repo-"));
    mkdirSync(path.join(repo, ".pi"));
    writeFileSync(path.join(repo, ".pi", "settings.json"), JSON.stringify({
      subagent: { roles: { fast: ["repo/fast"], coder: ["repo/coder"] } },
    }));
    const cfg = readSubagentRoles({ cwd: repo, isProjectTrusted: () => true } as any);
    assert.deepEqual(cfg.roles.fast, ["repo/fast"]);
    assert.deepEqual(cfg.roles.coder, ["repo/coder"]);
    assert.deepEqual(cfg.roles.smart, DEFAULT_ROLES.smart); // untouched
    assert.equal(cfg.agentModels.scout, "global/s"); // agentModels NOT overlaid by repo
    rmSync(repo, { recursive: true, force: true });
  });

  it("readSubagentRolesGlobal never sees repo overlay", () => {
    writeFileSync(path.join(tmpHome, "settings.json"), JSON.stringify({
      subagent: { roles: { fast: ["global/fast"] } },
    }));
    const repo = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-repo-"));
    mkdirSync(path.join(repo, ".pi"));
    writeFileSync(path.join(repo, ".pi", "settings.json"), JSON.stringify({
      subagent: { roles: { fast: ["repo/fast"] } },
    }));
    const cfg = readSubagentRolesGlobal();
    assert.deepEqual(cfg.roles.fast, ["global/fast"]);
    rmSync(repo, { recursive: true, force: true });
  });
});

describe("roles panel", () => {
  const agents: AgentConfig[] = [
    { name: "scout", description: "d", model: "@fast", models: [], systemPrompt: "", source: "bundled", filePath: "/x" },
    { name: "worker", description: "d", model: "@coder", models: [], systemPrompt: "", source: "bundled", filePath: "/x" },
  ];

  it("buildRolesPanelCfg defaults render blank (= default chain)", () => {
    const cfg = buildRolesPanelCfg(agents, { roles: structuredClone(DEFAULT_ROLES), agentModels: {} });
    assert.equal(cfg.roles.fast, "");
    assert.equal(cfg.roles.coder, "");
    assert.equal(cfg.agentModels.scout, "");
  });

  it("explicit overrides render as comma chains", () => {
    const current: RolesConfig = {
      roles: { ...structuredClone(DEFAULT_ROLES), fast: ["a/one", "a/two"] },
      agentModels: { scout: "a/custom" },
    };
    const cfg = buildRolesPanelCfg(agents, current);
    assert.equal(cfg.roles.fast, "a/one, a/two");
    assert.equal(cfg.agentModels.scout, "a/custom");
  });

  it("cfgToPatch drops blanks and parses comma chains", () => {
    const cfg = buildRolesPanelCfg(agents, { roles: structuredClone(DEFAULT_ROLES), agentModels: {} });
    cfg.roles.fast = "a/one, a/two";
    cfg.roles.coder = "";
    cfg.agentModels.scout = "a/custom";
    cfg.agentModels.worker = "";
    const patch = cfgToPatch(cfg);
    assert.deepEqual(patch.roles, { fast: ["a/one", "a/two"] });
    assert.deepEqual(patch.agentModels, { scout: "a/custom" });
  });

  it("single model without comma stays a string", () => {
    const cfg = buildRolesPanelCfg(agents, { roles: structuredClone(DEFAULT_ROLES), agentModels: {} });
    cfg.roles.fast = "nvidia/openai/gpt-oss-20b";
    assert.deepEqual(cfgToPatch(cfg).roles, { fast: "nvidia/openai/gpt-oss-20b" });
  });

  it("preserveUnknownAgentModels keeps undiscovered agents' overrides", async () => {
    const { preserveUnknownAgentModels } = await import("../roles-panel.ts");
    const preserved = preserveUnknownAgentModels(
      { scout: "a/custom" },
      ["scout"],
      { scout: "old", worker: "kept", ghost: "also-kept" },
    );
    assert.deepEqual(preserved, { scout: "a/custom", worker: "kept", ghost: "also-kept" });
  });

  it("buildRows produces role + agent groups", () => {
    const cfg = buildRolesPanelCfg(agents, { roles: structuredClone(DEFAULT_ROLES), agentModels: {} });
    const groups = buildRows(cfg, agents);
    assert.equal(groups.length, 2);
    assert.ok(groups[0].rows.some((r) => r.key === "role.fast"));
    assert.ok(groups[1].rows.some((r) => r.key === "agent.scout"));
    // setter mutates cfg
    const fastRow = groups[0].rows.find((r) => r.key === "role.fast")!;
    fastRow.set("a/x, a/y");
    assert.equal(cfg.roles.fast, "a/x, a/y");
  });
});

describe("writeSubagentSection persistence", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-write-"));
    process.env.PI_CODING_AGENT_DIR = tmpHome;
  });

  afterEach(() => {
    delete process.env.PI_CODING_AGENT_DIR;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("refuses to overwrite corrupt settings.json and leaves it byte-identical", async () => {
    const { writeSubagentSection } = await import("../roles-panel.ts");
    writeFileSync(path.join(tmpHome, "settings.json"), '{"theme":"dark",');
    let threw: unknown = null;
    try {
      writeSubagentSection({ roles: { fast: ["a/x"] } });
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof Error, "expected a throw, got none");
    assert.ok(String((threw as Error).message).includes("not valid JSON"));
    assert.equal(readFileSync(path.join(tmpHome, "settings.json"), "utf8"), '{"theme":"dark",');
  });

  it("preserves unrelated keys and returns false for no-ops", async () => {
    const { writeSubagentSection } = await import("../roles-panel.ts");
    writeFileSync(path.join(tmpHome, "settings.json"), JSON.stringify({
      theme: "dark",
      subagent: { roles: { fast: ["a/x"] } },
    }));
    assert.equal(writeSubagentSection({ roles: { fast: ["a/x"] } }), false);
    writeSubagentSection({ roles: { fast: ["a/y"] } });
    const raw = readFileSync(path.join(tmpHome, "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.theme, "dark");
    assert.deepEqual(parsed.subagent.roles.fast, ["a/y"]);
  });

  it("creates the file when missing and drops an emptied subagent", async () => {
    const { writeSubagentSection } = await import("../roles-panel.ts");
    assert.equal(writeSubagentSection({ roles: { fast: ["a/x"] }, agentModels: {} }), true);
    const created = JSON.parse(readFileSync(path.join(tmpHome, "settings.json"), "utf8"));
    assert.deepEqual(created.subagent.roles.fast, ["a/x"]);
    writeSubagentSection({ roles: {}, agentModels: {} });
    const after = JSON.parse(readFileSync(path.join(tmpHome, "settings.json"), "utf8"));
    assert.equal(after.subagent, undefined);
  });

  it("refuses to overwrite a non-object settings.json root", async () => {
    const { writeSubagentSection } = await import("../roles-panel.ts");
    writeFileSync(path.join(tmpHome, "settings.json"), "[1,2,3]");
    let threw: unknown = null;
    try {
      writeSubagentSection({ roles: { fast: ["a/x"] } });
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof Error, "expected a throw, got none");
    assert.ok(String((threw as Error).message).includes("not a JSON object"));
    assert.equal(readFileSync(path.join(tmpHome, "settings.json"), "utf8"), "[1,2,3]");
  });

  it("preserves unrelated subagent.* keys when clearing roles/agentModels", async () => {
    const { writeSubagentSection } = await import("../roles-panel.ts");
    writeFileSync(path.join(tmpHome, "settings.json"), JSON.stringify({
      theme: "dark",
      subagent: { roles: { fast: ["a/x"] }, agentModels: {}, maxTurns: 20 },
    }));
    writeSubagentSection({ roles: {}, agentModels: {} });
    const after = JSON.parse(readFileSync(path.join(tmpHome, "settings.json"), "utf8"));
    assert.equal(after.theme, "dark");
    assert.equal(after.subagent.maxTurns, 20);
    assert.equal(after.subagent.roles, undefined);
    assert.equal(after.subagent.agentModels, undefined);
  });
});

describe("bundled agent files use role aliases", () => {
  it("all six bundled agents parse with @role model refs and no prefix diagnostics", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
    const bundledDir = path.join(root, "bundled");
    mkdirSync(bundledDir, { recursive: true });
    rmSync(root, { recursive: true, force: true });

    const discovery = discoverAgents(os.tmpdir(), "user", BUNDLED_DIR);
    assert.equal(discovery.agents.length, 6);
    const prefixDiags = discovery.diagnostics.filter((d) => d.issue.includes("provider prefix"));
    assert.deepEqual(prefixDiags, []);
    for (const agent of discovery.agents) {
      const cands = getModelCandidates(agent);
      assert.equal(cands.length, 1, `${agent.name} should have exactly one alias`);
      assert.ok(cands[0].startsWith("@"), `${agent.name} model should be @role, got ${cands[0]}`);
    }
  });
});
