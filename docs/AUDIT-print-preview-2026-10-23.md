# Print preview audit (2026-10-23)

Status: **B elevated — spike in progress (2026-10-24)** — `USE_CHROMIUM_PDF_PREVIEW` in desktop renderer; IPC `desktop:preview-pdf` shares `printToPDF` options with Export.

## Elevated product bar (2026-10-24)

**Must:** Right Preview = true representation of print/PDF output. User must not need Export PDF to discover layout failures. Target experience is **Word-class WYSIWYG print layout** (pages, margins, header/footer/logo/page #), not Notepad + surprise PDF.

**Implication:** Screen and export must share **one layout engine** (Chromium print). Custom JS page-stack (option C) cannot meet this bar long-term.

**Chosen direction (recommended):** **B elevated** — live preview powered by the same `printToPDF` pipeline as Export (debounced, cancelable, page strip in View). Delete dual `#print-pages-stack` pagination once B ships.

## Original product goal (arc)

| Goal | Source |
|------|--------|
| Right pane = **live print-oriented preview** (header, footer, logo, page #, margins) | User / desktop 0.1.x |
| Source edits → preview updates (debounced) | User |
| **Export PDF** via Electron / Chromium (`#print-flow`, `@page`, `printToPDF`) | Existing app |
| Page guide: **approximate** bands, not guaranteed PDF match | `Backlog.md` |

**Explicit backlog warning:** “True paginated preview (e.g. Paged.js–class), pixel-perfect break prediction” was **out of scope** for page-guide MVP and labeled **much larger** effort.

We later pursued **full paginated screen preview** (`#print-pages-stack` + custom break logic). That is a **scope step-up** from the backlog, not a small extension of page guides.

---

## What we have today (two engines)

```text
                    ┌─────────────────────────────────────┐
  Source (md) ─────►│ markdown-it + DOMPurify             │
                    └──────────────┬──────────────────────┘
                                   │
           ┌───────────────────────┴───────────────────────┐
           ▼                                               ▼
  SCREEN: #print-pages-stack                    PDF: #print-flow (hidden)
  • Custom pagination (previewPagination.js)    • Continuous document
  • Measure probe + clip + word split           • @page margins, fixed footer mode
  • Per-page header/footer clones               • Chromium breaks pages on print
  • Source inventory (core) — mostly advisory   │
           │                                               │
           ▼                                               ▼
  User sees stacked “pages”                     Export PDF
```

**Core problem:** Screen and PDF **do not share one layout engine**. Any fix in JS pagination can improve the stack but still diverge from `printToPDF` (and diverge from itself when probes ≠ painted DOM).

---

## Churn symptoms (why it feels unstable)

1. **Layered heuristics** — fold guard px, min split words, widow headings, mount heal (added/removed), source plan vs DOM plan, prefix-aware split, etc. Each fix targeted one doc; regressions moved to another page.
2. **Dual measurement** — hidden probe (`.m2pdf-print-canvas` + `.m2pdf-page-prose`) vs real flex frame (header + body + footer). Small CSS/class drift → wrong breaks.
3. **Block model mismatch** — pagination splits **DOM blocks** (and sometimes words); PDF breaks **lines** inside blocks. Lists need `start` on `<ol>`; paragraphs need line-level breaks — easy to get wrong once, hard to maintain.
4. **Chrome math** — footer band, border-t, logo scale, every-page vs last-page modes must match between slot height and painted footer. Footer line removal helps but two code paths remain.
5. **Dead / partial paths** — `buildPrintPreviewContext` + source inventory still run on every refresh; stack layout no longer uses source plan for assignment (good), but cost and mental overhead remain.
6. **Performance** — full repagination + probe + multiple reflow passes on every `renderMarkdown()`; init batching helped but work is still O(pages × blocks × passes).

---

## What actually works reliably

- **Markdown → HTML** in `#print-flow` for export.
- **Branding** (header, footer block, logos, disclaimer, page # in footer or margin box).
- **Paper / margin constants** in `@m2pdf/core` (`pageGuide.js`, `printPageGeometry.js`).
- **Find in preview** targeting `#print-pages-stack` when present.
- **Desktop shell** (tabs, session, debounced source).

---

## Options (pick one direction)

### A — **Backlog-faithful “guides + scroll”** (smallest, most stable)

- **Screen:** Single continuous preview (`#print-flow` visible), optional horizontal **guide bands** only (no fake pages).
- **PDF:** Unchanged (`printToPDF` on `#print-flow`).
- **Copy:** “Guides are approximate; use Export PDF for final layout.”

| Pros | Cons |
|------|------|
| Matches written backlog and support story | Not WYSIWYG paginated sheets |
| One DOM, one break truth at export | User must export to see real pages |
| ~days to stabilize, low test surface | |

**Best if:** Willing to trade stacked pages for stability and honest UX.

---

### B — **Chromium as single source of truth** (preview = export)

- Build one print-ready HTML (same as today’s `#print-flow`).
- On debounce: run **`printToPDF`** (or print preview) to **page images** or a cached PDF; display pages in the View (images or embedded viewer).
- Optional: throttle (e.g. 500ms–1s after typing stops) + cancel in-flight job.

| Pros | Cons |
|------|------|
| Preview breaks **match** export | Heavier CPU; needs async UX (spinner) |
| Delete most of `previewPagination.js` | Harder to “inspect” live HTML per page |
| One engine | |

**Best if:** “What I export is what I must see” is non-negotiable.

---

### C — **Keep custom stack, but harden** (current direction, done properly)

- **Freeze** heuristics; one module owns: geometry → blocks → pages → render.
- **Delete** unused source-plan assignment; keep inventory optional for stats only.
- **Tests:** fixture MD → page count + golden “no overflow” (JSDOM or Playwright) for 3–5 docs including doctoral snippet.
- **Contract doc:** “Screen stack ≈ export; known gaps: …”
- **No** mount-heal word-chop loops without tests.

| Pros | Cons |
|------|------|
| Keeps stacked-page UX | Still may never match PDF 100% |
| Incremental from today | Ongoing maintenance on edge cases |

**Best if:** Stacked preview is required and small drift from PDF is acceptable with clear disclaimer.

---

### D — **Paged.js (or similar) for screen only**

- Tried once; rejected (empty pane). Could retry in a **branch** with minimal integration and fallback to A if fail.

| Pros | Cons |
|------|------|
| Mature pagination model | Third dependency; screen ≠ print unless also used for print |
| Less custom slice code | Previous failure mode |

**Best if:** Willing to spike on a branch with time-box (e.g. 1–2 days) and revert flag.

---

## Recommendation (lead agent)

1. **Stop** one-off pagination tweaks until **A, B, or C** is chosen in writing.
2. **Short term (stabilize 0.1.10):** Prefer **A** or **B** over more **C** heuristics — backlog already warned against exact paginated preview without large effort.
3. If stacked sheets stay: choose **C** with **tests + delete dual plan path + single reflow pass** — not more constants.
4. If export fidelity is the real goal: **B** is the only path that avoids maintaining two engines.

---

## Model / process (your offer)

| Task | Suggested model |
|------|------------------|
| This audit, doc, small wiring | **Composer 2.5** (done) |
| Architecture decision + test plan + spike branch | **Opus 5.5** one session |
| Large integration (B or D) | **Opus 5.5** or fresh chat + pinned model |
| CI / Playwright fixtures | **Composer 2.5** |

**No need to switch models** for reading this doc and picking A/B/C/D. Switch when implementing the chosen option’s spike.

---

## Suggested next step (human)

Reply with one letter: **A**, **B**, or **C** (or **D** = time-boxed spike).

Then we implement **only** that path behind a feature flag if needed, with a short test list — no further fold-guard tuning in the old stack unless **C** is chosen and covered by tests.
