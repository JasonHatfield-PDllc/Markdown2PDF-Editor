# @m2pdf/core

Shared modules extracted from the web MVP (`src/`) for the future desktop app.

**Phase 0 status:** Copied, not yet wired. The web app still imports from `src/` at the repo root. Desktop (Phase 1) will consume this package first.

## Exports

| Module | Source of truth (today) | Purpose |
|--------|-------------------------|---------|
| `markdown.js` | `src/markdown.js` | Renderer + preprocessing |
| `pageGuide.js` | `src/pageGuide.js` | Paper/margin math |
| `mdToolbar.js` | `src/mdToolbar.js` | Toolbar insert helpers |
| `print.css` | `src/main.css` (print sections) | Print layout rules |
| `branding-keys.js` | `src/storage.js` (keys only) | Storage key constants for prefs |

## Sync policy

When changing shared logic, update **both** `src/` (web) and `packages/m2pdf-core/src/` until the web app is rewired to import `@m2pdf/core`. See `docs/PHASE0-HANDOFF.md`.
