const DB_NAME = 'osone_memory_db';
const DB_VERSION = 1;
const STORE_NAME = 'memories';

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function getMemoryItem<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result !== undefined) {
          resolve(request.result as T);
        } else {
          // Fallback to localStorage on first load to migrate smoothly
          const localVal = localStorage.getItem(key);
          if (localVal !== null) {
            try {
              const parsed = JSON.parse(localVal);
              setMemoryItem(key, parsed);
              resolve(parsed as T);
              return;
            } catch {
              setMemoryItem(key, localVal);
              resolve(localVal as unknown as T);
              return;
            }
          }
          resolve(defaultValue);
        }
      };
      request.onerror = () => {
        const localVal = localStorage.getItem(key);
        if (localVal !== null) {
          try {
            resolve(JSON.parse(localVal) as T);
          } catch {
            resolve(localVal as unknown as T);
          }
        } else {
          resolve(defaultValue);
        }
      };
    });
  } catch (err) {
    console.error("Error accessing IndexedDB get:", err);
    const localVal = localStorage.getItem(key);
    if (localVal !== null) {
      try {
        return JSON.parse(localVal) as T;
      } catch {
        return localVal as unknown as T;
      }
    }
    return defaultValue;
  }
}

export async function setMemoryItem<T>(key: string, value: T): Promise<void> {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch (err) {
    console.warn("localStorage quota exceeded, relying solely on IndexedDB", err);
  }

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Error accessing IndexedDB set:", err);
  }
}

export async function deleteMemoryItemsByPrefix(prefix: string): Promise<void> {
  if (!/^osone_user_local_[A-Za-z0-9_-]{8,64}_$/.test(prefix)) {
    throw new Error('Prefixo de perfil local inválido.');
  }
  const userId = prefix.slice('osone_user_'.length, -1);
  const exactLocalKeys = new Set([
    `nash_memory_${userId}`,
    `nash_diary_${userId}`
  ]);

  const localKeys = Array.from(
    { length: localStorage.length },
    (_, index) => localStorage.key(index)
  ).filter(
    (key): key is string =>
      Boolean(key && (key.startsWith(prefix) || exactLocalKeys.has(key)))
  );
  localKeys.forEach((key) => localStorage.removeItem(key));

  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const keysRequest = store.getAllKeys();
      keysRequest.onsuccess = () => {
        keysRequest.result.forEach((key) => {
          if (typeof key === 'string' && key.startsWith(prefix)) {
            store.delete(key);
          }
        });
      };
      keysRequest.onerror = () => reject(keysRequest.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (err) {
    console.error('Error deleting profile memory:', err);
    throw err;
  }
}

export async function clearAllMemoryStores(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Error clearing IndexedDB:", err);
  }
}
