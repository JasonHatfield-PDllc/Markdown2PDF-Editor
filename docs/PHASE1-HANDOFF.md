# Phase 1 Handoff — Markdown2PDF Desktop App

**Date:** 2026-07-11  
**Branch:** `cursor/phase-1-desktop-434e`  
**Status:** Phase 1 MVP — Electron shell, Export PDF, native file dialogs, Windows CI build.

---

## 1. What shipped

| Feature | Status |
|---------|--------|
| `apps/desktop/` Electron app | Done |
| Renderer imports `@m2pdf/core` | Done |
| **Export PDF** via `printToPDF()` | Done |
| Native Open / Save / Save As dialogs | Done |
| Windows NSIS installer via `electron-builder` | Done (CI builds on `windows-latest`) |
| Web MVP at repo root | Unchanged |

---

## 2. Architecture

```text
apps/desktop/
├── electron/
│   ├── main.cjs      # IPC, printToPDF, native dialogs
│   └── preload.cjs   # window.desktopAPI bridge
├── renderer/         # Vite UI (forked from web MVP)
│   ├── index.html
│   └── src/
│       ├── main.js   # uses @m2pdf/core + desktopAPI
│       ├── main.css
│       └── storage.js
├── dist/             # built renderer (packaged into .exe)
├── release/          # electron-builder output
└── package.json
```

### IPC API (`window.desktopAPI`)

| Method | Purpose |
|--------|---------|
| `openMarkdown()` | Native open dialog → read `.md` into editor |
| `saveMarkdown({ text, path?, suggestedName? })` | Overwrite or Save As |
| `exportPdf({ paper, suggestedName })` | `printToPDF` → Save PDF dialog |

Paper size for export follows the **Page guides** dropdown (`letter` / `a4` / `legal`).

---

## 3. Local commands

```bash
npm ci
npm run dev:desktop      # Vite + Electron hot reload
npm run build:desktop    # Renderer only
npm run pack:desktop     # Windows .exe (run on Windows for native build)
```

---

## 4. CI — Windows installer artifact

Workflow: `.github/workflows/desktop-windows.yml`

- Runs on `windows-latest`
- Triggers: `workflow_dispatch`, or push to `main` when `apps/desktop/**` changes
- Artifact: `markdown2pdf-desktop-windows` (`.exe` in `apps/desktop/release/`)

**Monday laptop task:** Download artifact, install, smoke-test Export PDF.

---

## 5. Decisions

### P1-D-001: Separate renderer fork (not shared web bundle)

Desktop has `apps/desktop/renderer/` adapted from web `src/`. Web stays untouched.

**Future:** Extract shared UI module or rewire both to a single `packages/ui` when maintenance cost warrants it.

### P1-D-002: `printToPDF` replaces print dialog on desktop

Web keeps `window.print()`. Desktop primary action is **Export PDF**.

### P1-D-003: File path instead of File System Access API handles

Desktop tracks `mdFilePath` string for Save overwrite; native dialogs via Electron `dialog` + `fs`.

### P1-D-004: Margins locked to CSS `@page` assumptions

Export uses the same mm→inch margins as `packages/m2pdf-core/src/print.css`.

---

## 6. Known limitations (Phase 1)

1. **No code signing** — Windows SmartScreen may warn on first install.
2. **Footer-on-every-page** — still deferred (Backlog.md).
3. **Desktop Playwright e2e** — not yet added; laptop manual QA first.
4. **Linux/macOS builds** — not configured; Windows-only for now.
5. **Joy Factor alignment** — pending laptop repo access.

---

## 7. Monday checklist

- [ ] Merge Phase 0 PR (#1) if not already merged
- [ ] Merge Phase 1 PR when green
- [ ] Download `markdown2pdf-desktop-windows` artifact from Actions
- [ ] Install `.exe`, open sample `.md`, Export PDF
- [ ] Compare PDF to web print output
- [ ] Share Joy Factor repo for CI/packaging alignment

---

## 8. Phase 2 preview

- Footer on every printed/exported page
- Desktop Playwright journeys (`e2e/desktop/`)
- Auto-update (electron-updater)
- Optional code signing
- `.md` file association
