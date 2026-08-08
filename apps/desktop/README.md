# Markdown2PDF Desktop (Windows)

Electron shell for the downloadable Markdown → PDF Editor.

## Features (desktop)

- **Tabs** — multiple Markdown documents in one window
- **File menu** — New, Open, Open Recent, Close, Save, Save As, Export PDF, Exit
- **`.md` association** — double-click opens or focuses a tab (single instance)
- **Find / Replace** — Edit menu (Ctrl+F / F3 / Shift+F3 / Ctrl+H); Markdown editor only
- **Right-click** — Cut / Copy / Paste / Select All in text fields (also Copy on selected preview text)
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

Output: `apps/desktop/release/Markdown2PDF-0.1.4-Setup.exe`

Packaging under OneDrive can fail (missing `app-builder` binaries / sync conflicts). Prefer this path or CI.

App identity: product name **Markdown2PDF**, window/taskbar label from Electron `app.setName` + `appUserModelId`.

- Window title-bar icon: `electron/assets/icon.ico` (must ship in the asar).
- Taskbar / Explorer `.exe` icon: `build/icon.ico` embedded into `Markdown2PDF.exe` by `scripts/afterPack.cjs` (rcedit). Same hook stamps VersionInfo (Company, Product, versions) so Windows Properties does not show Electron/GitHub. `signAndEditExecutable` stays `false` to avoid winCodeSign symlink failures on Windows without Developer Mode. Authenticode signing is still separate (see Azure Artifact Signing when you budget ~$120/yr for the LLC).
- Installer license page: `build/license.txt` (NSIS) points to the site [Terms of Use](https://www.pragmaticdisruptor.com/terms-of-use) and Privacy Notice. Help menu opens the same Terms URL.

Packed builds disable DevTools. The desktop package is proprietary (`license: UNLICENSED`); Electron/Chromium notices still ship with the app.

## Architecture

| Layer | Path |
|-------|------|
| Main process | `electron/main.cjs` — menu, dialogs, `printToPDF`, OS file open |
| Preload | `electron/preload.cjs` — `window.desktopAPI` |
| Renderer | `renderer/` — Vite + Tailwind, `@m2pdf/core`, session/tabs |

See `docs/PHASE1-HANDOFF.md` for earlier handoff notes.
