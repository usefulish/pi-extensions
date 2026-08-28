# Changelog

## 0.1.1

- Fix picker redraw: first item line was indented after arrow-key navigation (`moveCursor(0, -N)` keeps the column; now emits `\r` first) and the frame drifted up one row per redraw (hint line has no trailing `\n`; up-move is now `items.length + 1`).

## 0.1.0

- Published as `@bacnh85/pi-hub` (unscoped `pi-hub` rejected by npm — name too similar to `github`).
- Initial release: interactive catalog browser, `add` with shorthand resolution (curated dir name / scoped npm / owner-repo / passthrough), `find` merging curated catalog + npm `keywords:pi-package` search, `list` from pi settings, `remove`, `update` passthrough.
- Zero runtime dependencies; plain JS ESM; Node ≥ 20.
