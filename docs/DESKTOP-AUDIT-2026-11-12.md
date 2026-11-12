# Desktop app audit (2026-11-12)

Scope: **Markdown2PDF desktop** (`apps/desktop/`) — performance, Source selection/visual fidelity, preview pipeline, session/tabs.  
Context: Prefer B (`printToPDF` + pdf.js), multi-tab, Find/Replace, preview text selection **disabled** (2026-10).

---

## Executive summary

| Area | Severity | Summary |
|------|----------|---------|
| **Source “text under selection doesn’t match”** | **High** | Likely the **Find mirror layer** (`#textarea-md-backdrop`): while Find/Replace is open, the textarea text is **transparent** and the visible glyphs come from a **duplicate HTML layer**. Desync or wrap mismatch = wrong visible text vs selection. |
| **Performance (large docs, multi-tab)** | **High** | Main thread does **full `md.render` + DOMPurify + print DOM sync** on every edit burst; **full tab strip rebuild** every keystroke; **localStorage session write** of all tab bodies; **`printToPDF` + full pdf.js page rebuild** on idle. |
| **Preview UX** | **Medium** | PDF preview is non-selectable by design; Find still highlights via pdf.js/DOM. Tab switch improved but first visit to a tab still pays full PDF cost. |
| **Automated health** | **Low risk** | `npm run test:prefer-b` (Electron PDF + text layer) **passed** on this audit date — export/preview pipeline sane for fixture doc; does not cover editor Find or 10+ page typing. |

---

## Tested by agent (2026-11-12)

| Check | Result |
|-------|--------|
| `npm run test:pdf-audit:electron` | OK (2-page fixture PDF) |
| `npm run test:pdf-audit:textlayer` | OK (span metrics, endOfContent, no title/body hit overlap on fixture) |
| `npm run test:prefer-b` | Both OK |
| Manual Source selection / Find mirror / 10-page typing | **Not run** (requires human) |

---

## Symptom: Source selection vs visible text

### Architecture (current)

```text
  #md-editor-stack (grid, same cell)
    #textarea-md-backdrop (z-0)  ← full file HTML + <mark> when Find active
    #textarea-md (z-1)           ← real value; transparent when Find active
```

When Find or Replace is open **and** scope includes **Editor** or **Both**:

1. `paintEditorFindHighlights()` sets `m2pdf-find-overlay-active` on the textarea.
2. CSS makes textarea **text transparent**; user reads **backdrop** `innerHTML` (`findEditorOverlay.js`).
3. Native **selection** still lives on the textarea.

So any time the mirror diverges from `textarea.value`, selection and visible text disagree.

### Likely triggers (code review)

1. **Find open + tab switch** — `syncEditorFromActiveDoc()` updates `textarea.value` but does **not** call `findReplaceApi.refreshOpenFind()`. Backdrop can still show the **previous tab** until the next `input` event (`findReplace.js` only refreshes backdrop on `input` when Find UI is open).
2. **Wrap / scrollbar metrics** — Backdrop duplicates font/padding but soft-wrap can still differ slightly from `<textarea wrap="soft">` → drift on long lines / after resize.
3. **Find open + normal editing** — User types with transparent text; backdrop refreshes on `input`, but rapid edits / undo / paste may briefly show stale mirror.
4. **Scope “Preview” only** — Editor overlay is cleared; if user still sees mismatch with Find **closed**, report scope (stuck `m2pdf-find-overlay-active` is possible but `clearEditorFindHighlights` on close should remove it).

### Confirmed not the cause (for left pane)

- PDF text layer under preview (pointer-events off, non-selectable) — separate pane.
- `md-preview` HTML preview — hidden behind chromium PDF host in Prefer B mode.

---

## Performance evaluation

### Hot path while typing (active tab)

