/** Shared localStorage keys — must match src/storage.js and @m2pdf/core branding-keys. */
export const STORAGE_KEYS = {
  disclaimer: 'm2pdf_disclaimer_v1',
  logoState: 'm2pdf_logo_state_v1',
  logoLayout: 'm2pdf_logo_layout_v1',
  pageGuide: 'm2pdf_page_guide_v1',
} as const;

/** Debounce in main.js is 140ms; use a small cushion for preview updates. */
export const PREVIEW_SETTLE_MS = 300;

/** Disclaimer debounce in main.js is 400ms. */
export const BRANDING_SETTLE_MS = 500;
