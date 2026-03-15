const DATABASE_NAME = "ai-portfolio";
const DATABASE_VERSION = 1;
const STORE_NAME = "app_kv";

type KvRecord<T> = {
  key: string;
  value: T;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }

  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });

  return databasePromise;
}

export async function readStoredValue<T>(key: string): Promise<T | null> {
  try {
    const database = await openDatabase();
    return await new Promise<T | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as KvRecord<T> | undefined;
        resolve(record ? record.value : null);
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
    });
  } catch {
    return null;
  }
}

export async function writeStoredValue<T>(key: string, value: T): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed."));

    store.put({ key, value } satisfies KvRecord<T>);
  });
}

export async function removeStoredValue(key: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB delete aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB delete failed."));

    store.delete(key);
  });
}
