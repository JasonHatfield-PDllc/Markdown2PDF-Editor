# Desktop UAT — 0.1.12 (Find Stabilize / Option A)

Build: `markdown2pdf-desktop@0.1.12` — Prefer B preview retained; Source Find **active-match** highlights.

**Before test:** `npm run pack:desktop` from `Markdown2PDF/` root.

---

## Test plan (must test — human)

| # | Area | Steps | Pass? |
|---|------|--------|-------|
| H1 | **Find basics** | Long `.md` → Ctrl+F → type term → **Find** or Enter. Status `Match n of m`. **Orange** mark on current word in Source (through transparent editor bg). | |
| H1b | **Edit with Find open** | Click elsewhere in Source → press Enter twice. Scroll/cursor stay put; mark does not jump. | |
| H2 | **Find next** | F3 / ▼ / ▲ — mark and status advance. No freeze while typing in Find field. | |
| H3 | **Paste query** | Ctrl+F → paste from clipboard → Find — lands on real matches (not Author/header glitches). | |
| H4 | **Tab + Find** | Two tabs, Find open → switch tab → Find again on each tab’s text. | |
| H5 | **Preview / export** | Edited doc: preview updates; Export PDF matches preview (Prefer B). | |

---

## Tested by agent

| Check | Result |
|-------|--------|
| `npm run test:prefer-b` | Run before pack (PDF + text layer + Find highlight + Find typing) |

---

## Automated gate (no EXE required)

```bash
cd Markdown2PDF
npm run test:prefer-b
```

---

## Recommendation

**Go** for `Markdown2PDF-0.1.12-Setup.exe` when H1–H5 pass.

**No-Go** if Find does nothing until Enter (expected) but **Enter/Find** fails to select or mark moves — file a repro with doc size and query.
