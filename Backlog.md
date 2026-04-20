# Markdown2PDF — Backlog

Product folder: `Markdown2PDF/` (Vite + Tailwind + vanilla JS). Items below are **not committed for implementation** unless explicitly picked up later.

---

## Page guide (preview) — scoped, deferred

**Intent:** Help authors see **approximate** page-length bands in the **right-hand preview** before Print / Save as PDF, without turning the Markdown editor into WYSIWYG.

**Concept (combo of “guide overlay” + “paper-aware spacing”):**

1. **Toggle:** “Page guide” **Off / On** — affects **screen preview only** (not the raw `.md` file and not print output by itself).
2. **When On:** **Dropdown** for **page type** (e.g. Letter, A4, Legal — start with 2–3 sizes that match the audience).
3. **Margins:** **Traditional default margins per paper size** (single internal table: paper → dimensions → top/right/bottom/left). Same numbers used for docs and support.

**Implementation sketch (no code here):**

- Compute **usable page height** ≈ sheet height − top margin − bottom margin (v1 can ignore preview-only chrome).
- Render **horizontal bands or repeating rules** in the preview pane at that pitch so users see rough “page” boundaries vertically.
- Persist toggle + selection in `localStorage` (aligned with other branding prefs).

---

### Accuracy expectations (do not over-promise)

- **Exact** alignment with Edge’s PDF page breaks for arbitrary Markdown is **not** guaranteed. Pagination depends on font metrics, zoom, print DPI, dialog settings (margins, headers/footers), and “fit to page” scaling.
- **Reasonable goal:** Guide **spacing** matches the app’s **documented** paper + margin assumptions — often **close** to print if the user prints with **matching** paper, margins, and default scaling.
- **Positioning:** Say guides are **approximate**; **Print preview** is authoritative for final breaks.

Avoid marketing language like “95% match to PDF.” Prefer: “Aligned to **assumed** page geometry in this app.”

---

### Effort (order of magnitude)

| Track | Scope | Rough effort |
|--------|--------|----------------|
| **MVP** | Toggle, 2–3 paper sizes, fixed margin presets, CSS-based repeating guides under/behind `#print-root` content, screen only, persisted prefs | ~0.5–1.5 dev days (incl. polish + Edge smoke test) |
| **Plus** | More sizes, optional custom margin presets, gutter | +0.5–1 day |
| **Out of scope for this backlog item** | True paginated preview (e.g. Paged.js–class), pixel-perfect break prediction | Much larger |

---

### Risks

| Risk | Mitigation |
|------|------------|
| Print dialog uses different paper / margins / scale | UI copy: guides follow **app** settings; align print dialog for best match. |
| Preview column width ≠ paper width | Guides show **vertical** paging bands only; state that clearly. |
| Long unbreakable blocks (tables, `pre`, large images) | Real breaks differ; guides still help placement but won’t match exactly. |
| False confidence | Clear disclaimer; support script (below). |
| Spec drift | Single versioned table: paper → size → margins. |

---

### Support — likely questions

1. **“Guides don’t match my PDF.”** — Print settings differ; match paper and margins; use Print preview for truth.
2. **“I need Legal / custom.”** — Roadmap or future margin fields; not MVP unless scoped.
3. **“Guides missing when I print.”** — Expected: screen-only aid (unless a future product decision explicitly prints them).
4. **Scaling / DPI** — Browser and dialog scaling affect PDF; guides use app math only.

**One-line support script:**  
“Guides use the paper and margins selected in this app; set the same in the print/PDF dialog for the closest match.”

---

### User remediation — “I want this section to start on page N”

Guides help **see** bands; they do not **force** PDF breaks.

**Without new features:**

1. Use **Print preview** to see real breaks.
2. Adjust content **above** the target (shorten, add blank lines, horizontal rule `---`, or spacer paragraphs) to **push** content down.
3. If a **table or code block** straddles pages: shorten, split, or accept browser behavior.

**Possible future enhancements (separate backlog items):**

- Toolbar insert for “extra vertical space” (Markdown-only).
- If HTML in Markdown is ever allowed: controlled `page-break-before` (security + sanitization required).

---

### Success criteria (realistic)

- Users can **see** roughly where page-length bands fall and avoid placing critical headings right on a boundary.
- **Not** required: pixel-perfect match to every Edge PDF on every machine.

---

## Print footer placement — “all pages” vs “last page only” (deferred)

**Intent:** Optional control (e.g. on the same row as “Disclaimer / legal text”) so authors can choose whether the **print footer** (disclaimer + footer logo block) should appear **once at the end of the document** (typical **last page** for normal-length text) or **repeated on every printed page** (compliance-style).

**Current behavior (baseline):** The footer is a **single DOM block** after the main article; `break-inside: avoid` keeps it together. Multi-page PDFs usually show it **once near the end** (often the last page).

**“Every printed page” note:** Browsers do not offer a native “repeat this HTML on each PDF page” API. A future implementation likely relies on **print-only layout** (e.g. `position: fixed` in `@media print`) plus reserved **bottom margin** so body text does not overlap the footer. Expect **Edge/Chromium QA** and guidance that **long disclaimers** may behave poorly in repeat mode.

**Risks:** Overlap/clipping, margin tuning, preview vs PDF differences, very tall footer content.

**Deferred:** No implementation scheduled; revisit when product priority and print QA time are available.

---

## Notes

- **Deferred:** No Page Guide implementation is scheduled; this file captures scope for when the team chooses to proceed.
- Related product context: Markdown source stays plain text; preview remains the rendering truth; print uses the browser pipeline (Edge-first per project prefs).
