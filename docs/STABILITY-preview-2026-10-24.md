# Preview / Find stability (2026-10-24)

## Product floor (Prefer B — default)

| Surface | Behavior |
|---------|----------|
| Source | Native selection + Find overlay (scrollbar-aware) |
| View | Chromium `printToPDF` → **pdf.js** canvas + text layer (`PREVIEW_ENGINE = 'chromium-pdf'`) — View ≡ Export |
| Export | Same `printToPDF` options (`marginType: 'none'`, CSS `@page` sole margins) |
| Find in Preview | Highlights on pdf.js text layer |

## Footer: reserve-and-break (every-page)

1. **Chromium `footerTemplate`** via `displayHeaderFooter` (Export + Prefer B) — not CSS `position:fixed` (fixed paints into the content box and hides body).
2. Custom bottom margin (~20mm) reserves the template band — body **breaks to the next page** instead of meeting the footer.
3. Last-page mode still uses the in-flow DOM footer + CSS `@page` page-# boxes.

## QA order (agent-first)

1. `npm run test:agent` (web journeys + Playwright PDF audit + Electron `printToPDF` audit).
2. Audits assert Source phrases survive (incl. Writing Guidelines closers) + no body/footer Y-overlap + footer band height bound.
3. Human only for visual taste / Find highlight feel / pack.

## Flip engines

- Prefer B: `PREVIEW_ENGINE = 'chromium-pdf'` in `apps/desktop/renderer/src/main.js`
- Fallback continuous HTML: `'document'`
- Do not use `'paginated'` (fold bugs)

## Residual

- First paint waits on debounced `printToPDF`.
- Mid-paragraph breaks are normal for paged media.
- Text-layer vs glyph alignment may need polish on unusual fonts.
- pdf.js must use **legacy** build under Electron 33 (`Uint8Array.prototype.toHex` missing in modern build → status `a.toHex is not a function`).
