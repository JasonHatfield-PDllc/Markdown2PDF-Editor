# Desktop changelog

## 0.1.12 (2026-11-12)

- **Find (Option A):** Stable Source search with **active-match-only** highlight; no paint while typing in Find; **Find / Enter** then F3; status `Match n of m`; on-screen hint in Prefer B mode.
- **Find UX:** Orange mark shows **through** transparent Source (white stack bg); editing with Find open no longer jumps to another match or scrolls the page.
- **Find geometry:** Caret mirror puts only the **next character** in the measure span (not the whole rest of the file) so highlights sit on the real match (`highlightAligned` audit).
- **Find scroll:** `scrollTextareaToOffset` uses in-stack probe (soft-wrap aware) so F3 / next match scrolls into the Source viewport.
- **Product:** Keeps **Prefer B** (printToPDF preview ≡ export). Path to “leader” = accurate PDF + fast editing; all-match yellow deferred (`SOURCE_FIND_PAINT_MODE = 'all'` when ready).
- **Docs:** `docs/DESKTOP-EVALUATION-2026-11-12.md`, `docs/DESKTOP-UAT-0.1.12.md`.

## 0.1.11 (2026-11-12)

- **Find (Source):** Yellow highlights are positioned rects only; textarea stays visible and selectable (no mirror text).
- **Find:** Source-only search in Prefer B desktop (preview pane scope hidden); **Find** button restored; highlight refresh no longer jumps selection (fixes Ctrl+A / click to clear).
- **Find:** Yellow/orange rects drawn **above** Source (backdrop `z-index: 2`) so highlights are visible with opaque textarea.
- **Find:** Highlight positions use textarea content-width caret math (fix wrap mismatch vs Author/other lines on long `.md`).
- **Find:** Live highlight while typing is debounced and capped (no freeze on 1-char queries in large docs); **Find** still paints up to 200 matches.
- **Find:** Highlights refresh on tab switch and while typing with Find open (no longer cleared each keystroke).
- **QA:** `npm run test:desktop:find-typing` — Electron audit (~110k chars, type in Find bar, renderer must stay responsive).
- **Performance:** Tab strip dirty dot updates without full rebuild on each key; session save debounce 750ms; cap PDF preview cache (5 tabs); slower pdf.js resize re-render.

## 0.1.10

Prior release (tab-switch preview, spell check, preview selection off, etc.).
