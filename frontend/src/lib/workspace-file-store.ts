import type { LocalAttachment } from "../types/report";

const DATABASE_NAME = "ai-portfolio-workspace-v2";
const DATABASE_VERSION = 1;
const STORE_NAME = "workspace_local_files";

type StoredLocalFileRecord = {
  content_key: string;
  file: LocalAttachment;
  updated_at: string;
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
        database.createObjectStore(STORE_NAME, { keyPath: "content_key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open local workspace file store."));
  });
  return databasePromise;
}

export class WorkspaceFileStore {
  async put(contentKey: string, file: LocalAttachment): Promise<void> {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Local file write failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local file write aborted."));
      store.put({
        content_key: contentKey,
        file,
        updated_at: new Date().toISOString(),
      } satisfies StoredLocalFileRecord);
    });
  }

  async get(contentKey: string): Promise<LocalAttachment | null> {
    try {
      const database = await openDatabase();
      return await new Promise<LocalAttachment | null>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(contentKey);
        request.onsuccess = () => {
          const record = request.result as StoredLocalFileRecord | undefined;
          resolve(record?.file ?? null);
        };
        request.onerror = () => reject(request.error ?? new Error("Local file read failed."));
      });
    } catch {
      return null;
    }
  }

  async has(contentKey: string): Promise<boolean> {
    try {
      const database = await openDatabase();
      return await new Promise<boolean>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count(IDBKeyRange.only(contentKey));
        request.onsuccess = () => resolve((request.result ?? 0) > 0);
        request.onerror = () => reject(request.error ?? new Error("Local file existence check failed."));
      });
    } catch {
      return false;
    }
  }
}
