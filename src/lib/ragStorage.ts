import type { RagFile } from '../types';
import { LOCAL_PROFILE_UID_PATTERN } from './localProfiles';

const DB_NAME = 'osone_rag_db';
const STORE_NAME = 'files';
export const MAX_RAG_FILES = 200;
export const MAX_RAG_FILE_BYTES = 1_000_000;
export const MAX_RAG_TOTAL_BYTES = 20_000_000;

const normalizeScope = (value: unknown): string => {
  const scope = typeof value === 'string' ? value.trim() : '';
  return scope === 'guest' || LOCAL_PROFILE_UID_PATTERN.test(scope)
    ? scope
    : 'guest';
};

const openRagDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

const storageId = (scope: string, fileId: string): string =>
  `${normalizeScope(scope)}::${fileId}`;

export const saveRagFileToDB = async (
  file: RagFile,
  scope = 'guest'
): Promise<void> => {
  const normalizedScope = normalizeScope(scope);
  if (
    !file?.id ||
    typeof file.content !== 'string' ||
    file.content.length > MAX_RAG_FILE_BYTES
  ) {
    throw new Error('Documento RAG inválido ou maior que 1 MB.');
  }
  const db = await openRagDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put({
      ...file,
      id: storageId(normalizedScope, file.id),
      originalId: file.id,
      ownerScope: normalizedScope
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const loadRagFilesFromDB = async (
  scope = 'guest'
): Promise<RagFile[]> => {
  const normalizedScope = normalizeScope(scope);
  try {
    const db = await openRagDatabase();
    const stored = await new Promise<any[]>((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });

    const files = new Map<string, RagFile>();
    for (const entry of stored) {
      const isLegacyGuest = !entry?.ownerScope && normalizedScope === 'guest';
      if (!isLegacyGuest && entry?.ownerScope !== normalizedScope) continue;
      const originalId = String(entry?.originalId || entry?.id || '');
      if (
        !originalId ||
        typeof entry?.content !== 'string' ||
        entry.content.length > MAX_RAG_FILE_BYTES
      ) {
        continue;
      }
      const { ownerScope: _owner, originalId: _original, ...file } = entry;
      files.set(originalId, { ...file, id: originalId } as RagFile);
    }
    const bounded: RagFile[] = [];
    let totalBytes = 0;
    for (const file of files.values()) {
      const size = Math.max(0, Number(file.size) || file.content.length);
      if (
        bounded.length >= MAX_RAG_FILES ||
        totalBytes + size > MAX_RAG_TOTAL_BYTES
      ) {
        continue;
      }
      bounded.push({ ...file, size });
      totalBytes += size;
    }
    return bounded;
  } catch {
    return [];
  }
};

export const deleteRagFileFromDB = async (
  id: string,
  scope = 'guest'
): Promise<void> => {
  const normalizedScope = normalizeScope(scope);
  const db = await openRagDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(storageId(normalizedScope, id));
    if (normalizedScope === 'guest') store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const clearRagDB = async (scope = 'guest'): Promise<void> => {
  const normalizedScope = normalizeScope(scope);
  const db = await openRagDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const entry = cursor.value;
      const isLegacyGuest = !entry?.ownerScope && normalizedScope === 'guest';
      if (isLegacyGuest || entry?.ownerScope === normalizedScope) {
        cursor.delete();
      }
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};
