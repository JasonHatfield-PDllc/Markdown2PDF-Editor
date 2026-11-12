# Markdown2PDF desktop — full evaluation (2026-11-12)

**Audience:** Human architect deciding revert vs rebuild vs stabilize.  
**Version on disk:** `markdown2pdf-desktop@0.1.12` (Find Stabilize / **Option A**).  
**Your anchor:** “Since ~0.1.5 the app feels worse; Find is broken.”

## Decision (approved)

**Option A — Stabilize Find** while keeping **Prefer B** (view ≡ export). No wholesale revert.  
Product goal unchanged: **leader-class Markdown → print-accurate PDF** on Windows; Source Find is **reliable first**, fancy all-match highlights later if needed (`SOURCE_FIND_PAINT_MODE` in `findReplace.js`).

---

## Executive summary

| Verdict | Detail |
|--------|--------|
| **Root cause (Find)** | We left **reliable Notepad-style Find** (native selection only) and added **custom highlight layers** to compensate for “selection invisible while Find bar has focus.” That stack (full-text mirror → positioned rects → caps/debounce) is **fragile** and **expensive** on long docs. |
| **Root cause (whole app feel)** | **Prefer B** (`printToPDF` + pdf.js) trades fidelity for accuracy vs export; it adds **multi-second** preview work, tab/cache complexity, and disabled preview text selection. Performance patches helped but did not simplify the pipeline. |
| **Automated tests** | `npm run test:prefer-b` **passes** (PDF, text layer, Find highlight fixture, Find typing on ~112k chars). Fixtures are **narrow** — they do **not** prove APA-scale UX or “yellow on every match.” |
| **Git reality** | Committed `main` at `817223b` already had the **mirror overlay**. Your “good” Find likely matches **`85b4e0f`** (Find added) **before** overlay work — or a build **without** the uncommitted 0.1.11 churn. |
| **Recommendation** | **Do not revert Prefer B wholesale.** **Do** ship **Find Stabilize** (active-match-only or off overlays + match counter + no paint while typing). If still unhappy after one pack: **tag + optional installer from `85b4e0f` Find logic** on current preview. **Nuclear** (CodeMirror / new editor) only if stabilize fails human UAT. |

```text
[HUMAN — MODEL SWITCH]
Reason: Revert vs editor replacement vs Prefer B tradeoffs need one architecture pass.
Switch to: Opus 5.5
Resume with: “Pick Option A/B/C from DESKTOP-EVALUATION-2026-11-12.md and implement.”
```

---

## Timeline (what changed when)

| Era | Git / version | Source Find | Preview | Pain reported |
|-----|----------------|-------------|---------|----------------|
| **Phase 1 desktop** | `9974603` | None | HTML `md-preview` | — |
| **Find shipped** | `85b4e0f` (~0.1.4) | **Selection + line scroll only** — no yellow layer | HTML preview | Low; Find “just works” |
| **Prefer B + overlay** | `817223b` (on `main`) | **Transparent textarea + HTML mirror** + marks | `printToPDF` → pdf.js | Wrong visible text vs selection; jumbled marks |
| **Local 0.1.11 (uncommitted)** | Working tree | **Absolute rects** + z-index + caps + debounce | Tab cache, perf debounces | Freezes, wrong boxes, “search broken” |

**0.1.5** does not appear as a git tag in `apps/desktop`; it may have been a **local version bump** between `0.1.4` and Prefer B ship. Functionally, **“since 0.1.5” ≈ since Prefer B + Find overlay + performance layering.**

---

## Find — architecture autopsy

### What worked (85b4e0f)

- `indexOf` / `lastIndexOf` on `textarea.value`
- `setSelectionRange` + coarse `scrollTop` from line index
- No backdrop, no DOM measurement loop
- **Gap:** When focus is in the Find bar, **native selection may be hard to see** in Chromium — motivation for overlay (but overlay caused worse bugs)

### What shipped on `main` (817223b)

```text
textarea (transparent text) + backdrop innerHTML = full file with <mark>
```

Any wrap/scrollbar/tab drift → **visible text ≠ selection** (documented in `DESKTOP-AUDIT-2026-11-12.md`).

### What uncommitted 0.1.11 tried

- Opaque textarea + **yellow div rects** from `getTextareaCaretOffset` / measure mirror
- Paint **all** matches (then cap 200, debounce, min 2 chars for live paint)
- **Failure modes:** misaligned rects; full-doc paint **freezes** UI; live refresh **fights** user typing; audits still allow **1 rect** while user expects **all** matches

### Why “search feels broken” (likely combined)

1. **No visible feedback** — focus on Find bar + failed/misplaced highlights + hidden selection.
2. **Find doesn’t run** until Enter/Find — typing alone may clear or show wrong highlights.
3. **`resolveEditorActiveMatchStart`** when user hasn’t run Find — caret/index logic picks unexpected match.
4. **Preview Find** disabled in Prefer B (`sourceFindOnly`) — users may expect dual-pane search.

