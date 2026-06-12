const DB_NAME = "vep-history";
const DB_VERSION = 1;
const STORE_META = "sessions";
const STORE_BLOBS = "blobs";
const MAX_SESSIONS = 5;

export type HistoryItem = {
  id: string;
  filename: string;
  sizeMB: number;
  mime: string;
};

export type HistorySession = {
  id: string;
  ts: number;
  op: string;
  opLabel: string;
  items: HistoryItem[];
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = key !== undefined ? tx.objectStore(store).put(value, key) : tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbClear(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(
  session: HistorySession,
  blobs: { itemId: string; blob: Blob }[]
): Promise<void> {
  const db = await openDB();
  // Prune oldest sessions if over limit
  const existing = await idbGetAll<HistorySession>(db, STORE_META);
  if (existing.length >= MAX_SESSIONS) {
    const sorted = [...existing].sort((a, b) => a.ts - b.ts);
    for (const old of sorted.slice(0, existing.length - MAX_SESSIONS + 1)) {
      await deleteSession(db, old.id, old.items.map(i => i.id));
    }
  }
  await idbPut(db, STORE_META, session);
  for (const { itemId, blob } of blobs) {
    await idbPut(db, STORE_BLOBS, blob, `${session.id}:${itemId}`);
  }
  db.close();
}

export async function loadSessions(): Promise<HistorySession[]> {
  const db = await openDB();
  const sessions = await idbGetAll<HistorySession>(db, STORE_META);
  db.close();
  return sessions.sort((a, b) => b.ts - a.ts);
}

export async function getBlob(sessionId: string, itemId: string): Promise<Blob | undefined> {
  const db = await openDB();
  const blob = await idbGet<Blob>(db, STORE_BLOBS, `${sessionId}:${itemId}`);
  db.close();
  return blob;
}

async function deleteSession(db: IDBDatabase, sessionId: string, itemIds: string[]): Promise<void> {
  await idbDelete(db, STORE_META, sessionId);
  for (const itemId of itemIds) {
    await idbDelete(db, STORE_BLOBS, `${sessionId}:${itemId}`).catch(() => {});
  }
}

export async function removeSession(sessionId: string, itemIds: string[]): Promise<void> {
  const db = await openDB();
  await deleteSession(db, sessionId, itemIds);
  db.close();
}

export async function clearAllHistory(): Promise<void> {
  const db = await openDB();
  await idbClear(db, STORE_META);
  await idbClear(db, STORE_BLOBS);
  db.close();
}