| Work | Trigger | Cost driver |
|------|---------|-------------|
| `renderMarkdownDebounced` (140 ms) | `textarea` `input` | Synchronous **`md.render` + DOMPurify** on full source (up to 600k chars cap) |
| `syncChromiumPrintDomDebounced` (140 ms) | same | Off-screen `#print-root` DOM rebuild |
| `scheduleChromiumPdfPreview` (1800 ms idle) | after layout | IPC **`desktop:preview-pdf`** → `printToPDF` (serialized in main) |
| `renderTabs()` | every `input` | **`replaceChildren`** rebuild of all tab buttons |
| `persistSessionDebounced` (400 ms) | every `input` | **`localStorage`** write of **all tabs’ full text** |
| pdf.js re-render | window/resize | Decode base64 + render **all pages** + text layers (~180 ms debounced) |

### Hot path on tab switch

| Work | Notes |
|------|--------|
| Cancel debounced preview schedules | Good |
| `updateMarkdownPreviewDom()` | Full markdown parse again |
| `flushChromiumPdfPreview` or cached base64 | Miss = full `printToPDF` + pdf.js build (large docs = seconds) |
| In-memory `previewPdfBase64` per tab | Large RAM for multi-tab long docs |

### Main-process

- Single `printToPdfQueue` — correct (no overlap); preview and export **block each other**.

### Intentional throttles (working as designed)

- No `printToPDF` while `#textarea-md` focused (defer until blur).
- 1800 ms debounce on source-driven PDF refresh.

### Scaling limits (documented in code)

- `MAX_MD_INPUT_CHARS = 600_000` — preview pauses above this (does not reduce editor slowness before pause).

---

## Other quality notes

- **Preview selection**: Disabled 2026-10 (pdf.js absolute text layer unsuitable in Electron 33). Copy from Source; Find highlights preview programmatically.
- **Spell check**: Enabled on Source (`spellcheck="true"`).
- **Legacy audit doc**: `docs/AUDIT-print-preview-2026-10-23.md` — paginated stack retired; Prefer B is current.

---

## Remediation plan

Prioritized for **one human architect** approval per phase. Estimate sizes are for Composer-led implementation + targeted tests, not calendar promises.

### Phase 0 — Reproduce & instrument (0.5–1 day, human + agent)

**Goal:** Confirm which bug bucket users hit.

1. **Human test card**
   - Find **closed**: select paragraphs in Source on 10+ page doc — mismatch?
   - Find **open**, scope Editor: select same — mismatch?
   - Find **open**: switch tab A → B — does backdrop show A’s text?
   - Resize Source pane vertically / show scrollbar — does mirror drift?
2. **Quick agent hook** (optional dev-only): log when `ta.value.length !== backdropInner.textContent.length` while overlay active.
3. Record: Electron version, doc size, Find open Y/N, scope.

**Exit:** Written repro matrix attached to this doc or ticket.

---

### Phase 1 — Fix Source selection fidelity (P0, ~1–2 days)

**Status (2026-11-12):** **Shipped in 0.1.11** — Find rects (no mirror text), tab-switch refresh, `onSourceInput` while Find open. Partial Phase 2: incremental tab dirty label, session debounce 750ms, PDF cache cap 5, pdf.js resize 320ms. Remaining: automated smoke (1.5), skip `md.render` while typing (2.2).

**Goal:** One visible text layer; Find highlights without hiding textarea glyphs.

| # | Action | Rationale |
|---|--------|-----------|
| 1.1 | ~~**Replace backdrop mirror**~~ **Done:** highlight **div rects** behind textarea (`findEditorOverlay.js`); no transparent text. | Eliminates duplicate visible text layer. |
| 1.2 | If Highlight API insufficient for textarea in Electron 33: fallback to **visible textarea** + highlight only match ranges via overlay marks positioned with `getTextareaCaretOffset` (no full-file mirror). | Degraded but consistent. |
| 1.3 | On **tab switch** / **open document**: `findReplaceApi?.refreshOpenFind?.()` or `clearEditorFindHighlights` when Find closed. | Fixes stale-tab backdrop. |
| 1.4 | On **close Find/Replace**: always `clearEditorFindHighlights` (already present — add test). | Prevent stuck overlay. |
| 1.5 | Add **Playwright or electron smoke**: open Find, type query, assert overlay class + no length mismatch; switch tab with Find open. | Regression gate. |

