import type { ChatGptWebConfig } from "./config.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatGptWebModelRaw {
  id: string;
  object?: string;
  owned_by?: string;
  [key: string]: unknown;
}

export interface ChatGptWebModelsResponse {
  object: string;
  data?: ChatGptWebModelRaw[];
}

/** Pi model shape. */
export type PiModel = {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  compat?: {
    supportsStore: boolean;
    supportsDeveloperRole: boolean;
    supportsReasoningEffort: boolean;
    maxTokensField: "max_tokens";
  };
};

/** Account pool entry from the bridge's /api/accounts. */
export interface AccountPoolStatus {
  total: number;
  raw: unknown;
}

// ── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 15_000;
const FALLBACK_CONTEXT_WINDOW = 128_000;
const FALLBACK_MAX_TOKENS = 4_096;

/** Codex catalog fallbacks when the proxy's model list carries no metadata
 *  (from codex-proxy README, runtime-synced values override these). */
const CODEX_CONTEXT_FALLBACKS: { pattern: RegExp; contextWindow: number; maxTokens: number }[] = [
  { pattern: /gpt-5\.4-mini|gpt-5\.3-codex|gpt-5\.2|gpt-5-codex/i, contextWindow: 400_000, maxTokens: 128_000 },
  { pattern: /gpt-5\.4(?!-)/i, contextWindow: 272_000, maxTokens: 128_000 },
  { pattern: /gpt-5\.5(?!-)/i, contextWindow: 272_000, maxTokens: 128_000 },
  { pattern: /gpt-oss-120b|gpt-oss-20b/i, contextWindow: 131_072, maxTokens: 32_768 },
];

/** Models we hand off to the web conversation backend. Anything the bridge
 *  lists but this rejects (e.g. gpt-image-2 on some deployments) is skipped. */
function isTextModel(id: string): boolean {
  const lower = id.toLowerCase();
  return !lower.includes("image");
}

/** Human-friendly display names for known web-tier families.
 *  All text models are CHAT-ONLY: the bridge routes them through the web
 *  conversation API which has no function calling (verified live — even
 *  forced tool_choice is ignored). The suffix prevents wasted sessions. */
const CHAT_ONLY = " (chat only)";
const KNOWN_NAMES: [RegExp, string][] = [
  [/^auto$/, "Auto (web auto-routing)" + CHAT_ONLY],
];

function displayName(id: string): string {
  for (const [pattern, name] of KNOWN_NAMES) {
    if (pattern.test(id)) return name;
  }
  return id + CHAT_ONLY;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** GET {baseUrl}/models — baseUrl already includes /v1 (see config). */
export async function fetchModels(
  config: ChatGptWebConfig,
  signal?: AbortSignal,
): Promise<ChatGptWebModelRaw[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.authKey) headers.Authorization = `Bearer ${config.authKey}`;

  const url = `${config.baseUrl}/models`;
  const response = await fetchWithTimeout(url, { headers, signal });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`chatgpt-web bridge returned ${response.status}: ${text || response.statusText}`);
  }

  const payload = (await response.json()) as ChatGptWebModelsResponse;
  return (payload.data ?? []).filter((m) => typeof m?.id === "string" && isTextModel(m.id));
}

/** GET {baseUrl}/accounts → { total, raw } (chatgpt2api pool monitor).
 *  baseUrl includes /v1, so strip it to reach the admin API at the root. */
export async function fetchAccountPool(
  config: ChatGptWebConfig,
  signal?: AbortSignal,
): Promise<AccountPoolStatus> {
  const root = config.baseUrl.replace(/\/v1\/?$/, "");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.authKey) headers.Authorization = `Bearer ${config.authKey}`;

  const response = await fetchWithTimeout(`${root}/api/accounts`, { headers, signal });
  if (!response.ok) {
    throw new Error(`account pool endpoint returned ${response.status}`);
  }
  const raw = (await response.json()) as { items?: unknown[] } | unknown;
  const items = Array.isArray((raw as { items?: unknown[] })?.items)
    ? (raw as { items: unknown[] }).items
    : [];
  return { total: items.length, raw };
}

export function mapModel(raw: ChatGptWebModelRaw): PiModel {
  const lower = raw.id.toLowerCase();
  const isGpt5Family = lower.includes("gpt-5");
  const isReasoning = isGpt5Family || lower === "auto";

  return {
    id: raw.id,
    name: displayName(raw.id),
    reasoning: isReasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: FALLBACK_CONTEXT_WINDOW,
    maxTokens: FALLBACK_MAX_TOKENS,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    },
  };
}

// ── codex-web (agentic Codex backend via codex-proxy) ───────────────────────

/** Map a codex-proxy model. Tool-capable: no "(chat only)" suffix. Codex
 *  models always reason — off maps to "low" (lowest effort), and reasoning
 *  effort is passed through (the proxy translates it to the Codex backend).
 *  Context window/max tokens come from the proxy's own metadata
 *  (context_window / max_context_window), falling back to the catalog table. */
export function mapCodexModel(raw: ChatGptWebModelRaw): PiModel {
  const lower = raw.id.toLowerCase();
  const base = lower.replace(/-(fast|high|low|medium|xhigh)$/, "");
  const override = CODEX_CONTEXT_FALLBACKS.find((o) => o.pattern.test(base));
  const isReasoning = base.includes("gpt-5") || base.includes("gpt-oss") || base.includes("codex");
  const ctx = parsePositiveInt(raw.context_window) ?? parsePositiveInt((raw as { max_context_window?: unknown }).max_context_window);
  const maxOut = parsePositiveInt(raw.max_output_tokens);

  return {
    id: raw.id,
    name: raw.id,
    reasoning: isReasoning,
    ...(isReasoning ? {
      thinkingLevelMap: {
        off: "low",
        minimal: "low",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "xhigh",
      } as Record<string, string | null>,
    } : {}),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: ctx ?? override?.contextWindow ?? FALLBACK_CONTEXT_WINDOW,
    maxTokens: maxOut ?? override?.maxTokens ?? FALLBACK_MAX_TOKENS,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: isReasoning,
      maxTokensField: "max_tokens",
    },
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  return undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { signal?: AbortSignal } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();

  const signal = init.signal;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
