# Markdown2PDF Desktop (Windows)

Electron shell for the downloadable Markdown → PDF Editor.

## Features (desktop)

- **Tabs** — multiple Markdown documents in one window
- **File menu** — New, Open, Open Recent, Close, Save, Save As, Export PDF, Exit
- **`.md` association** — double-click opens or focuses a tab (single instance)
- Branding (logos, title, disclaimer) is **global** across tabs

## Dev

From repo root:

```bash
npm ci
npm run dev:desktop
```

Starts Vite on `http://127.0.0.1:5174` and launches Electron.

## Build installer (Windows)

From the **non-OneDrive** checkout (`C:\Cursor-Development\MyStartPage\Markdown2PDF`):

```bash
npm ci
npm run pack:desktop
```

Output: `apps/desktop/release/Markdown2PDF-0.1.0-Setup.exe`

Packaging under OneDrive can fail (missing `app-builder` binaries / sync conflicts). Prefer this path or CI.

App identity: product name **Markdown2PDF**, window/taskbar label from Electron `app.setName` + `appUserModelId`, icon from `apps/desktop/build/icon.png` (Pragmatic Disruptor mark). Packed builds disable DevTools.

## Architecture

| Layer | Path |
|-------|------|
| Main process | `electron/main.cjs` — menu, dialogs, `printToPDF`, OS file open |
| Preload | `electron/preload.cjs` — `window.desktopAPI` |
| Renderer | `renderer/` — Vite + Tailwind, `@m2pdf/core`, session/tabs |

See `docs/PHASE1-HANDOFF.md` for earlier handoff notes.
