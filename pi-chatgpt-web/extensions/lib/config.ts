import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatGptWebConfig {
  /** Bridge base URL including the API version segment, e.g. http://172.30.55.22:3001/v1.
   *  Pi appends /chat/completions verbatim, so the /v1 segment is required. */
  baseUrl: string;
  /** Bearer auth-key of the bridge. */
  authKey: string | undefined;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Env-file discovery chain per repo convention:
 *  process.env → cwd .env.local → cwd .env → global .env.local → global .env.
 *  Pi does NOT inject ~/.pi/agent/.env.local into process.env — packages
 *  must read these files themselves. */
const ENV_FILES = [
  () => join(process.cwd(), ".env.local"),
  () => join(process.cwd(), ".env"),
  () => join(homedir(), ".pi", "agent", ".env.local"),
  () => join(homedir(), ".pi", "agent", ".env"),
];

export const DEFAULT_BASE_URL = "http://172.30.55.22:3001/v1";
export const CODEX_DEFAULT_BASE_URL = "http://172.30.55.22:8086/v1";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "chatgpt-web-config.json");
const CODEX_CONFIG_PATH = join(homedir(), ".pi", "agent", "codex-web-config.json");

// ── Env-file helpers ─────────────────────────────────────────────────────────

/** Parse KEY=VALUE from dotenv-style content. Exported for tests. */
export function parseEnvValue(content: string, key: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(key + "=")) continue;
    const value = trimmed.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return undefined;
}

function readEnvValue(key: string): string | undefined {
  for (const file of ENV_FILES) {
    try {
      if (!existsSync(file())) continue;
      const value = parseEnvValue(readFileSync(file(), "utf8"), key);
      if (value) return value;
    } catch {
      // unreadable file — try the next one
    }
  }
  return undefined;
}

// ── Shared config persistence ────────────────────────────────────────────────

function loadConfigAt(path: string): ChatGptWebConfig | null {
  try {
    if (!existsSync(path)) return null;
    const data = JSON.parse(readFileSync(path, "utf8")) as Partial<ChatGptWebConfig>;
    if (!data.baseUrl || typeof data.baseUrl !== "string") return null;
    return {
      baseUrl: normalizeUrl(data.baseUrl),
      authKey: typeof data.authKey === "string" && data.authKey.trim() ? data.authKey.trim() : undefined,
    };
  } catch {
    return null;
  }
}

function saveConfigAt(path: string, config: ChatGptWebConfig): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  } catch (err) {
    console.error("[pi-chatgpt-web] Failed to persist config:", err);
  }
}

/** effective = env chain (envKeyPrefix_BASE_URL/_AUTH_KEY) → saved → default. */
function effectiveConfig(path: string, envPrefix: string, defaultBaseUrl: string): ChatGptWebConfig {
  const saved = loadConfigAt(path);
  const envBase = process.env[`${envPrefix}_BASE_URL`] || readEnvValue(`${envPrefix}_BASE_URL`);
  const envKey = process.env[`${envPrefix}_AUTH_KEY`] || readEnvValue(`${envPrefix}_AUTH_KEY`);
  return {
    baseUrl: normalizeUrl(envBase || saved?.baseUrl || defaultBaseUrl),
    authKey: envKey || saved?.authKey || undefined,
  };
}

// ── Public API — chatgpt-web (chat-only web bridge) ─────────────────────────

export function loadConfig(): ChatGptWebConfig | null {
  return loadConfigAt(CONFIG_PATH);
}

export function saveConfig(config: ChatGptWebConfig): void {
  saveConfigAt(CONFIG_PATH, config);
}

export function getEffectiveConfig(): ChatGptWebConfig {
  return effectiveConfig(CONFIG_PATH, "CHATGPT_WEB", DEFAULT_BASE_URL);
}

// ── Public API — codex-web (agentic Codex backend via codex-proxy) ──────────

export function loadCodexConfig(): ChatGptWebConfig | null {
  return loadConfigAt(CODEX_CONFIG_PATH);
}

export function saveCodexConfig(config: ChatGptWebConfig): void {
  saveConfigAt(CODEX_CONFIG_PATH, config);
}

export function getEffectiveCodexConfig(): ChatGptWebConfig {
  return effectiveConfig(CODEX_CONFIG_PATH, "CODEX_WEB", CODEX_DEFAULT_BASE_URL);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function maskAuthKey(key: string | undefined): string {
  if (!key || key.length <= 8) return key ?? "(not set)";
  return key.slice(0, 4) + "●".repeat(key.length - 8) + key.slice(-4);
}

export function configSummary(config: ChatGptWebConfig): string {
  return `Endpoint: ${config.baseUrl}\nAuth key: ${maskAuthKey(config.authKey)}`;
}
