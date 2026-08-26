# pi-advisor

A second model that watches your Pi coding agent work — plus an on-demand
consult tool. Inspired by the advisor subsystem in
[oh-my-pi](https://github.com/can1357/oh-my-pi).

- **Automatic turn-end review**: after each settled turn with real work, an
  isolated reviewer model examines the transcript and may emit **one** note:
  - `nit` — minor issue
  - `concern` — material risk
  - `blocker` — continuing would waste work
  - Every accepted note is delivered to the agent: as a follow-up turn
    (steering) when off-cooldown, or as a visible note deferred to the next
    turn during the post-steer calm-down window. The severity sets the note's
    authority wording (“nit — consider” vs “concern — address this” vs
    “blocker — fix before continuing”).
  - Post-steer cooldown: after a note steers, non-blocker notes within the
    next `immuneTurns` settled turns are deferred (LLM-visible next turn)
    instead of waking the agent again — bounds ping-pong. Blockers always
    steer immediately.
- **Emission guard** (noise control): content-free phrases ("lgtm", "done", …)
  are dropped, identical notes are deduped (severity escalation still passes),
  and at most one note is delivered per review cycle.
- **On-demand `advisor` tool**: the primary model can consult the configured
  second model for strategic guidance with the full sanitized transcript —
  useful before committing to a consequential approach.
- Review failures never break the primary loop; 3 consecutive failures pause
  watching for the session (`/advisor on` resumes).

## Install

```
npm install -g @bacnh85/pi-advisor
```

> If you previously used pi-plan's advisor, remove that package's old advisor
> (upgrade pi-plan to ≥ 0.11.0) before enabling pi-advisor so the `advisor`
> tool name does not collide. Your model preference migrates automatically.

## Configure

```bash
/advisor <provider/model>   # pick the reviewer/consult model (fuzzy match or picker)
/advisor status             # model, watch state, counters
/advisor on                 # enable watch for this session (also clears a pause)
/advisor off                # clear the model (disables tool + watch)
```

Settings live in `~/.pi/agent/settings.json` (global) and `.pi/settings.json`
(trusted projects, wins over global):

```json
{
  "pi-advisor": {
    "model": "anthropic/claude-haiku",
    "watch": { "enabled": true, "minToolCalls": 3, "immuneTurns": 3 }
  }
}
```

- `watch.enabled` (default `true`) — turn-end reviewing on session start
- `watch.minToolCalls` (default `3`, `0` = every turn) — skip trivial turns
- `watch.immuneTurns` (default `3`) — review window during which the same
  normalized note is not re-delivered (loop protection); distinct concerns and
  blockers still steer immediately.

Use a cheap, fast model for the watcher (it reviews every non-trivial turn);
use a strong reasoner when consulting on demand — both use the same model in
this version.
