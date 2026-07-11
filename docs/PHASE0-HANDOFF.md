# Phase 0 Handoff — Markdown2PDF Desktop Program

**Date:** 2026-07-11  
**Branch:** `cursor/phase-0-playwright-434e`  
**Status:** Phase 0 complete — web MVP unchanged; monorepo scaffold + Playwright journeys + CI added.

This document is the Monday laptop handoff. It records decisions, layout, tech stack, assumptions, and next steps.

---

## 1. Executive summary

Phase 0 adds infrastructure for a **future Windows desktop app** without modifying web app behavior or deployment.

| Deliverable | Status |
|-------------|--------|
| `packages/m2pdf-core` shared package (copied modules) | Done |
| Playwright journey-based e2e suite | Done |
| GitHub Actions e2e workflow + HTML report artifacts | Done |
| Web GitHub Pages deploy workflow | Unchanged |
| Web `src/` runtime code | Unchanged |

---

## 2. Architecture layout

```text
Markdown2PDF-Editor/
├── src/                          # WEB (unchanged) — still the live MVP
├── index.html
├── vite.config.js
├── package.json                  # workspace root + web scripts
│
├── packages/
│   └── m2pdf-core/               # NEW — shared logic for desktop (Phase 1)
│       ├── package.json          # @m2pdf/core
│       └── src/
│           ├── markdown.js
│           ├── pageGuide.js
│           ├── mdToolbar.js
│           ├── print.css
│           ├── branding-keys.js
│           └── index.js
│
├── e2e/                          # NEW — human-style journey automation
│   ├── fixtures/
│   │   ├── sample.md
│   │   └── logo-12x12.png
│   ├── pages/
│   │   └── app.page.ts           # Page object (sidebar + preview)
│   ├── support/
│   │   ├── constants.ts
│   │   └── legacy-file-io.ts
│   └── web/
│       └── journeys/
│           ├── 01-app-boot.spec.ts
│           ├── 02-author-document.spec.ts
│           ├── 03-branding-workflow.spec.ts
│           ├── 04-persistence-roundtrip.spec.ts
│           ├── 05-page-guides.spec.ts
│           ├── 06-print-layout.spec.ts
│           └── 07-file-workflow.spec.ts
│
├── playwright.config.ts
├── tsconfig.e2e.json
│
├── docs/
│   └── PHASE0-HANDOFF.md         # this file
│
└── .github/workflows/
    ├── deploy-github-pages.yml   # unchanged
    └── e2e.yml                   # NEW
```

### Planned Phase 1 addition (not built yet)

```text
apps/
└── desktop/                      # Electron shell — Phase 1
```

---

## 3. Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Web app | Vite 6, vanilla JS, Tailwind 3 | Unchanged at repo root |
| Shared core | `@m2pdf/core` (ESM) | Copied from `src/`; not wired to web yet |
| E2E | Playwright 1.51+ (TypeScript) | Journey-first, Chromium |
| CI | GitHub Actions | `e2e.yml` on PR + `main` |
| Desktop (future) | Electron + electron-builder | Decision D-002; Phase 1 |

---

## 4. Decisions (debate → decide → commit)

### D-001: Side-by-side monorepo, web stays at root

**Decision:** Add `packages/` and `e2e/` beside the existing web app. Do **not** move `src/` into `apps/web/` yet.

**Rationale:** Zero risk to GitHub Pages paths, `vite.config.js`, and existing deploy workflow.

**Trade-off:** Duplicate modules in `src/` and `packages/m2pdf-core/` until web is rewired.

---

### D-002: Electron for Phase 1 desktop (provisional)

**Decision:** Target Electron for the downloadable Windows app.

**Rationale:** Mature `printToPDF`, aligns with Chromium-first print CSS, team stack is JS.

**Revisit when:** Joy Factor repo is available on laptop — align packaging if that project already chose Tauri or another shell.

---

### D-003: Journey-first Playwright (not isolated feature tests)

**Decision:** Primary suite is multi-step **journeys** that mirror human QA: edit → preview → brand → persist → print/file.

**Rationale:** User requirement — test how features work on the page **and** with the system.

**Pattern:** Page Object (`AppPage`) + journey specs + system checks (localStorage, print media, PDF bytes, downloads).

---

### D-004: Legacy file I/O in file-workflow tests

**Decision:** File-open/save journeys stub out `showOpenFilePicker` / `showSaveFilePicker` so tests use:

- hidden `<input type="file">` for Open
- `<a download>` fallback for Save As

**Automation note:** FS Access API is stubbed to `undefined` in `beforeEach` so Open uses the legacy `<input type="file">` path. The journey uses Playwright's `filechooser` event with `Promise.all` (click + wait) — verified against `vite preview`.

**Scope:** Only `07-file-workflow.spec.ts` (via `useLegacyFileIo` in `beforeEach`).

---

### D-005: Print button test stubs `window.print`

**Decision:** Journey `06-print-layout` stubs `window.print` to verify the button invokes the print pipeline without hanging on the native dialog.

**Rationale:** Native print dialogs block headless/CI. Separate checks use `page.emulateMedia({ media: 'print' })` and `page.pdf()` for layout/output.

---

### D-006: Clear source does not clear branding

