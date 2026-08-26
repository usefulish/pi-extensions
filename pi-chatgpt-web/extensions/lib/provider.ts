import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChatGptWebConfig } from "./config.js";
import type { PiModel } from "./client.js";

export const PROVIDER_ID = "chatgpt-web";
export const CODEX_PROVIDER_ID = "codex-web";

/** Register the chatgpt-web provider with an eagerly-fetched model list.
 *  Mirrors pi-9router: models passed synchronously so Pi's catalog sees them
 *  at registration time for session restore. */
export function registerProvider(pi: ExtensionAPI, config: ChatGptWebConfig, models: PiModel[]): void {
  pi.registerProvider(PROVIDER_ID, {
    name: "ChatGPT Web (bridge)",
    baseUrl: config.baseUrl,
    apiKey: config.authKey || "chatgpt-web-no-key",
    api: "openai-completions",
    models,
  });
}

export function unregisterProvider(pi: ExtensionAPI): void {
  pi.unregisterProvider(PROVIDER_ID);
}

/** Register the codex-web provider (agentic Codex backend via codex-proxy). */
export function registerCodexProvider(pi: ExtensionAPI, config: ChatGptWebConfig, models: PiModel[]): void {
  pi.registerProvider(CODEX_PROVIDER_ID, {
    name: "Codex Web (proxy)",
    baseUrl: config.baseUrl,
    apiKey: config.authKey || "codex-web-no-key",
    api: "openai-completions",
    models,
  });
}

export function unregisterCodexProvider(pi: ExtensionAPI): void {
  pi.unregisterProvider(CODEX_PROVIDER_ID);
}
