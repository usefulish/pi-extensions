// Live validation: fetch /v1/models and verify floor-aware mapModel produces
// correct context windows for the user's actual routes (glm-cn/*, opencode-go/*,
// etc.) that lacked top-level metadata in the live catalog.
//
// Run: cd pi-router && npx tsx extensions/test/live-validation.ts
// Requires: ROUTER_API_KEY env var (or auth.json credential via PI_CODING_AGENT_DIR).
import { fetchModels, mapModel } from "../lib/client.js";
import { getSettings } from "../lib/config.js";

const EXPECTED: Record<string, { ctx: number; max: number; source: string }> = {
  // glm-5.2/5.3: 1M / 131072 (models.dev zhipuai/glm-5.{2,3}, zhipuai-coding-plan/*,
  // opencode-go/glm-5.{2,3}, openrouter/z-ai/glm-5.{2,3}). Live omniroute reports no
  // top-level fields for these glm-cn routes → override fires → 1M/131072.
  "glm-cn/glm-5.3":      { ctx: 1_000_000, max: 131_072, source: "override (no top-level)" },
  "glm-cn/glm-5.2":      { ctx: 1_000_000, max: 131_072, source: "override (no top-level)" },
  "glmcn/glm-5.3":       { ctx: 1_000_000, max: 131_072, source: "override (no top-level)" },
  "glmcn/glm-5.2":       { ctx: 1_000_000, max: 131_072, source: "override (no top-level)" },
  "opencode-go/glm-5.3": { ctx: 1_000_000, max: 131_072, source: "override (no top-level)" },
  "opencode-go/glm-5.2": { ctx: 1_000_000, max: 131_072, source: "override (no top-level)" },
  // glm-5/5-turbo: 200000 / 131072 (models.dev zhipuai-coding-plan/glm-5-turbo).
  // Live omniroute has no top-level → override fires → 200K/131072.
  "glm-cn/glm-5":        { ctx: 200_000, max: 131_072, source: "override (no top-level)" },
  "glm-cn/glm-5-turbo":  { ctx: 200_000, max: 131_072, source: "override (no top-level)" },
  "opencode-go/glm-5":   { ctx: 200_000, max: 131_072, source: "override (no top-level)" },
  // glm-5.1: Live omniroute reports ctx=204800 / max=131072 (real Z.ai windows).
  // Above floor → pairFloorPoisoned=false → override bypassed → router truth kept.
  "glm-cn/glm-5.1":      { ctx: 204_800, max: 131_072, source: "router truth (above floor)" },
  // glm-4.6 / 4.7: live omniroute no top-level → override fires → 200K/131072.
  "glm-cn/glm-4.6":      { ctx: 200_000, max: 131_072, source: "override (no top-level)" },
  "glm-cn/glm-4.7":      { ctx: 200_000, max: 131_072, source: "override (no top-level)" },
  // Kimi K3: Live omniroute reports top-level ctx=1048576 / max=1048576 — ABOVE floor.
  // Pair-floor-poison doesn't fire → override bypassed → router truth kept.
  "opencode-go/kimi-k3": { ctx: 1_048_576, max: 1_048_576, source: "router truth (above floor)" },
  // glm-4.5: live omniroute reports ctx=128000 / max=32768 (real Z.ai windows) —
  // ABOVE floor for ctx, BELOW for max but no override entry → pair rule doesn't
  // fire → router truth kept (no glm-4.5 override needed; FALLBACK 128K for ctx
  // accidentally matches truth).
  "glm-cn/glm-4.5":      { ctx: 128_000, max: 32_768, source: "router truth (no override match)" },
};

async function main(): Promise<void> {
  const raw = await fetchModels(getSettings(), new AbortController().signal);
  let okCount = 0;
  let failCount = 0;
  for (const [id, expected] of Object.entries(EXPECTED)) {
    const r = raw.find((m: { id: string }) => m.id === id);
    if (!r) {
      console.log(`SKIP ${id.padEnd(28)} (not in live response)`);
      continue;
    }
    const mapped = mapModel(r as never, true);
    const pass = mapped.contextWindow === expected.ctx && mapped.maxTokens === expected.max;
    if (pass) {
      okCount++;
      console.log(`  OK ${id.padEnd(28)} ctx=${mapped.contextWindow} max=${mapped.maxTokens}  [${expected.source}]`);
    } else {
      failCount++;
      console.log(`FAIL ${id.padEnd(28)} ctx=${mapped.contextWindow} max=${mapped.maxTokens}  (expected ${expected.ctx} / ${expected.max})  [${expected.source}]`);
    }
  }
  console.log(`\nResult: ${okCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
