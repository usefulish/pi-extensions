# Changelog

## 0.1.3

- Fix hang after install: the picker left stdin resumed/raw, keeping the event loop alive after `main()` resolved. Now pauses stdin in cleanup and exits explicitly once pending stdout flushes.
- Wider descriptions: picker rows use full terminal width (name column padded, description fills the rest) and the detail line shows the full npm name + description; `find` no longer caps descriptions at 100 chars.

## 0.1.2

- Regenerate catalog: pi-hub's own entry pointed at the pre-rename unscoped name (`pi-hub` → `@bacnh85/pi-hub`), which would have resolved `pi-hub add pi-hub` to a nonexistent npm package.

## 0.1.1

- Fix picker redraw: first item line was indented after arrow-key navigation (`moveCursor(0, -N)` keeps the column; now emits `\r` first) and the frame drifted up one row per redraw (hint line has no trailing `\n`; up-move is now `items.length + 1`).

## 0.1.0

- Published as `@bacnh85/pi-hub` (unscoped `pi-hub` rejected by npm — name too similar to `github`).
- Initial release: interactive catalog browser, `add` with shorthand resolution (curated dir name / scoped npm / owner-repo / passthrough), `find` merging curated catalog + npm `keywords:pi-package` search, `list` from pi settings, `remove`, `update` passthrough.
- Zero runtime dependencies; plain JS ESM; Node ≥ 20.
