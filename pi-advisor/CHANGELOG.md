# Changelog

## 0.1.4 (2026-08-26)

### Changed

- Post-steer cooldown (OMP parity): after any advisor note steers a turn,
  non-blocker notes within the next `immuneTurns` settled turns are deferred to
  LLM-visible next-turn asides instead of waking the agent again. Without this,
  each new settled turn's fresh transcript lets the reviewer emit a new note
  every cycle and the identical-note dedupe never trips — an unbounded
  nit/concern ping-pong. Blockers always steer immediately (OMP #5628: handing
  off broken work must be acknowledged). Deferred notes are never lost — they
  appear in the agent's context on the next user- or blocker-driven turn.

## 0.1.3 (2026-08-26)

### Changed

- Every accepted advisor note now steers the agent as a follow-up turn,
  regardless of severity (nit included). The review runs from `agent_settled`,
  when the primary turn is already idle — there is no next step boundary to
  batch a non-interrupting aside into, so a nit delivered as a card was never
  acted on until the next user prompt (or never at all). Severity still sets
  the note's authority wording ("nit — consider" vs "concern — address this"
  vs "blocker — fix before continuing"). Loop protection remains the emission
  guard (same normalized note not re-delivered within `immuneTurns`).

### Fixes

- Peer dependency range narrowed to `>=0.84.3 <0.85.0` (the model-picker `ModelSelectorComponent` call is only valid against the 0.84.3 SDK signature).

## 0.1.2 (2026-08-26)

### Fixes

- Reviewer severity calibration: rate by end state, not by the agent's summary.
  Disclosure or acknowledgement no longer demotes a broken/non-compiling result or
  a violated user constraint to a nit — such notes are at least a `concern`, so they
  steer a follow-up turn after a settled summary instead of sitting as an aside.
  Handles the case where the advisor sent a note after the agent's final summary but
  the agent never continued to act on it.

## 0.1.1 (2026-08-26)

### Fixes

- Model picker now matches Pi 0.84.3's `ModelSelectorComponent` constructor
  (the `settings` param was removed; default-model persistence is now via
  Ctrl+S and stays disabled here). Fixes a typecheck failure against
  `@earendil-works/pi-coding-agent@0.84.3`.
- DevDeps bumped to pi SDK/pi-tui 0.84.3 for CI parity.

## 0.1.0 (2026-08-25)

### Fixes

- Emission guard now suppresses no-op verdicts wrapped in prose: a reviewer
  note that leads or closes with "no note warranted", "no issues found",
  "nothing to flag", etc. is treated as content-free and not delivered as a
  nit (previously only exact whole-note matches were blocked, so a note like
  "…trivial edit matching the request exactly. No note warranted." was still
  delivered).

### Initial release

- Moved from pi-plan: the on-demand `advisor` tool (second-opinion consult over
  the full sanitized session transcript) and the `/advisor` model picker.
  Model preference lives in `~/.pi/agent/settings.json` under `"pi-advisor"` and
  auto-migrates from pi-plan's `advisorModel` on first start.
- New: automatic turn-end reviewing. After each settled turn with at least
  `watch.minToolCalls` (default 3) tool calls, an isolated second model reviews
  the turn and may emit one note:
  - `nit` → non-interrupting aside: rendered as an Advisor card and batched into
    the primary agent's LLM context on the next turn (visible card, never a steer)
  - `concern` / `blocker` → follow-up message that steers the agent (always —
    no silent downgrade; repeated distinct concerns steer too, loop protection
    is the emission guard's dedupe window)
- Watching is gated on a configured model: without `pi-advisor.model` no review
  runs (the primary model never reviews its own turns), and `/advisor off`
  stops both the tool and the watch.
- Legacy pi-plan migration is versioned (`pi-advisor.migrationVersion`): the
  `advisorModel` preference is adopted exactly once; an explicit disable is
  never resurrected by the legacy file on restart.
- Emission guard (noise control): content-free phrase blocklist ("lgtm",
  "done", …), normalized-text dedupe with severity escalation, one note per
  review cycle. Nits are delivered with `sendMessage({ triggerTurn: false })` so a
  concurrent user turn is never steered; concerns/blockers steer via `followUp`.
- Review failures never break the primary loop; after 3 consecutive failures
  watching pauses for the session (resume with `/advisor on`).
- Explicit `/advisor off` stamps `pi-advisor.migrationVersion` so the legacy
  pi-plan migration never resurrects a disabled advisor; a trusted project's
  `.pi/settings.json` `pi-advisor.model` now warns when it shadows the global disable.
- `/advisor on|off|watch-off|status` session controls + counters.
