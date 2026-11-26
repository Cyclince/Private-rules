import type { TemplateBody, TemplateOverlay, TemplateRecord } from '../../shared/schemas/template';

export type TemplateDraftRecord = {
  templateId: string;
  baseVersion: number;
  updatedAt: string;
  name: string;
  slug: string;
  description: string;
  baseBody: TemplateBody;
  overlay: TemplateOverlay;
  note: string;
};

const DB_NAME = 'private-rules-template-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const FALLBACK_PREFIX = 'private-rules-tpl-draft:';

function hasIndexedDb(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined';
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'templateId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

function writeFallbackStorage(draft: TemplateDraftRecord): void {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(`${FALLBACK_PREFIX}${draft.templateId}`, JSON.stringify(draft));
    }
  } catch {
    // Ignore restricted storage errors.
  }
}

function readFallbackStorage(templateId: string): TemplateDraftRecord | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    const raw = globalThis.localStorage.getItem(`${FALLBACK_PREFIX}${templateId}`);
    if (!raw) return null;
    return JSON.parse(raw) as TemplateDraftRecord;
  } catch {
    return null;
  }
}

function deleteFallbackStorage(templateId: string): void {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.removeItem(`${FALLBACK_PREFIX}${templateId}`);
    }
  } catch {
    // Ignore storage errors.
  }
}

export async function saveTemplateDraft(draft: TemplateDraftRecord): Promise<void> {
  if (!hasIndexedDb()) {
    writeFallbackStorage(draft);
    return;
  }
  try {
    const db = await openDraftDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save draft'));
    });
    db.close();
  } catch {
    writeFallbackStorage(draft);
  }
}

export async function loadTemplateDraft(templateId: string): Promise<TemplateDraftRecord | null> {
  if (!hasIndexedDb()) {
    return readFallbackStorage(templateId);
  }
  try {
    const db = await openDraftDb();
    const record = await new Promise<TemplateDraftRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(templateId);
      req.onsuccess = () => resolve((req.result as TemplateDraftRecord | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Failed to load draft'));
    });
    db.close();
    return record ?? readFallbackStorage(templateId);
  } catch {
    return readFallbackStorage(templateId);
  }
}

export async function deleteTemplateDraft(templateId: string): Promise<void> {
  deleteFallbackStorage(templateId);
  if (!hasIndexedDb()) return;
  try {
    const db = await openDraftDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(templateId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete draft'));
    });
    db.close();
  } catch {
    // Ignore IndexedDB cleanup errors.
  }
}

export function isDraftDifferentFromServer(
  draft: TemplateDraftRecord,
  serverTemplate: Pick<TemplateRecord, 'name' | 'slug' | 'description' | 'baseBody' | 'overlay'>,
): boolean {
  if (draft.name !== serverTemplate.name) return true;
  if (draft.slug !== serverTemplate.slug) return true;
  if (draft.description !== serverTemplate.description) return true;
  if (JSON.stringify(draft.overlay) !== JSON.stringify(serverTemplate.overlay)) return true;
  if (JSON.stringify(draft.baseBody) !== JSON.stringify(serverTemplate.baseBody)) return true;
  return false;
}
