const KEY_DISCLAIMER = 'm2pdf_disclaimer_v1';

const KEY_SIDEBAR_WIDTH_PX = 'm2pdf_sidebar_width_px_v1';



/** Unified logo persistence: separate header + footer images (v2 bundle). */

const KEY_LOGO_STATE = 'm2pdf_logo_state_v1';

const LEGACY_LOGO_URL = 'm2pdf_logo_url_v1';

const KEY_LOGO_RECENT = 'm2pdf_logo_recent_v1';

/** ~675KB base64 — stay under typical 5MB localStorage with other keys. */
export const MAX_LOGO_DATA_URL_CHARS = 900_000;

const MAX_RECENT = 8;

/**
 * @typedef {{ mode: 'url', url: string } | { mode: 'data', dataUrl: string, name?: string }} LogoSlotState
 */

/**
 * @param {unknown} raw
 * @returns {LogoSlotState | null}
 */
function normalizeSlot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (o.mode === 'url' && typeof o.url === 'string' && o.url.trim()) {
    return { mode: 'url', url: o.url.trim() };
  }
  if (o.mode === 'data' && typeof o.dataUrl === 'string' && o.dataUrl.length > 0) {
    if (o.dataUrl.length > MAX_LOGO_DATA_URL_CHARS) return null;
    return {
      mode: 'data',
      dataUrl: o.dataUrl,
      name: typeof o.name === 'string' ? o.name : undefined,
    };
  }
  return null;
}

/**
 * @returns {{ header: LogoSlotState | null, footer: LogoSlotState | null }}
 */
export function loadLogoBundle() {
  try {
    const raw = localStorage.getItem(KEY_LOGO_STATE);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.v === 2) {
        return {
          header: normalizeSlot(p.header),
          footer: normalizeSlot(p.footer),
        };
      }
      const legacySlot = normalizeSlot(p);
      if (legacySlot) {
        const next = { v: 2, header: legacySlot, footer: legacySlot };
        localStorage.setItem(KEY_LOGO_STATE, JSON.stringify(next));
        return { header: legacySlot, footer: legacySlot };
      }
    }
    const legacyUrl = localStorage.getItem(LEGACY_LOGO_URL);
    if (legacyUrl && legacyUrl.trim()) {
      const u = /** @type {LogoSlotState} */ ({ mode: 'url', url: legacyUrl.trim() });
      localStorage.setItem(
        KEY_LOGO_STATE,
        JSON.stringify({ v: 2, header: u, footer: u }),
      );
      localStorage.removeItem(LEGACY_LOGO_URL);
      return { header: u, footer: u };
    }
  } catch {
    /* ignore */
  }
  return { header: null, footer: null };
}

/**
 * @param {'header' | 'footer'} slot
 * @param {LogoSlotState | null} state
 */
export function saveLogoSlot(slot, state) {
  const bundle = loadLogoBundle();
  let header = bundle.header;
  let footer = bundle.footer;
  if (state && state.mode === 'data' && state.dataUrl.length > MAX_LOGO_DATA_URL_CHARS) {
    throw new Error('LOGO_TOO_LARGE');
  }
  const norm = state === null ? null : normalizeSlot(state);
  if (slot === 'header') header = norm;
  else footer = norm;
  try {
    localStorage.setItem(KEY_LOGO_STATE, JSON.stringify({ v: 2, header, footer }));
  } catch (e) {
    if (e instanceof Error && e.message === 'LOGO_TOO_LARGE') throw e;
  }
}

/** @param {'header' | 'footer'} slot */
export function clearLogoSlot(slot) {
  saveLogoSlot(slot, null);
}

export function clearAllLogoSlots() {
  try {
    localStorage.removeItem(KEY_LOGO_STATE);
  } catch {
    /* ignore */
  }
}




/** @returns {string[]} */

export function loadRecentLogoUrls() {

  try {

    const raw = localStorage.getItem(KEY_LOGO_RECENT);

    const arr = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(arr)) return [];

    return arr.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));

  } catch {

    return [];

  }

}



/** @param {string} url */

