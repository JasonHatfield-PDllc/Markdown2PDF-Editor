# @m2pdf/core

Shared modules extracted from the web MVP (`src/`) for the future desktop app.

**Status:** Desktop imports `@m2pdf/core`. Web still dual-updates `src/` for markdown/toolbar; branding keys and page math stay synced with this package. Prefer B PDF export is desktop-only — see `docs/WEB-vs-DESKTOP-PRINT.md`.

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
