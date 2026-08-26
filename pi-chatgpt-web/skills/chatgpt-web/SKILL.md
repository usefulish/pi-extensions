---
name: chatgpt-web
description: Use the chatgpt-web provider (ChatGPT web bridge) when the user mentions chatgpt-web, ChatGPT web tier, chatgpt2api, web2api bridge, free ChatGPT models, or selecting gpt-5-5/gpt-5-6 web models. Covers status checks, model selection, bridge configuration, and empty-account-pool failures.
---

# chatgpt-web provider

The `chatgpt-web` Pi provider routes requests through a self-hosted
OpenAI-compatible bridge (e.g. basketikun/chatgpt2api) to chatgpt.com's web
tier. Free web-tier models (`gpt-5-5`, `gpt-5-6`, `gpt-5-6-mini`, `auto`) —
no Plus subscription, no API billing.

## When to use

- `chatgpt-web` — free chat/analysis/drafting, NO tools (web conversation API
  has no function calling; verified live).
- `codex-web` — real coding sessions with tools (file access, shell, edits)
  via the Codex backend proxy. Default for any workspace task.

## Commands

- `/chatgpt-web-status` — bridge reachability, model count, account pool health.
  Check this FIRST when anything fails.
- `/login-chatgpt-web` — reconfigure bridge URL + auth key.
- `/chatgpt-web-model <term>` — search and select a model.
- `/model` — Pi built-in picker works normally (`chatgpt-web/gpt-5-6-mini`).

## Failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| 502 upstream_error / backend-anon 403 | Bridge account pool EMPTY | Add a burner web account at the bridge admin panel (`http://172.30.55.22:3001/accounts`) |
| 401 invalid_api_key | Wrong auth key | `/login-chatgpt-web` or fix `CHATGPT_WEB_AUTH_KEY` |
| No models at startup | Bridge down | Provider registers empty; `/login-chatgpt-web` re-fetches once bridge is up |
| 429 | Web-tier rate limit (per-account/per-IP) | Not "unlimited" — wait or switch model |
| codex-web: empty model list | No OAuth login in codex-proxy panel | Open `http://172.30.55.22:8086`, log in with a ChatGPT account |
| codex-web: tools "missing" | — | Impossible; codex-web is tool-capable. Check `/codex-web-status` and model selection |

## Constraints

- Bridge baseUrl must include `/v1` (Pi appends `/chat/completions` verbatim).
- ToS/ban risk: reverse-engineering the web backend violates OpenAI ToS.
  Burner accounts only. Verify tool-call fidelity before daily use.
- Models are discovered live from `GET {baseUrl}/models`; the list does NOT
  reflect pool state — a model can be listed while every completion fails.
