/**
 * `/subagent roles` panel (kernel lives in @bacnh85/pi-config-panel).
 *
 * Row model for role-based model routing: one string row per role (comma
 * chain, blank = reset to default) and one string row per discovered agent
 * (`subagent.agentModels` override, blank = inherit agent file settings).
 * Saving writes both maps to the GLOBAL `~/.pi/agent/settings.json` under
 * `subagent.roles` / `subagent.agentModels` (merge + atomic rename), then
 * invalidates the agent cache.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { row } from "@bacnh85/pi-config-panel";
import type { PanelGroup } from "@bacnh85/pi-config-panel";
import type { AgentConfig } from "./agents.ts";
import { DEFAULT_ROLES, readSubagentRoles, type RolesConfig } from "./roles.ts";

// ---------------------------------------------------------------------------
// Settings persistence (global only — repo .pi/settings.json is read-only)
// ---------------------------------------------------------------------------

function settingsPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(agentDir, "settings.json");
}

/** Read the GLOBAL settings.json. Returns null only when the file is missing;
 *  throws when the file exists but is not valid JSON (so a corrupt file can
 *  never be silently overwritten by a panel save). */
function readSettingsJson(): Record<string, unknown> | null {
  const path = settingsPath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`settings.json root is not a JSON object (${path})`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && err.message.includes("not a JSON object")) throw err;
    throw new Error(`settings.json is not valid JSON (${path})`);
  }
}

/** Read-modify-write the `subagent` section of the GLOBAL settings.json.
 *  Writes a temp file then renames (atomic); never touches other keys.
 *  Throws if the existing settings.json is corrupt (the file is left intact).
 *  Returns false when nothing changes. */
export function writeSubagentSection(patch: { roles?: RolesConfig["roles"]; agentModels?: RolesConfig["agentModels"] }): boolean {
  const settings = readSettingsJson() ?? {};
  const existing = (settings.subagent ?? {}) as Record<string, unknown>;
  const subagent = { ...existing };
  if (patch.roles !== undefined) subagent.roles = patch.roles;
  if (patch.agentModels !== undefined) subagent.agentModels = patch.agentModels;
  if (JSON.stringify(subagent) === JSON.stringify(existing)) return false;
  const rolesEmpty = subagent.roles === undefined || (typeof subagent.roles === "object" && Object.keys(subagent.roles as object).length === 0);
  const modelsEmpty = subagent.agentModels === undefined || (typeof subagent.agentModels === "object" && Object.keys(subagent.agentModels as object).length === 0);
  if (rolesEmpty) delete subagent.roles;
  if (modelsEmpty) delete subagent.agentModels;
  // Preserve any unrelated subagent.* keys (forward compat); drop the section
  // only when roles/agentModels were the only content.
  if (Object.keys(subagent).length === 0) delete settings.subagent;
  else settings.subagent = subagent;
  const target = settingsPath();
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, target);
  return true;
}

// ---------------------------------------------------------------------------
// Row model — unit-testable without a TUI
// ---------------------------------------------------------------------------

export interface RolesPanelCfg {
  /** Working copy: role name → comma chain ("" = use default). */
  roles: Record<string, string>;
  /** Working copy: agent name → override selector ("" = inherit). */
  agentModels: Record<string, string>;
}

/** Seed a working config from current effective settings + bundled agents. */
export function buildRolesPanelCfg(agents: AgentConfig[], current: RolesConfig): RolesPanelCfg {
  const roleNames = new Set([...Object.keys(DEFAULT_ROLES), ...Object.keys(current.roles)]);
  const cfg: RolesPanelCfg = { roles: {}, agentModels: {} };
  for (const name of roleNames) {
    // Only show explicitly-configured values; defaults render blank (= default).
    const explicit = (current.roles[name] !== undefined && JSON.stringify(current.roles[name]) !== JSON.stringify(DEFAULT_ROLES[name]))
      ? (Array.isArray(current.roles[name]) ? current.roles[name].join(", ") : String(current.roles[name]))
      : "";
    cfg.roles[name] = explicit;
  }
  for (const agent of agents) cfg.agentModels[agent.name] = current.agentModels[agent.name] ?? "";
  return cfg;
}

/** Build panel groups. Role rows first, then one override row per agent. */
export function buildRows(cfg: RolesPanelCfg, agents: AgentConfig[]): PanelGroup[] {
  const defaultChain = (name: string) => Array.isArray(DEFAULT_ROLES[name]) ? (DEFAULT_ROLES[name] as string[]).join(", ") : String(DEFAULT_ROLES[name] ?? "");
  const roleRows = Object.keys(cfg.roles).sort().map((name) => {
    // Label shows the default chain so blank is meaningful.
    return row(`role.${name}`, `@${name}  (default: ${defaultChain(name) || "none"})`, "string", cfg.roles[name], (v) => {
      cfg.roles[name] = String(v ?? "").trim();
    });
  });
  const agentRows = agents.map((agent) =>
    row(`agent.${agent.name}`, agent.name, "string", cfg.agentModels[agent.name] ?? "", (v) => {
      const value = String(v ?? "").trim();
      if (value) cfg.agentModels[agent.name] = value;
      else delete cfg.agentModels[agent.name];
    }),
  );
  return [
    { key: "roles", label: "Model roles (chain, blank = default)", rows: roleRows },
    { key: "agents", label: "Per-agent overrides (blank = inherit)", rows: agentRows },
  ];
}

/** Convert a working config back to a settings patch. Blank values drop keys
 *  (role falls back to default; agent override is removed). */
export function cfgToPatch(cfg: RolesPanelCfg): { roles: RolesConfig["roles"]; agentModels: RolesConfig["agentModels"] } {
  const roles: RolesConfig["roles"] = {};
  for (const [name, chain] of Object.entries(cfg.roles)) {
    const trimmed = chain.trim();
    if (!trimmed) continue;
    roles[name] = trimmed.includes(",") ? trimmed.split(",").map((s) => s.trim()).filter(Boolean) : trimmed;
  }
  const agentModels: RolesConfig["agentModels"] = {};
  for (const [name, value] of Object.entries(cfg.agentModels)) {
    const trimmed = value.trim();
    if (trimmed) agentModels[name] = trimmed;
  }
  return { roles, agentModels };
}

/** Keep overrides for agents NOT shown in the panel (e.g. overrides for
 *  project-local agents saved globally from another project) so a panel save
 *  doesn't wipe them. Discovered-agent entries always follow the panel. */
export function preserveUnknownAgentModels(
  patch: RolesConfig["agentModels"],
  discoveredNames: readonly string[],
  existing: RolesConfig["agentModels"] | undefined,
): RolesConfig["agentModels"] {
  if (!existing) return patch;
  const out = { ...patch };
  for (const [name, value] of Object.entries(existing)) {
    if (!discoveredNames.includes(name) && out[name] === undefined) out[name] = value;
  }
  return out;
}
