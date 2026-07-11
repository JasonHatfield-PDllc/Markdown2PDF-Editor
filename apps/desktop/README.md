# Markdown2PDF Desktop (Windows)

Electron shell for the downloadable Markdown → PDF Editor.

## Dev

From repo root:

```bash
npm ci
npm run dev:desktop
```

Starts Vite on `http://127.0.0.1:5174` and launches Electron.

## Build installer (Windows)

```bash
npm run pack:desktop
```

Output: `apps/desktop/release/Markdown2PDF Editor-0.1.0-Setup.exe`

## Architecture

| Layer | Path |
|-------|------|
| Main process | `electron/main.cjs` — native dialogs, `printToPDF` |
| Preload | `electron/preload.cjs` — `window.desktopAPI` |
| Renderer | `renderer/` — Vite + Tailwind, imports `@m2pdf/core` |

See `docs/PHASE1-HANDOFF.md` for full handoff notes.
