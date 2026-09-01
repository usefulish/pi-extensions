/**
 * `/advisor models` panel (kernel lives in @bacnh85/pi-config-panel).
 *
 * One string row per model slot (ordered fallback chain, blank = remove
 * slot), plus "Add model slot" / "Remove last" action rows. Saving writes
 * the chain to the GLOBAL `~/.pi/agent/settings.json` under
 * `pi-advisor.models` (merge + atomic rename via saveModels).
 */

import { row } from "@bacnh85/pi-config-panel";
import type { PanelGroup, PanelAction } from "@bacnh85/pi-config-panel";

/** Completion sources for the panel's model rows (lazy — resolved per keypress). */
export interface ModelsPanelOptions {
  /** Available model refs (`provider/id`), sorted; may be empty before registry sync. */
  models: () => string[];
}

export interface ModelsPanelCfg {
  /** Working copy: ordered chain; blank row = removed slot. */
  models: string[];
}

/** Seed a working config from the current effective chain. */
export function buildModelsPanelCfg(models: readonly string[]): ModelsPanelCfg {
  return { models: [...models] };
}

/** Build panel groups: one row per slot + add/remove actions.
 *  `options` adds inline model completions (optional so unit tests and
 *  non-TUI callers stay unchanged). */
export function buildRows(cfg: ModelsPanelCfg, options?: ModelsPanelOptions, actions: Record<string, PanelAction> = {}): PanelGroup[] {
  const modelItems = (): { value: string }[] =>
    (options?.models() ?? []).sort().map((ref) => ({ value: ref }));
  const withCompletions = options ? { completions: modelItems } : {};
  const slotRows = cfg.models.map((value, index) =>
    row(`model.${index}`, `#${index + 1}${index === 0 ? " (primary)" : ""}`, "string", value, (v) => {
      cfg.models[index] = String(v ?? "").trim();
    }, withCompletions),
  );
  const actionRows = Object.entries(actions).map(([key, action]) => ({ key, label: action.label, kind: "action" as const, value: "", set: action.run as unknown as (v: unknown) => void }));
  return [{ key: "models", label: "Model chain (ordered fallback, first = primary)", rows: [...slotRows, ...actionRows] }];
}

/** Convert a working config back to the saved chain (blanks removed). */
export function cfgToModels(cfg: ModelsPanelCfg): string[] {
  const out: string[] = [];
  for (const entry of cfg.models) {
    const trimmed = String(entry ?? "").trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}
