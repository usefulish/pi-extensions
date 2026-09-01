import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseModel } from "./config";

export interface IsolatedContext {
  systemPrompt: string;
  messages: any[];
}

export function text(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
}

export async function runIsolated(
  ctx: ExtensionContext,
  modelId: string | undefined,
  context: IsolatedContext,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
  reasoning?: string,
): Promise<string> {
  const parsed = modelId ? parseModel(modelId) : undefined;
  if (modelId && !parsed) throw new Error(`Invalid model: ${modelId}`);
  const model = parsed ? ctx.modelRegistry.find(parsed.provider, parsed.id) : ctx.model;
  if (!model) throw new Error(`Model unavailable: ${modelId ?? "active"}`);
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  const provider = ctx.modelRegistry.getRegisteredProviderConfig(model.provider);
  const options: Record<string, unknown> = { apiKey: auth.apiKey, headers: auth.headers, env: auth.env, signal, reasoning };
  // ponytail: providers accept SimpleStreamOptions which expects ThinkingLevel for reasoning
  const streamOptions = options as any;
  const response = provider?.streamSimple
    ? provider.streamSimple(model, context, streamOptions)
    : streamSimple(model, context, streamOptions);
  for await (const event of response) if (event.type === "text_delta") onDelta?.(event.delta);
  const result = await response.result();
  if (result.stopReason !== "stop") throw new Error(result.errorMessage ?? `Model stopped: ${result.stopReason}`);
  return text(result);
}

/**
 * Try each model in priority order: unresolvable candidates are skipped;
 * any call error (rate limit, quota, unavailable, network) advances to the
 * next candidate — for a best-effort reviewer any dead candidate should
 * yield to the next. All exhausted → the last error is rethrown.
 * No parent-model fallback: the advisor must never use the primary model.
 */
/** Delta sink; `attempt` increments each time a new candidate starts, so
 *  callers can reset progressive state when a dead candidate is replaced. */
export type ChainOnDelta = (delta: string, attempt: number) => void;

export async function runIsolatedChain(
  ctx: ExtensionContext,
  models: readonly string[],
  context: IsolatedContext,
  onDelta?: ChainOnDelta,
  signal?: AbortSignal,
  reasoning?: string,
): Promise<{ text: string; model: string }> {
  let lastError: unknown;
  for (const [attempt, modelId] of models.entries()) {
    if (signal?.aborted) throw new Error("Advisor call aborted");
    try {
      return { text: await runIsolated(ctx, modelId, context, (delta) => onDelta?.(delta, attempt), signal, reasoning), model: modelId };
    } catch (error) {
      // An abort is a caller decision, not a dead model — do not fall through.
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`All advisor models failed: ${models.join(", ") || "none configured"}`);
}
