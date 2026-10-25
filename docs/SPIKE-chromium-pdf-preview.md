# Spike: Chromium PDF live preview (Option B elevated)

**Date:** 2026-10-24  
**Flag:** `PREVIEW_ENGINE` in `apps/desktop/renderer/src/main.js`  
**Default (2026-10-24 stability):** `'document'` — Chromium PDF View paused until Source find + footer clearance are solid.  
Set `'chromium-pdf'` to re-enable Option B spike.

## Goal

Right View panel shows the **same** layout Chromium will write on Export PDF — no dual JS page-stack.

## How it works

1. Source → markdown-it → `#print-flow` (header / body / footer) as before.
2. After debounce (~550ms), main process runs `webContents.printToPDF` with **identical** options to Export (`printToPdfOptions` in `electron/main.cjs`).
3. Renderer displays the PDF bytes in `#chromium-pdf-frame` (blob URL).
4. On screen, `#print-root` is parked off-canvas; `@media print` / `printToPDF` restore it and hide the PDF host.

## Files

| File | Role |
|------|------|
| `electron/main.cjs` | `desktop:preview-pdf` + shared `printToPdfOptions` |
| `electron/preload.cjs` | `previewPdf` |
| `renderer/src/chromiumPdfPreview.js` | Debounce, cancel token, blob iframe |
| `renderer/src/main.js` | Flag + `refreshPrintPreviewLayout` branch |
| `renderer/src/main.css` | Host / offscreen print DOM |

## Human test plan

1. `npm run pack:desktop` (or `npm run pack:dir`) from `Markdown2PDF/`.
2. Open doctoral / long doc; wait for “Updating print preview…” to clear.
3. Confirm View pages match Export PDF (breaks, footer, page #, logos).
4. Edit Source mid-document; confirm View updates after short pause (no surprise on Export).
5. Toggle Paper (Letter / A4) and Footer every/last; confirm both View and Export track.
6. Empty Source → idle message; huge Source → pause message.

## Residual risk

- First paint after open waits for one `printToPDF` (CPU cost).
- Find-in-Preview searches `#md-preview` (source HTML) and reports count in the View status bar; it does **not** yellow-highlight inside the PDF iframe yet.
- PDF glyph selection (jagged per-letter highlight) is Chromium PDF viewer behavior — not HTML selection.
- Custom `#print-pages-stack` code remains behind the flag for rollback (`USE_CHROMIUM_PDF_PREVIEW = false`).

## Fix pass 2026-10-24 (print DOM bugs visible in View = Export)

- Removed footer `border-t` (print + screen).
- Page # only via `@page` margin boxes (killed `0 of 0` + `Page 1 of 1` stack).
- Electron `printToPDF` uses CSS `@page` margins only (no double custom margins).
- Every-page bottom margin 40mm → 28mm; footer `max-height: 26mm`.

## Rollback

Set `USE_CHROMIUM_PDF_PREVIEW = false` and rebuild.
