# Changelog

## 1.1.1 — 2026-08-25

### Fixed

- **Context window under-reported via router aggregation**: routers that
  forward OpenAI-compat upstream catalogs (e.g. omniroute) report context
  as top-level `context_length` / `max_output_tokens`, not
  `capabilities.contextWindow`. `mapModel` now reads `context_length` /
  `max_output_tokens` first (1508/1550 live models carry it), so
  `meta/muse-spark-1.2-contributor` and every other routed model no longer
  collapses to the 128K fallback. The on-disk `CONTEXT_OVERRIDES` table
  (fixes 9router's 200K floor for `glm-5.2`/`deepseek-v4`) now applies only
  to responses with NO top-level fields (a `null` or `undefined`
  `context_length`/`max_output_tokens` counts as absent) — it cannot inflate a
  router that truthfully reports a smaller `context_length`, and a partial
  presence of one top-level field never mixes a stale override into the other
  (provenance stays single-tier). It still intentionally overrides
  `capabilities.*` for 9router-shape routers until that table is refreshed.
  Same ordering as `pi-commandcode` 0.1.6.

## 1.1.0 — 2026-08-22

### Added

- **`/router-config`** — interactive settings panel (TUI) built on the shared
  `@bacnh85/pi-config-panel` kernel. Edit `router.baseUrl` and
  `router.enableReasoning` with arrow keys; Esc saves to `~/.pi/agent/settings.json`
  (merge, never clobber), re-registers the provider, forces a catalog refresh, and
  keeps the active model valid (`refreshActiveModel`). Warns when env vars or repo
  `.pi/settings.json` shadow the saved values. Non-TUI mode / `show` arg prints a
  config summary (endpoint, reasoning flag, masked key source).

## 1.0.1 — 2026-08-22

Review fixes:
- Model discovery no longer doubles the `/v1` path segment when `router.baseUrl`
  already ends in `/v1` (GET `…/v1/models`, not `…/v1/v1/models`).
- Discovery now sends the `/login router` credential (auth.json) as the
  Bearer token via `RefreshModelsContext.credential`; `ROUTER_API_KEY` /
  `NINE_ROUTER_API_KEY` env remain the fallback when no credential is stored.
- Claude thinking-format detection: version parsed from the leading
  major[.-]minor token — `claude-3-5`/`claude-3-7` are budget (not adaptive),
  `claude-4-6`/`claude-opus-4.6`/`claude-sonnet-5` are adaptive.
- Migration never overwrites an unparseable settings.json/auth.json (bails and
  retries next load instead of wiping with a `{}` seed); rename is race-safe
  across concurrent Pi sessions; the whole migration is guarded in the
  extension factory so an fs error can't kill provider registration.
- `/router-reasoning` reports the effective flag (env/repo override detected).
- LICENSE file included in the published tarball.

## 1.0.0 — 2026-08-21

Renamed from `@bacnh85/pi-9router` and generalized to any OpenAI-compatible
router (9router, omniroute, …). Provider id: `router` (models appear as
`router/…`).

### Breaking changes

- Provider id changed `9router` → `router`; update any `9router/…` model ids.
- `/login-9router`, `/9router-status|model|reasoning` removed — use
  `/login router` (built-in), `/router-status`, `/router-model`,
  `/router-reasoning`.
- Config file `~/.pi/agent/9router-config.json` no longer read — migrated
  automatically on first load (file renamed `.migrated`), then settings live in:
  - settings.json → `router.baseUrl`, `router.enableReasoning`
  - auth.json → `router` credential (via `/login router`)
- Event `9router:models-loaded` renamed `router:models-loaded` (pi-plan
  updated accordingly).

### Added

- Pi-native model discovery: `refreshModels` fetches `GET /v1/models` and
  persists the catalog to `~/.pi/agent/models-store.json` — cached across
  sessions, restores offline, no custom cache files.
- Built-in `/login router` support (API key in auth.json, standard api-key flow).
- One-shot migration from pi-9router config (see README).

### Removed

- Manual background discovery + `~/.cache/pi/9router-models.json` cache
  (~80 lines) — replaced by Pi's models-store.

Earlier history under the `pi-9router` name: see the old package (v0.1.x).
