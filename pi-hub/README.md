# pi-hub

Interactive installer for [Pi coding agent](https://github.com/earendil-works/pi) packages — browse, search, and install pi extensions without typing `pi install ...`.

Inspired by [vercel-labs/skills](https://github.com/skills): one command, interactive multi-select, sensible defaults.

## Usage

```bash
npx @bacnh85/pi-hub                      # browse @bacnh85 catalog, multi-select, install
npx @bacnh85/pi-hub add pi-plan          # install a curated package by shorthand
npx @bacnh85/pi-hub add owner/repo       # install from a git repo
npx @bacnh85/pi-hub find memory          # search curated catalog + npm keywords:pi-package
npx @bacnh85/pi-hub list                 # show installed packages
npx @bacnh85/pi-hub remove pi-plan       # uninstall
npx @bacnh85/pi-hub update               # pi update --extensions
```

### Shorthand resolution (`add`)

| Input | Resolves to |
|---|---|
| `pi-plan` | `npm:@bacnh85/pi-plan` (curated catalog lookup) |
| `@scope/pkg` | `npm:@scope/pkg` |
| `owner/repo` | `git:github.com/owner/repo` |
| `npm:…`, `git:…`, `https://…` | passthrough to `pi install` |

### Flags

| Flag | Description |
|---|---|
| `-l, --local` | project-local install (`.pi/settings.json`) instead of user scope |
| `-y, --yes` | skip confirmation |
| `--json` | machine-readable output (`find`) |

## How it works

pi-hub is a thin discovery + selection layer **on top of the `pi` CLI** — `pi install` / `pi remove` do the actual package management. Sources:

- **Curated catalog** — the `@bacnh85` monorepo packages, bundled as `catalog.json`.
- **General discovery** — npm registry search for `keywords:pi-package`, Pi's official package convention. Falls back to catalog-only when offline.

`@bacnh85/pi-hub` itself is not a pi package (nothing registers into the agent); it's a standalone zero-dependency CLI.

## Requirements

- Node ≥ 20
- `pi` on PATH ([install](https://github.com/earendil-works/pi))

## License

MIT
