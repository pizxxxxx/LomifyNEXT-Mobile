import { get, type Writable } from 'svelte/store';

const DATABASE = 'LomifyNextState';
const TABLE = 'state';
const SMALL_JSON_LIMIT = 128 * 1024;
let database: Promise<IDBDatabase> | undefined;
const bindings = new Map<string, { ready: Promise<void>; flush: () => Promise<boolean> }>();
let lifecycleBound = false;

/** Storage failures must never escape a Svelte subscriber: that stalls all stores. */
export function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    return text === null ? fallback : JSON.parse(text);
  } catch { return fallback; }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(TABLE);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Storage upgrade blocked'));
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); database = undefined; };
        resolve(request.result);
      };
    }).catch(error => { database = undefined; throw error; });
  }
  return database;
}

async function readIndexed(key: string): Promise<string | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TABLE, 'readonly');
    const request = transaction.objectStore(TABLE).get(key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
}

async function writeIndexed(key: string, json: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TABLE, 'readwrite');
    transaction.objectStore(TABLE).put(json, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
}

/** Keep small legacy values in localStorage; migrate large values without deleting backups. */
export function bindStoredState<T>(key: string, store: Writable<T>, options: {
  restore?: (value: unknown) => T;
  mergeStartup?: (saved: T, current: T, initial: T) => T;
  onFailure?: () => void;
  delayMs?: number;
} = {}) {
  if (!lifecycleBound && typeof window !== 'undefined') {
    lifecycleBound = true;
    window.addEventListener('pagehide', () => { void flushStoredState(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) void flushStoredState(); });
  }
  let revision = 0, restoring = false, initialized = false, dirty = false;
  let indexed = false, first = true, reported = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<boolean> = Promise.resolve(true);
  const initial = options.mergeStartup ? JSON.parse(JSON.stringify(get(store))) as T : get(store);
  const failure = () => {
    if (!reported) {
      reported = true;
      try { options.onFailure?.(); } catch { /* A notice is never allowed to break storage. */ }
    }
  };
  const save = async (json: string): Promise<boolean> => {
    if (!indexed && json.length <= SMALL_JSON_LIMIT) {
      try { localStorage.setItem(key, json); reported = false; return true; }
      catch { /* Fall back to a different storage API, including for settings. */ }
    }
    if (typeof indexedDB !== 'undefined') {
      try {
        await writeIndexed(key, json);
        indexed = true;
        reported = false;
        return true;
      } catch { /* An unavailable database must not break navigation either. */ }
    }
    try { localStorage.setItem(key, json); reported = false; return true; }
    catch { failure(); return false; }
  };
  const schedule = () => {
    if (initialized && !timer) timer = setTimeout(() => { timer = undefined; void flush(); }, options.delayMs ?? 200);
  };
  store.subscribe(() => {
    if (first) { first = false; return; }
    if (restoring) return;
    revision++;
    dirty = true;
    schedule();
  });
  const ready = (async () => {
    if (typeof indexedDB !== 'undefined') {
      try {
        const json = await readIndexed(key);
        if (json !== undefined) {
          const value = JSON.parse(json);
          const restored = options.restore ? options.restore(value) : value as T;
          indexed = true;
          // A user's explicit edit during startup takes precedence over a delayed read.
          if (revision === 0 || options.mergeStartup) {
            restoring = true;
            try { store.set(revision === 0 ? restored : options.mergeStartup!(restored, get(store), initial)); }
            finally { restoring = false; }
          }
        } else if (JSON.stringify(get(store)).length > SMALL_JSON_LIMIT) dirty = true;
      } catch { /* Retain the legacy value if IndexedDB cannot be read. */ }
    }
    initialized = true;
    if (dirty) schedule();
  })();
  async function flush(): Promise<boolean> {
    await ready;
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (!dirty) return tail;
    let json: string;
    try { json = JSON.stringify(get(store)); }
    catch { failure(); return false; }
    dirty = false;
    // Serialize writes so an old transaction cannot overwrite the most recent import.
    tail = tail.then(() => save(json)).then(success => { if (!success) dirty = true; return success; });
    return tail;
  }
  const binding = { ready, flush };
  bindings.set(key, binding);
  return binding;
}

export async function waitForStoreStorage(): Promise<void> {
  await Promise.all([...bindings.values()].map(binding => binding.ready));
}

export async function flushStoredState(key?: string): Promise<boolean> {
  const selected = key ? [bindings.get(key)].filter(binding => !!binding) : [...bindings.values()];
  const results = await Promise.all(selected.map(binding => binding!.flush()));
  return results.every(Boolean);
}