---

## Non-Find regressions (experience)

| Area | Issue | Severity |
|------|--------|----------|
| Preview latency | `printToPDF` per tab / on idle — seconds on long docs | High |
| Typing | `md.render` + print DOM sync still on debounced input | Medium |
| Preview selection | Off by design (pdf.js) | Medium UX |
| Multi-tab + session | Large `localStorage` writes (debounced to 750ms in local work) | Medium |
| Complexity | Many interacting debouncers caches tokens | Medium (debug cost) |

Prefer B is **correct for WYSIWYG export**; it is **inherently heavier** than HTML preview.

---

## Automated test coverage vs user reality

| Script | Proves | Does **not** prove |
|--------|--------|---------------------|
| `test:pdf-audit:electron` | 2-page export | Your APA templates |
| `test:pdf-audit:textlayer` | pdf.js spans on fixture | Find in preview |
| `test:desktop:find-highlights` | ≥1 rect, selection on `this`, not Author | All matches aligned; visual yellow |
| `test:desktop:find-typing` | No hang typing `this` in ~112k doc | Single-char query; real paste from clipboard |
| `test:e2e` | Web journeys | Desktop EXE |

**Gap:** No test for “Ctrl+F → paste → Find → F3 × 20 on 10-page APA file” with screenshot or selection text assertion.

---

## Options (decision matrix)

### Option A — **Stabilize Find (recommended next step)**

| | |
|-|-|
| **What** | Notepad Find core stays. **Highlight mode = `active-only`** (one orange box on current match) or **`off`**. **No paint on Find-bar input.** Status: `Match 3 of 128`. |
| **Pros** | Small diff, keeps Prefer B, fixes freeze/wrong-all-match paint, testable. |
| **Cons** | No “Word-style” yellow on every occurrence until a v2 highlighter. |
| **Effort** | ~0.5–1 day |

### Option B — **Revert Find to `85b4e0f` logic on current `main.js`**

| | |
|-|-|
| **What** | Delete overlay paint paths; simple `selectRange` + scroll; optional status line only. |
| **Pros** | Proven behavior. |
| **Cons** | May look “broken” if selection invisible when Find bar focused; still no all-match yellow. |
| **Effort** | ~0.5 day |

### Option C — **Revert whole desktop tree to `817223b` (committed)**

| | |
|-|-|
| **What** | `git restore` uncommitted work in `apps/desktop`. |
| **Pros** | Known committed baseline. |
| **Cons** | **Brings back mirror overlay** — **worse** for selection fidelity than 0.1.11 rects; loses perf/tab fixes in local work. |
| **Effort** | Minutes |

**Not recommended** unless you also revert Find overlay files to 85b4e0f-style.

### Option D — **Replace Source editor (nuclear)**

| | |
|-|-|
| **What** | CodeMirror 6 / Monaco with built-in search, or Electron `findInPage` (limited). |
| **Pros** | Industry-standard Find. |
| **Cons** | Large refactor; markdown toolbar, spellcheck, session wiring; 1–2+ weeks. |
| **Effort** | High |

### Option E — **Revert preview to HTML stack (product change)**

| | |
|-|-|
| **What** | `PREVIEW_ENGINE !== 'chromium-pdf'` paths exist but quarantined. |
| **Pros** | Faster preview, preview Find/selection easier. |
| **Cons** | Preview ≠ export; contradicts Prefer B goal. |

---

## Recommended path (ordered)

1. **Implement Option A** in the working tree; **commit** a coherent `0.1.12` (Find stabilize + audits).
2. **Human UAT** — `DESKTOP-UAT-0.1.11.md` H1–H5 updated for active-only expectation.
3. If fail → **Option B** same week.
4. If still fail → **Opus pass** on Option D scope (CodeMirror minimal integration).
5. **Do not** Option C alone — mirror overlay is a known bad state.

---

## Agent verification (this session)

| Check | Result |
|-------|--------|
| Git: uncommitted desktop delta | ~756 insertions vs `817223b` (Find, main, preview, audits) |
| Git: original Find | `85b4e0f` — no overlay |
| Git: committed Find overlay | `817223b` — mirror HTML |
| `npm run test:prefer-b` | Run at start of freeze-fix session — **pass** (may re-run after Option A) |

---

## References

- `docs/DESKTOP-AUDIT-2026-11-12.md` — mirror autopsy + perf phases
- `docs/DESKTOP-UAT-0.1.11.md` — human checklist
- `apps/desktop/CHANGELOG.md` — 0.1.11 notes
- Original Find: `git show 85b4e0f:./renderer/src/findReplace.js`
- Prefer B + mirror: `git show 817223b:./renderer/src/findEditorOverlay.js`
