/**
 * Desktop multi-document session model.
 * Branding stays global; docs can later grow an optional brandingOverride (premium).
 */

/**
 * @typedef {{
 *   id: string,
 *   text: string,
 *   path: string | null,
 *   name: string,
 *   dirty: boolean,
 * }} DocumentTab
 */

/**
 * @typedef {{
 *   docs: DocumentTab[],
 *   activeId: string,
 * }} AppSession
 */

let docSeq = 0;

/** @returns {string} */
export function newDocId() {
  docSeq += 1;
  return `doc-${Date.now().toString(36)}-${docSeq}`;
}

/**
 * @param {Partial<DocumentTab>} [partial]
 * @returns {DocumentTab}
 */
export function createDocument(partial = {}) {
  const id = typeof partial.id === 'string' && partial.id ? partial.id : newDocId();
  const name =
    typeof partial.name === 'string' && partial.name.trim()
      ? partial.name.trim()
      : 'Untitled.md';
  return {
    id,
    text: typeof partial.text === 'string' ? partial.text : '',
    path: typeof partial.path === 'string' && partial.path ? partial.path : null,
    name,
    dirty: Boolean(partial.dirty),
  };
}

/** @returns {AppSession} */
export function createEmptySession() {
  const doc = createDocument();
  return { docs: [doc], activeId: doc.id };
}

/**
 * @param {AppSession} session
 * @returns {DocumentTab | null}
 */
export function getActiveDocument(session) {
  if (!session?.docs?.length) return null;
  return session.docs.find((d) => d.id === session.activeId) ?? session.docs[0] ?? null;
}

/**
 * @param {AppSession} session
 * @param {string} id
 * @returns {DocumentTab | null}
 */
export function getDocumentById(session, id) {
  return session.docs.find((d) => d.id === id) ?? null;
}

/**
 * @param {AppSession} session
 * @param {string | null | undefined} filePath
 * @returns {DocumentTab | null}
 */
export function findDocumentByPath(session, filePath) {
  if (!filePath) return null;
  const target = filePath.toLowerCase();
  return session.docs.find((d) => d.path && d.path.toLowerCase() === target) ?? null;
}

/**
 * @param {unknown} raw
 * @returns {AppSession | null}
 */
export function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (!Array.isArray(o.docs) || o.docs.length === 0) return null;
  /** @type {DocumentTab[]} */
  const docs = [];
  for (const item of o.docs) {
    if (!item || typeof item !== 'object') continue;
    const d = /** @type {Record<string, unknown>} */ (item);
    docs.push(
      createDocument({
        id: typeof d.id === 'string' ? d.id : undefined,
        text: typeof d.text === 'string' ? d.text : '',
        path: typeof d.path === 'string' ? d.path : null,
        name: typeof d.name === 'string' ? d.name : 'Untitled.md',
        dirty: Boolean(d.dirty),
      }),
    );
  }
  if (!docs.length) return null;
  const activeId =
    typeof o.activeId === 'string' && docs.some((d) => d.id === o.activeId)
      ? o.activeId
      : docs[0].id;
  return { docs, activeId };
}

/**
 * Ensure at least one document; fix activeId if stale.
 * @param {AppSession} session
 * @returns {AppSession}
 */
export function ensureSession(session) {
  if (!session?.docs?.length) return createEmptySession();
  if (!session.docs.some((d) => d.id === session.activeId)) {
    return { ...session, activeId: session.docs[0].id };
  }
  return session;
}