**Decision:** Documented expected behavior — `Clear` empties markdown only; disclaimer/branding prefs persist.

**Encoded in:** `02-author-document.spec.ts`, `04-persistence-roundtrip.spec.ts`.

**Source:** `src/main.js` — `btnClear` only clears textarea + file handle.

---

### D-007: Sync policy for `@m2pdf/core`

**Decision:** Until web imports `@m2pdf/core`, any change to shared logic must update **both** `src/` and `packages/m2pdf-core/src/`.

**Phase 1+ option:** Rewire web to `@m2pdf/core` in a dedicated PR with full e2e green.

---

## 5. Journey catalog

| ID | Journey | Human path | System checks |
|----|---------|------------|---------------|
| 01 | First visit | Land on editor | Sidebar, toolbar, placeholder preview |
| 02 | Author document | Type → toolbar bold → H1 → clear | Preview DOM; clear preserves disclaimer |
| 03 | Branded document | Markdown + disclaimer + logo URL/upload | `#print-root`, header, footer block |
| 04 | Persistence | Set prefs → reload | `localStorage` keys + UI restored |
| 05 | Page guides | Toggle guides, change paper | CSS `--m2pdf-guide-step`, overlay hidden in print |
| 06 | Print layout | Author → print media → PDF | Sidebar hidden; `page.pdf()` non-empty; print stub |
| 07 | File workflow | Open fixture → edit → Save As | Download content matches source |

---

## 6. Assumptions

1. **Joy Factor repo** was not accessible from the cloud agent environment. Monday task: compare Joy Factor Playwright/CI conventions and align naming if needed.
2. **Chromium is the automation browser** — matches Edge-first product guidance.
3. **Preview debounce** is 140ms in `main.js`; tests use 300ms settle time (`e2e/support/constants.ts`).
4. **Disclaimer debounce** is 400ms; tests use 500ms for branding assertions.
5. **External logo URLs** in tests use `https://example.com/logo.png` (no network fetch required for `src` attribute assertion).
6. **Web deploy is independent** — `deploy-github-pages.yml` does not run e2e (separate workflows).
7. **No PWA / service worker** — e2e targets built static preview server (`vite preview` on port 4173).

### E2E implementation notes (learned during Phase 0)

| Topic | Lesson |
|-------|--------|
| Textarea assertions | Use `toHaveValue()`, not `toContainText()` — textarea content lives in `.value` |
| Page guide overlay | Do not match `/hidden/` on `className`; Tailwind `print:hidden` false-matches. Use `classList.contains('hidden')` |
| File open automation | Stub FS Access API to `undefined`; use `Promise.all([filechooser, click])` |
| Print button in CI | Stub `window.print` before `goto()`; assert layout separately via `page.pdf()` |

---

## 7. Local development (laptop)

### Prerequisites

- Node.js 20+
- npm 10+

### Install

```bash
git fetch origin
git checkout cursor/phase-0-playwright-434e   # or main after merge
npm ci
npx playwright install chromium
```

### Run web app (unchanged)

```bash
npm run dev
```

### Run e2e locally

```bash
npm run test:e2e
npm run test:e2e:ui      # interactive debugger
npm run test:e2e:report  # open last HTML report
```

Playwright starts `npm run build && npm run preview` automatically (`playwright.config.ts`).

### Review failures from phone (CI)

1. Open GitHub Actions → **E2E (Playwright)** workflow run.
2. Download artifact **playwright-report**.
3. Open `index.html` in the report zip (or use Playwright trace viewer for `test-results/`).

---

## 8. What was intentionally NOT changed

- `src/main.js`, `index.html`, and all web runtime files
- `deploy-github-pages.yml`
- PDF export mechanism (still `window.print()` on web)
- No Electron / desktop app yet
- Web does not import `@m2pdf/core` yet

---

## 9. Phase 1 preview (next)

| Step | Work |
|------|------|
| 1 | `apps/desktop/` Electron shell loading Vite renderer |
| 2 | Import `@m2pdf/core` in desktop renderer |
| 3 | `webContents.printToPDF()` — one-click Export PDF |
| 4 | `electron-builder` Windows `.exe` installer |
| 5 | Extend e2e: `e2e/desktop/journeys/` reusing `AppPage` patterns |
| 6 | Optional: align with Joy Factor repo structure |

---

## 10. Open questions for Monday

1. **Joy Factor alignment** — share repo path; diff Playwright config, CI, and desktop packaging.
2. **Rewire web to `@m2pdf/core`** — do in Phase 1 alongside desktop, or defer?
3. **E2E on deploy** — gate GitHub Pages deploy on green e2e? (Currently parallel workflows.)
4. **Visual regression** — add snapshot tests for preview/print in Phase 1 or 2?
5. **Product naming** — separate installer name vs. web “Markdown → PDF Editor”?

---

## 11. Contacts / references

| Item | Location |
|------|----------|
| Product backlog | `Backlog.md` |
| Deploy docs | `DEPLOY.md` |
| Core package readme | `packages/m2pdf-core/README.md` |
| Playwright config | `playwright.config.ts` |
| Page object | `e2e/pages/app.page.ts` |

---

*Generated as part of Phase 0 — Markdown2PDF desktop program.*
