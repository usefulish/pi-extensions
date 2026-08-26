# pi-chatgpt-web

Turn a self-hosted **ChatGPT web bridge** (OpenAI-compatible reverse proxy for
chatgpt.com, e.g. [basketikun/chatgpt2api](https://github.com/basketikun/chatgpt2api))
into a first-class Pi provider. Free web-tier models (`gpt-5-5`, `gpt-5-6`,
`gpt-5-6-mini`, …) become selectable via `/model` like any other model —
no ChatGPT Plus/Pro subscription, no OpenAI API billing.

```
Pi ── openai-completions ──► self-hosted web bridge (docker) ──► chatgpt.com web backend
```

The extension is **bridge-agnostic**: any OpenAI-compatible web2api endpoint
works. The default targets the homelab chatgpt2api deployment
(`http://172.30.55.22:3001/v1`), managed by the homelab-playbook / pi-s2.

## Install

```jsonc
// ~/.pi/agent/settings.json
{
  "packages": ["@bacnh85/pi-chatgpt-web"]
}
```

## Configure

Set the auth key once (the bridge's `auth-key`, from your deployment secrets):

```bash
# ~/.pi/agent/.env.local (or any env source)
CHATGPT_WEB_AUTH_KEY=your-bridge-auth-key
# Optional — override the endpoint (must include /v1):
# CHATGPT_WEB_BASE_URL=http://172.30.55.22:3001/v1
```

Or interactively: `/login-chatgpt-web` (prompts for URL + key, tests the
connection, saves to `~/.pi/agent/chatgpt-web-config.json`).

Resolution order: `CHATGPT_WEB_BASE_URL` / `CHATGPT_WEB_AUTH_KEY` env vars →
saved config → default `http://172.30.55.22:3001/v1`.

⚠️ The bridge `baseUrl` **must include `/v1`** — Pi appends `/chat/completions`
verbatim (missing the version segment causes 404s).

## Use

```
/chatgpt-web-status    # bridge reachability, model count, account pool health
/chatgpt-web-model     # search + select a model
/model                 # Pi built-in picker: chatgpt-web/gpt-5-5-mini, …
```

## Chat-only limitation (important)

The bridge routes text models through chatgpt.com's **web conversation API**,
which has **no function calling** — verified live: `tools` on
`/v1/chat/completions` and even forced `tool_choice` on `/v1/responses` are
silently ignored. Every chatgpt-web model is therefore **chat-only**:

- ✅ Ask questions, analysis, drafting, explanations
- ❌ File access, shell, edits, subagents — no tool of any kind

Model names carry a `(chat only)` suffix so this is visible in `/model`.
Use a tool-capable provider (or the Codex backend via a Codex-proxy) for
agentic work.

## codex-web — agentic (tool-capable) ChatGPT access

The sibling provider **`codex-web`** in this same package routes through the
homelab-deployed [icebear0828/codex-proxy](https://github.com/icebear0828/codex-proxy)
(`http://172.30.55.22:8086/v1`), which proxies chatgpt.com's **Codex backend**
with native function calling — file access, shell, edits all work. Use this
for real coding sessions; use `chatgpt-web` for free-form chat.

```bash
# ~/.pi/agent/.env.local
CODEX_WEB_AUTH_KEY=<vault_codex_proxy_api_key>
```

One-time setup: open `http://172.30.55.22:8086` in a browser and complete the
OAuth PKCE login with a ChatGPT account (free account works). Accounts persist
in the proxy's `data/` volume.

```
/login-codex-web      # configure URL + key
/codex-web-status     # proxy reachability + model catalog
/codex-web-model      # search and select
/model                # codex-web/gpt-5.4, codex-web/gpt-5.5, …
```

Models (live from the proxy, 2026-08-20): `gpt-5.6-terra` (272k/872k max),
`gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4-mini`, `codex-auto-review` — context
windows synced from the proxy's own metadata. Reasoning always on
(off maps to lowest effort); `-fast` suffix variants if the proxy lists them.
Free-plan Codex quotas apply.

## Prerequisite: the bridge account pool

The web bridge needs at least one ChatGPT web account (access_token) in its
pool — add one via the bridge admin panel (`http://172.30.55.22:3001/accounts`).
With an empty pool, **every completion fails** with a 502 upstream error; the
extension surfaces this as an actionable hint via `message_end` normalization.

⚠️ **Ban risk is real.** All web2api bridges violate OpenAI's ToS for automated
use. Use a burner account, never a valued one. Usage is also **not unlimited**:
free web tier has per-account and per-IP rate limits, and agent-style traffic
is conspicuous. Tool-call fidelity through the bridge should be verified before
daily-driving it.

## Commands

| Command | Description |
|---------|-------------|
| `/login-chatgpt-web` | Configure bridge URL + auth key (TUI) |
| `/chatgpt-web-model` | Search and select a chatgpt-web model (TUI) |
| `/chatgpt-web-status` | Show status, models, and account pool health |

## Design notes

- Provider id: `chatgpt-web`, api: `openai-completions`.
- Models discovered live from `GET {baseUrl}/models`; `gpt-5*` family and
  `auto` registered as reasoning models, image models filtered out. Cost is
  zero (web tier, not billed). Context window falls back to 128k placeholders
  (the bridge's model list carries no window metadata).
- Startup never blocks on the bridge: disk cache first (`~/.cache/pi/chatgpt-web-models.json`),
  then background discovery with a 5s timeout, re-registering on success.
- Bridge failures with `upstream_error` / `backend-anon` are rewritten to
  "empty account pool" hints; rate-limit and overflow errors pass through
  untouched.

## License

MIT
