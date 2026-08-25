# Changelog

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
