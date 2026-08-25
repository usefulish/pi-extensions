import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, before, after } from "mocha";
import { loadConfig, migrateLegacyAdvisorModel, parseModel } from "../lib/config";

// Redirect the homedir so config tests never touch real user settings.
let realHome: string | undefined;
const fakeHome = () => mkdtemp(path.join(tmpdir(), "pi-advisor-test-"));

function ctx(cwd: string, trusted = true) {
  return {
    cwd,
    isProjectTrusted: () => trusted,
  } as any;
}

async function writeSettings(home: string, project: boolean, body: unknown) {
  if (project) {
    const dir = path.join(home, "project", ".pi");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "settings.json"), JSON.stringify(body, null, 2));
  } else {
    const dir = path.join(home, ".pi", "agent");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "settings.json"), JSON.stringify(body, null, 2));
  }
}

describe("config", () => {
  before(() => { realHome = process.env.HOME; });
  after(() => { if (realHome) process.env.HOME = realHome; });

  it("returns defaults when nothing is configured", async () => {
    const home = await fakeHome();
    process.env.HOME = home;
    const config = await loadConfig(ctx(home));
    assert.equal(config.model, undefined);
    assert.deepEqual(config.watch, { enabled: true, minToolCalls: 3, immuneTurns: 3 });
  });

  it("reads global model and watch overrides", async () => {
    const home = await fakeHome();
    process.env.HOME = home;
    await writeSettings(home, false, { "pi-advisor": { model: "prov/a-model", watch: { minToolCalls: 5, enabled: false } } });
    const config = await loadConfig(ctx(home));
    assert.equal(config.model, "prov/a-model");
    assert.deepEqual(config.watch, { enabled: false, minToolCalls: 5, immuneTurns: 3 });
  });

  it("project settings win over global, other global keys survive", async () => {
    const home = await fakeHome();
    process.env.HOME = home;
    await writeSettings(home, false, { "pi-advisor": { model: "prov/global", watch: { minToolCalls: 5 } } });
    await writeSettings(home, true, { "pi-advisor": { model: "prov/project" } });
    const config = await loadConfig(ctx(path.join(home, "project")));
    assert.equal(config.model, "prov/project");
    assert.equal(config.watch.minToolCalls, 5, "global watch keys survive project merge");
  });

  it("untrusted project dirs are ignored", async () => {
    const home = await fakeHome();
    process.env.HOME = home;
    await writeSettings(home, false, { "pi-advisor": { model: "prov/global" } });
    await writeSettings(home, true, { "pi-advisor": { model: "prov/project" } });
    const config = await loadConfig(ctx(path.join(home, "project"), false));
    assert.equal(config.model, "prov/global");
  });

  it("invalid values fall back to defaults", async () => {
    const home = await fakeHome();
    process.env.HOME = home;
    await writeSettings(home, false, { "pi-advisor": { model: "", watch: { minToolCalls: -2, immuneTurns: "lots" } } });
    const config = await loadConfig(ctx(home));
    assert.equal(config.model, undefined);
    assert.deepEqual(config.watch, { enabled: true, minToolCalls: 3, immuneTurns: 3 });
  });

  it("saveModel round-trips and removes the key on undefined", async () => {
    const home = await fakeHome();
    process.env.HOME = home;
    await writeSettings(home, false, { unrelated: "keep-me" });
    const { saveModel } = await import("../lib/config");
    await saveModel("prov/saved");
    const raw = JSON.parse(await readFile(path.join(home, ".pi", "agent", "settings.json"), "utf8"));
    assert.equal(raw["pi-advisor"].model, "prov/saved");
    assert.equal(raw.unrelated, "keep-me", "other settings survive the read-modify-write");
    await saveModel(undefined);
    const cleared = JSON.parse(await readFile(path.join(home, ".pi", "agent", "settings.json"), "utf8"));
    assert.equal(cleared["pi-advisor"].model, undefined);
  });

  it("migrateLegacyAdvisorModel adopts pi-plan advisorModel once and stamps the version", async () => {
    const home = await fakeHome();
    process.env.HOME = home;
    const legacyDir = path.join(home, ".pi", "agent", "pi-plan");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, "preferences.json"), JSON.stringify({ advisorModel: "prov/legacy" }));
    const legacy = await migrateLegacyAdvisorModel();
    assert.equal(legacy, "prov/legacy");
    const raw = JSON.parse(await readFile(path.join(home, ".pi", "agent", "settings.json"), "utf8"));
    assert.equal(raw["pi-advisor"].model, "prov/legacy");
    assert.equal(raw["pi-advisor"].migrationVersion, 1, "versioned migration stamped");
    // no legacy preference → no migration
    const other = await fakeHome();
    process.env.HOME = other;
    assert.equal(await migrateLegacyAdvisorModel(), undefined);
  });

  it("versioned migration never resurrects a disabled advisor after restart", async () => {
    const home = await fakeHome();
    process.env.HOME = home;
    const legacyDir = path.join(home, ".pi", "agent", "pi-plan");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, "preferences.json"), JSON.stringify({ advisorModel: "prov/legacy" }));
    assert.equal(await migrateLegacyAdvisorModel(), "prov/legacy");
    // user disables → model cleared, version stays
    const { saveModel } = await import("../lib/config");
    await saveModel(undefined);
    // restart: legacy file still present, but migration is consumed → no re-adoption
    assert.equal(await migrateLegacyAdvisorModel(), undefined);
    const raw = JSON.parse(await readFile(path.join(home, ".pi", "agent", "settings.json"), "utf8"));
    assert.equal(raw["pi-advisor"].model, undefined);
    assert.equal(raw["pi-advisor"].migrationVersion, 1);
  });

  it("pre-versioning legacyMigrated tombstone is treated as consumed", async () => {
    const home = await fakeHome();
    process.env.HOME = home;
    const legacyDir = path.join(home, ".pi", "agent", "pi-plan");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, "preferences.json"), JSON.stringify({ advisorModel: "prov/legacy" }));
    // simulate a config written by the pre-versioning release
    await writeSettings(home, false, { "pi-advisor": { model: "prov/migrated", legacyMigrated: true } });
    assert.equal(await migrateLegacyAdvisorModel(), undefined, "legacy tombstone already consumed migration");
  });

  it("parseModel splits provider/id and rejects garbage", () => {
    assert.deepEqual(parseModel("prov/model-id"), { provider: "prov", id: "model-id" });
    assert.equal(parseModel("noseparator"), undefined);
    assert.equal(parseModel("/leading"), undefined);
    assert.equal(parseModel("trailing/"), undefined);
  });
});
