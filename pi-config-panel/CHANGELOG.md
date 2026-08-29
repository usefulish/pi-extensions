# Changelog

## 0.1.2 (2026-08-29)

### Fixed

- Inline suggestion list never rendered in the live TUI: `renderRow` returned
  the editing row as one joined string and `truncateToWidth` collapsed the
  ANSI-styled multi-line blob to its first line, so the popup was invisible
  and Tab always picked the first (alphabetical) item. `renderRow` now returns
  an array of lines — suggestions render as their own rows, `↑/↓` navigate,
  Tab picks the highlighted one. Regression test renders with a styled theme
  and asserts the suggestion row survives truncation.

## 0.1.1 (2026-08-29)

### Added

- Panel rows accept optional `completions` (inline suggestion list while
  editing): `filterSuggestions` filters by the segment after the last comma,
  `joinCompletion` implements segment replacement, `Tab` picks the highlighted
  suggestion and `Enter` always submits the typed text (custom values never
  get trapped).

## 0.1.0

- Initial release — kernel extracted from pi-a2a's `/a2a-config` panel (design unchanged since a2a 0.3.0).
- Exports: `openConfigPanel`, `ConfigPanelModel`, `makeOnAction`, `row`, `toInt`, `applyRows`, `kindValue`, row-model types.
- `BuildRows<T>` generic row builder replaces pi-a2a's hardcoded `buildRows`; `title` option replaces the hardcoded "A2A Configuration" header.
- Kernel tests ported from pi-a2a against a generic fixture config.

<!-- published 2026-08-22 -->
