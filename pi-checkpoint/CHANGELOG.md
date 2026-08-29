# Changelog

## 0.1.1 (2026-08-29)

### Added

- `/redo` argument completion mirrors `/undo` (`1|2|3` depths).

## 0.1.0

- Initial release.
- Git-backed `/undo [n]` and `/redo [n]` tied to turns.
- `/checkpoint` shows the session checkpoint stack.
- Snapshots stored under `refs/pi-checkpoints/<sessionId>/<n>` via `git stash create` (never touches user stash list).
- Graceful no-op outside a git repository.
- Zero dependencies, plain JS.
