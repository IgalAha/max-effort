// Tiny IndexedDB wrapper. Everything lives on the device; export/restore is the safety net.
const NAME = 'max-effort';
const STORES = { workouts: 'id', cardio: 'id', checkins: 'date', injuries: 'id', sleep: 'id', rhr: 'id', meta: 'key' };
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      for (const [s, k] of Object.entries(STORES)) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: k });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

export const db = {
  all: (s) => tx(s, 'readonly', (o) => o.getAll()),
  get: (s, k) => tx(s, 'readonly', (o) => o.get(k)),
  put: (s, v) => tx(s, 'readwrite', (o) => o.put(v)),
  putMany: (s, arr) => tx(s, 'readwrite', (o) => { arr.forEach((v) => o.put(v)); }),
  del: (s, k) => tx(s, 'readwrite', (o) => o.delete(k)),
  clear: (s) => tx(s, 'readwrite', (o) => o.clear()),
  async exportAll() {
    const out = { app: 'max-effort', version: 1, exportedAt: new Date().toISOString() };
    for (const s of Object.keys(STORES)) out[s] = await this.all(s);
    return out;
  },
  async importAll(data) {
    for (const s of Object.keys(STORES)) {
      if (!Array.isArray(data[s])) continue;
      await this.clear(s);
      await this.putMany(s, data[s]);
    }
  },
};

export async function getMeta(key, dflt) {
  const r = await db.get('meta', key);
  return r ? r.value : dflt;
}
export const setMeta = (key, value) => db.put('meta', { key, value });
