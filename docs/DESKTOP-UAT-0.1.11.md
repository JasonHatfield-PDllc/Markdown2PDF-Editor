# Desktop UAT — 0.1.11 (2026-11-12)

Build: `markdown2pdf-desktop@0.1.11` — **Find highlight layer** fix (backdrop `z-index: 2` above textarea).

---

## Test plan (must test — human)

| # | Area | Steps | Pass? |
|---|------|--------|-------|
| H1 | **Find (stabilize)** | Ctrl+F → type query → **Find** or Enter (typing alone does not search). **Orange** on **current** match only; status `Match n of total`; F3 moves mark. | |
| H2 | **Find next** | F3 / ▼ through several matches; active highlight moves. | |
| H3 | **Scope** | Find bar has **no** preview/both dropdown (Source only). | |
| H4 | **Select all** | Ctrl+A in Source with Find open → single click in editor → selection clears (no 3-click fight). | |
| H5 | **Tab + Find** | Two tabs, different text; Find open → switch tab → highlights match active tab. | |
| H6 | **Preview** | Type in Source; PDF preview updates after idle/blur; tab switch shows correct cached page. | |
| H7 | **Export** | Export PDF on edited doc; matches preview layout. | |

---

## Tested by agent

| Check | Result | Notes |
|-------|--------|--------|
| `npm run build:desktop` | **Pass** | 0.1.11 bundle |
| `npm run test:pdf-audit:electron` | **Pass** | 2-page PDF fixture |
| `npm run test:pdf-audit:textlayer` | **Pass** | pdf.js metrics |
| `npm run test:desktop:find-highlights` | **Pass** | ≥1 rect, backdrop z=2 > textarea z=1, selection on match |
| `npm run test:desktop:find-typing` | **Run after pack** | Large doc; type in Find bar without renderer hang; Find still works |
| `npm run test:e2e` (web) | **18/19 pass** | 1 flaky/unrelated: `06-print-layout` every-page footer visibility (web CSS print; not desktop 0.1.11 delta) |
| Manual Find on user 10+ page doc | **Not run** | Human H1–H5 |

---

## Not tested / residual risk

- Very long lines / horizontal scroll ↔ highlight alignment (measure mirror).
- Replace-all + Find combined flows.
- Packaged `.exe` on machine other than dev build host.

---

## Recommendation

**Go** for repack `Markdown2PDF-0.1.11-Setup.exe` after human passes **H1–H5**.

**No-Go** if highlights still invisible → confirm fresh build contains `index-w-rwqA5-.css` (or newer) with `#textarea-md-backdrop.opacity-100 { z-index: 2 }`.
