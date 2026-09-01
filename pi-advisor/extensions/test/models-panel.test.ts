import { strict as assert } from "node:assert";
import { describe, it } from "mocha";
import { buildModelsPanelCfg, buildRows, cfgToModels } from "../lib/models-panel";

describe("models-panel", () => {
  it("builds one row per chain slot plus add/remove actions", () => {
    const cfg = buildModelsPanelCfg(["prov/a", "prov/b"]);
    const rows = buildRows(cfg, undefined, {
      addModel: { label: "+ Add model slot", run: () => {} },
      removeLast: { label: "− Remove last slot", run: () => {} },
    });
    const group = rows[0];
    assert.equal(group.key, "models");
    const slots = group.rows.filter((r) => r.kind === "string");
    assert.equal(slots.length, 2);
    assert.match(slots[0].label, /primary/);
    const actions = group.rows.filter((r) => r.kind === "action");
    assert.equal(actions.length, 2);
  });

  it("row setters mutate the working config and completions expose model refs", () => {
    const cfg = buildModelsPanelCfg(["prov/a"]);
    const rows = buildRows(cfg, { models: () => ["prov/x", "prov/y"] });
    const slot = rows[0].rows.find((r) => r.kind === "string")!;
    assert.deepEqual((slot as any).completions().map((c: any) => c.value), ["prov/x", "prov/y"]);
    slot.set("prov/replaced ");
    assert.deepEqual(cfg.models, ["prov/replaced"], "setter trims the entry");
  });

  it("cfgToModels drops blanks and keeps order", () => {
    const cfg = { models: ["prov/a", "", "prov/c"] };
    assert.deepEqual(cfgToModels(cfg), ["prov/a", "prov/c"]);
    assert.deepEqual(cfgToModels(buildModelsPanelCfg([])), []);
  });

  it("round-trip: chain → panel → save preserves the chain", () => {
    const original = ["zai/glm", "opencode/deepseek"];
    const cfg = buildModelsPanelCfg(original);
    const rows = buildRows(cfg);
    for (const r of rows[0].rows) if (r.kind === "string") r.set(r.value); // simulate save-applied setters
    assert.deepEqual(cfgToModels(cfg), original);
  });
});
