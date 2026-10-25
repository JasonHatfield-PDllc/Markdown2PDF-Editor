# Windows signing cost strategy (PD LLC)

**Status:** Decision note for Markdown2PDF desktop and future Windows products  
**Last updated:** 2026-08-06  
**Related:** `apps/desktop/scripts/afterPack.cjs` (icon + VersionInfo; not Authenticode)

## Current decision (2026-08-06)

**Defer Azure Artifact Signing** until client billing income is more consistent (target revisit: **September 2026**). Deployed builds stay **unsigned**; VersionInfo branding + installer license/Help Terms remain in place. Do **not** start an Azure free trial for this purpose — Artifact Signing requires a **paid** (pay-as-you-go) subscription.

## Decision (strategy)

Do **not** buy a ~$1k EV hardware-token certificate for SmartScreen.

For a multi-product LLC with a budget ceiling around **$200/year** (if the spend is reusable):

- Prefer **Azure Artifact Signing Basic** (~$9.99/month ≈ **~$120/year**).
- One Azure account / signing setup can cover **Markdown2PDF and future Windows apps**.
- Treat signing as **company COGS**, not a Markdown2PDF-only tax.
- While Markdown2PDF stays **free** and volume is low, **unsigned** is acceptable if install guidance covers SmartScreen (“More info” → “Run anyway”).
- Turn on Azure signing when you start **monetizing** desktop installs or run paid acquisition (deal sites, ads, etc.).

Traditional OV/EV packages (often several hundred to $1k+/year, plus HSM token friction) are usually **worse value** than Azure Basic for this stack. Marketing placements (e.g. Mashable-style deals) do **not** replace Authenticode.

Confirm current Azure pricing and identity requirements in the Azure portal before purchasing (service may appear as Artifact Signing / formerly Trusted Signing).

## Options compared

| Path | Rough annual cost | Reuse across products? | SmartScreen reality | Fit for PD |
|------|-------------------|------------------------|---------------------|------------|
| Azure Artifact Signing (Basic) | ~$9.99/mo (~$120/yr) | Yes | Signed + timestamped; reputation still builds with real installs | Best under $200/yr |
| Stay unsigned + Wix download | $0 | n/a | “Windows protected your PC” — biggest drop-off when charging | OK while free / low volume |
| Traditional OV Authenticode | Often $200–500+/yr + HSM friction | Yes | Similar reputation-building; EV premium rarely worth it now | Usually worse than Azure |
| EV hardware-token cert | Often $400–1000+/yr | Painful CI | Old “instant trust” story largely gone | Skip for this budget |
| Microsoft Store | Dev account (~one-time) + Store policies/cut | Store-signed packages | Different channel than “download Setup.exe” | Optional later |
| Self-signed | $0 | Yes | No meaningful SmartScreen help | Do not bother |

## Playbook

### 1. Now — $0 — brand the binary (done)

`afterPack` stamps VersionInfo (Company, Product, versions) and embeds the icon so Windows Properties shows **Pragmatic Disruptor / Markdown2PDF**, not Electron/GitHub.

This does **not** silence SmartScreen; it improves professional appearance.

### 2. When selling — ~$120/yr — Azure Artifact Signing

1. Azure subscription under **Pragmatic Disruptor, LLC.**
2. Artifact Signing **Basic** SKU.
3. Complete identity verification once.
4. Sign `Markdown2PDF-*-Setup.exe` (and later other Windows installers) in CI or a pack script.
5. Keep timestamping enabled so signatures remain valid after cert rotation.

### 3. Distribution

Keep the simple Wix / site download path for the Setup.exe. Microsoft Store is an optional later channel, not a substitute for deciding whether to sign direct downloads.

### 4. Marketing vs trust

Paid placements drive attention. Conversion for a desktop `.exe` still depends on a trustworthy installer. Prefer signing before aggressive paid acquisition, or accept support cost / drop-off from SmartScreen.

## What we are not doing (for now)

- No DigiCert/Sectigo EV USB workflow for this product line.
- No reliance on self-signed PE certificates.
- No assumption that deal-site featuring removes SmartScreen prompts.

## See also

- Desktop packaging notes: `apps/desktop/README.md`
- Installer license / Terms: `apps/desktop/build/license.txt`
- Site Terms: https://www.pragmaticdisruptor.com/terms-of-use
- Site Privacy: https://www.pragmaticdisruptor.com/privacynotice
