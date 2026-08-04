/** localStorage keys used by the web app (src/storage.js). Desktop will use file-based prefs with the same schema. */

export const STORAGE_KEYS = {
  disclaimer: 'm2pdf_disclaimer_v1',
  sidebarWidthPx: 'm2pdf_sidebar_width_px_v1',
  logoState: 'm2pdf_logo_state_v1',
  logoRecent: 'm2pdf_logo_recent_v1',
  logoLayout: 'm2pdf_logo_layout_v1',
  pageGuide: 'm2pdf_page_guide_v1',
  printTitle: 'm2pdf_print_title_v1',
  mdDraft: 'm2pdf_md_draft_v1',
};

/** ~675KB base64 — stay under typical 5MB localStorage with other keys. */
export const MAX_LOGO_DATA_URL_CHARS = 900_000;

export const DEFAULT_LOGO_LAYOUT = {
  headerPlacement: 'left',
  headerScale: 35,
  footerPlacement: 'none',
  footerScale: 100,
};

export const DEFAULT_PRINT_TITLE = {
  text: '',
  level: 'h1',
  align: 'left',
};