export function addRecentLogoUrl(url) {

  const u = url.trim();

  if (!u || !/^https?:\/\//i.test(u)) return;

  try {

    let list = loadRecentLogoUrls().filter((x) => x !== u);

    list.unshift(u);

    list = list.slice(0, MAX_RECENT);

    localStorage.setItem(KEY_LOGO_RECENT, JSON.stringify(list));

  } catch {

    /* ignore */

  }

}



export function loadBranding() {

  try {

    const disclaimer = localStorage.getItem(KEY_DISCLAIMER) ?? '';

    return { disclaimer };

  } catch {

    return { disclaimer: '' };

  }

}



export function saveDisclaimer(text) {

  try {

    localStorage.setItem(KEY_DISCLAIMER, text);

  } catch {

    /* ignore quota */

  }

}



/** @returns {number | null} */

export function loadSidebarWidthPx() {

  try {

    const raw = localStorage.getItem(KEY_SIDEBAR_WIDTH_PX);

    if (raw == null || raw === '') return null;

    const n = Number.parseInt(raw, 10);

    return Number.isFinite(n) && n > 0 ? n : null;

  } catch {

    return null;

  }

}



/** @param {number} px */

export function saveSidebarWidthPx(px) {

  try {

    localStorage.setItem(KEY_SIDEBAR_WIDTH_PX, String(Math.round(px)));

  } catch {

    /* ignore */

  }

}

const KEY_LOGO_LAYOUT = 'm2pdf_logo_layout_v1';

/** @typedef {'left' | 'center' | 'right' | 'none'} LogoPlacement */

/**
 * @typedef {{ headerPlacement: LogoPlacement, headerScale: number, footerPlacement: LogoPlacement, footerScale: number }} LogoLayout
 */

export const DEFAULT_LOGO_LAYOUT = {
  headerPlacement: 'left',
  headerScale: 100,
  footerPlacement: 'none',
  footerScale: 100,
};

/** @param {unknown} p @returns {LogoLayout} */
function normalizeLogoLayout(p) {
  const out = { ...DEFAULT_LOGO_LAYOUT };
  const pl = ['none', 'left', 'center', 'right'];
  if (p && typeof p === 'object') {
    const o = /** @type {Record<string, unknown>} */ (p);
    if (typeof o.headerPlacement === 'string' && pl.includes(o.headerPlacement)) {
      out.headerPlacement = /** @type {LogoPlacement} */ (o.headerPlacement);
    }
    if (typeof o.footerPlacement === 'string' && pl.includes(o.footerPlacement)) {
      out.footerPlacement = /** @type {LogoPlacement} */ (o.footerPlacement);
    }
    const hs = Number(o.headerScale);
    if (Number.isFinite(hs)) out.headerScale = Math.min(100, Math.max(1, Math.round(hs)));
    const fs = Number(o.footerScale);
    if (Number.isFinite(fs)) out.footerScale = Math.min(100, Math.max(1, Math.round(fs)));
  }
  return out;
}

/** @returns {LogoLayout} */
export function loadLogoLayout() {
  try {
    const raw = localStorage.getItem(KEY_LOGO_LAYOUT);
    if (!raw) return { ...DEFAULT_LOGO_LAYOUT };
    return normalizeLogoLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LOGO_LAYOUT };
  }
}

/** @param {Partial<LogoLayout> | LogoLayout} layout */
export function saveLogoLayout(layout) {
  try {
    const merged = normalizeLogoLayout({ ...DEFAULT_LOGO_LAYOUT, ...layout });
    localStorage.setItem(KEY_LOGO_LAYOUT, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
}

const KEY_PAGE_GUIDE = 'm2pdf_page_guide_v1';

/** @typedef {'letter' | 'a4' | 'legal'} PageGuidePaper */

/**
 * @typedef {{ enabled: boolean, paper: PageGuidePaper }} PageGuideSettings
 */

/** @returns {PageGuideSettings} */
export function loadPageGuideSettings() {
  try {
    const raw = localStorage.getItem(KEY_PAGE_GUIDE);
    if (!raw) return { enabled: false, paper: 'letter' };
    const p = JSON.parse(raw);
    if (p && typeof p === 'object') {
      const paper =
        p.paper === 'a4' || p.paper === 'legal' ? p.paper : 'letter';
      return { enabled: Boolean(p.enabled), paper };
    }
  } catch {
    /* ignore */
  }
  return { enabled: false, paper: 'letter' };
}

/** @param {PageGuideSettings} s */
export function savePageGuideSettings(s) {
  try {
    localStorage.setItem(KEY_PAGE_GUIDE, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}

