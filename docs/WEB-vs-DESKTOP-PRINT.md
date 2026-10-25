# Web vs desktop print (Prefer B)

## Matrix

| Capability | Web (`window.print` / CSS `@page`) | Desktop Prefer B (`printToPDF` + `footerTemplate` + pdf.js) |
|---|---|---|
| Branding footer L/C/R text | Yes (DOM + CSS) | Yes (DOM + footerTemplate) |
| Footer logo scale (column %) | Yes (Header-parity) | Yes (Header-parity + template) |
| Page # L/C/R / Off | Yes (`@page` margin boxes, Chromium) | Yes (template + `@page` by mode) |
| Every-page branding footer | Text+page #: `@page` margin band (same line). Logo: best-effort fixed strip | Yes (footerTemplate every page) |
| Live Chromium PDF preview (paginated) | No — continuous HTML + optional guide bands | Yes (`printToPDF` + pdf.js) |
| Text-layer select / copy in preview | N/A (HTML preview) | Yes (pdf.js `--scale-factor`) |

Prefer B’s Chromium PDF pipeline stays **desktop-only**. The web Preview panel cannot become a true print-ready page strip without that pipeline (browsers do not expose `printToPDF` to normal web apps).

**Web print tips:** In Chrome/Edge print dialog, turn off **Headers and footers** (removes date/title). Use **Every printed page** + short disclaimer for same-line footer text + page #.

## Shared keys

Footer prefs use the same localStorage key names as desktop (`m2pdf_footer_*_v1`). See `@m2pdf/core` `branding-keys.js`.