**Not in Phase 1:** Re-enable PDF preview mouse selection.

---

### Phase 2 — Typing & UI performance (P1, ~2–3 days)

**Goal:** Keep machine responsive on long docs while editing.

| # | Action | Impact |
|---|--------|--------|
| 2.1 | **Incremental tab strip** — update active tab label/dirty dot only; don’t `replaceChildren` all tabs on each keystroke. | Cuts DOM churn |
| 2.2 | **Split render pipeline** — debounced **light** pass (optional: skip `md.render` while typing; only sync textarea → session) vs **heavy** pass on idle/blur/tab switch for print DOM + PDF. | Reduces main-thread blocking |
| 2.3 | **Session persist** — persist active doc text eagerly; **other tabs** on debounced/coalesced schedule; avoid rewriting full session JSON on every key. | Smaller localStorage writes |
| 2.4 | **Cap pdf.js resize re-render** — increase debounce / skip if preview hidden / sidebar drag only. | Fewer full page rebuilds |
| 2.5 | **Bound in-memory PDF cache** — LRU by tab count or max MB; drop `previewPdfBase64` on tab close (already dropped from persist). | RAM on multi-tab |

**Measure:** `performance.mark` around `md.render`, `printToPDF` round-trip, `renderTabs` (dev build); target p95 typing gap &lt; 50 ms on ~50k char doc.

---

### Phase 3 — Tab switch & preview responsiveness (P2, ~1–2 days)

| # | Action |
|---|--------|
| 3.1 | Show **cached PDF immediately** (already implemented); add subtle **“preview stale”** badge if `doc.text` changed since cache. |
| 3.2 | **Offload `md.render`** to idle callback / small worker only if Phase 2 still blocks (markdown-it in worker is optional complexity). |
| 3.3 | Consider **low-res preview** fast path (scale down `printToPDF` or render page 1 only) while typing on 20+ page docs — product decision. |

---

### Phase 4 — Hardening & release gate (P3)

| # | Action |
|---|--------|
| 4.1 | Extend `test:agent` with Find/tab-switch smoke (Phase 1). |
| 4.2 | Document “performance expectations” in `apps/desktop/README.md` (large doc, multi-tab, Find open). |
| 4.3 | Human **release checklist**: 10-page doc typing, tab switch, Find Both mode, Export PDF parity. |

---

## Residual risks (after plan)

- **`printToPDF` cost** is fundamental to Prefer B — cannot remove without product change.
- **600k char** docs may remain slow for markdown parse regardless.
- **PDF preview selection** stays off unless Electron/pdf.js upgrade path is revisited (Chromium 148+ behavior).

---

## Recommendation

1. **Approve Phase 0** human repro (30 min) to confirm Find mirror vs plain edit.
2. **Implement Phase 1** immediately if repro implicates Find overlay (most likely from architecture).
3. **Phase 2** in parallel if performance is primary pain even with Find closed.

**Go/No-Go for a desktop build after Phase 1+2:** Human must pass repro matrix + agent `test:prefer-b` + new Find smoke.

---

## References (code)

| Topic | Location |
|-------|----------|
| Find mirror / transparent textarea | `renderer/src/findEditorOverlay.js`, `main.css` `#textarea-md.m2pdf-find-overlay-active` |
| Find refresh on input only | `renderer/src/findReplace.js` (`textarea` `input` listener) |
| Tab switch without Find refresh | `renderer/src/main.js` `syncEditorFromActiveDoc` |
| Preview debounce / defer while typing | `renderer/src/chromiumPdfPreview.js` |
| PDF audits | `apps/desktop/scripts/run-electron-pdf-audit.cjs`, `run-electron-textlayer-audit.cjs` |
