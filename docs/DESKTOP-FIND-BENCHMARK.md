# Find in Source — benchmark vs best-in-class (2026-11-12)

## What “good” looks like

| Product | Model | Why it works |
|---------|--------|--------------|
| **VS Code / Monaco** | Code editor with **document offsets → view coordinates** | One layout engine; search decorations are first-class. |
| **Notepad / Notepad++** | Native Scintilla or Win32 edit control | OS draws selection; find dialog does not duplicate text. |
| **Word / Google Docs** | Rich-text model + internal highlight layers | Single truth for text layout. |
| **Browser Ctrl+F** | `findInPage` on rendered layout | Chromium owns text positions (not app mirrors). |

## What we tried (and why it failed)

| Approach | Problem |
|----------|---------|
| **HTML mirror + transparent textarea** (`817223b`) | Two visible text layers; wrap/scrollbar drift. |
| **Absolute div rects + body-mounted mirror** (0.1.11–0.1.12) | Measure outside the overlay stack; padding/grid/`clientWidth` ≠ wrap width → boxes in **gutter / blank** (your screenshot). |
| **Live paint on every keystroke in Find** | O(n×matches) DOM measure; freezes on large docs. |

**Conclusion:** A plain `<textarea>` is the wrong place for a **second layout pass** unless measurement runs in the **same box** as the highlights (or we use a real editor component).

## Target for Markdown2PDF (Option A+)

1. **Truth:** `indexOf` / selection on `textarea.value` (unchanged — this part already works: `Match n of m`).
2. **Feedback (primary):** **Native selection** in Source after Find / F3 — focus stays in the editor briefly (Notepad-style).
3. **Feedback (secondary):** Optional orange rect measured **inside** `#textarea-md-backdrop-inner` (same coordinate system as rects).
4. **Later (leader tier):** CodeMirror 6 or Monaco for Source — built-in search, multi-match decorators, no mirrors.

## Regression gate

- `npm run test:desktop:find-highlights` — selection + `highlightAligned` (in-inner geometry).
- Human: APA doc, `this` → Find → selection on word OR orange on word (not gutter).

## References

- `renderer/src/findEditorOverlay.js` — in-inner probe
- `renderer/src/findReplace.js` — `SOURCE_FIND_PAINT_MODE`, selection-first
- `docs/DESKTOP-EVALUATION-2026-11-12.md` — product decision Option A
