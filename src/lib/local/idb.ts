// A minimal promise wrapper over IndexedDB: one database, key-value object stores.
const DB = "chessfsrs";
const STORES = ["puzzles", "outbox", "kv"] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
    req.onsuccess = () => {
      // Safari may close an idle connection in the background: open a new one next time.
      req.result.onclose = req.result.onversionchange = () => { req.result.close(); dbp = null; };
      resolve(req.result);
    };
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error);
});

/** Every [key, value] pair of a store. */
export async function entries<T>(store: StoreName): Promise<[string, T][]> {
  const tx = (await db()).transaction(store, "readonly");
  const os = tx.objectStore(store);
  const [keys, values] = await Promise.all([os.getAllKeys(), os.getAll()].map((r) => new Promise<unknown[]>((res, rej) => { r.onsuccess = () => res(r.result as unknown[]); r.onerror = () => rej(r.error); })));
  return keys.map((k, i) => [String(k), values[i] as T]);
}

/** Apply puts (value) and deletes (undefined) to one store in one transaction. */
export async function write(store: StoreName, changes: [string, unknown | undefined][]): Promise<void> {
  if (changes.length === 0) return;
  const tx = (await db()).transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const [k, v] of changes) v === undefined ? os.delete(k) : os.put(v, k);
  await done(tx);
}

export async function clear(store: StoreName): Promise<void> {
  const tx = (await db()).transaction(store, "readwrite");
  tx.objectStore(store).clear();
  await done(tx);
}
