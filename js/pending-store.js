/**
 * The handoff store: files one page carries to the next tool, read once on
 * arrival and then emptied.
 *
 * smart-drop.js, landing-file-workspace.js and high-value-landing.js each wrote
 * this store through their own copy of the same three functions, and file-focus.js
 * read it through a fourth, so any change to its rules had to be made four times
 * to take effect. One module owns it now.
 */

const DB_NAME = 'irisfiles';
const STORE = 'pending';
const DEST_KEY = 'dest';

function normalize(path) {
  const trimmed = String(path).replace(/\/+$/, '');
  return trimmed || '/';
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Files sit under numeric keys and the destination under a string key, so both
// are read together and split by key. getAllKeys() and getAll() return in the
// same order, and issuing them back to back means no await lands between two
// requests of one transaction, which is what would let it go inactive.
function readEntries(store) {
  const keysReq = store.getAllKeys();
  const valuesReq = store.getAll();
  return () => {
    const keys = keysReq.result || [];
    const values = valuesReq.result || [];
    const files = [];
    let dest = null;
    keys.forEach((key, i) => {
      const value = values[i];
      if (key === DEST_KEY) dest = typeof value === 'string' ? value : null;
      else if (value) files.push(value);
    });
    return { files, dest };
  };
}

function settled(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Could not reach the handoff store.'));
  });
}

// A row written for another tool is not returned. The destination page is not
// guaranteed to load at all: the user may close the tab or navigate somewhere
// else first, and those files must not then appear in whatever page loads next.
function matchesThisPage(dest) {
  return !dest || dest === normalize(location.pathname);
}

export async function storePendingFiles(files, destination) {
  const selection = Array.from(files || []).filter(Boolean);
  if (!selection.length) return false;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    selection.forEach((file, index) => store.put(file, index));
    if (destination) store.put(normalize(new URL(destination, location.href).pathname), DEST_KEY);
    await settled(tx);
    return true;
  } finally {
    db.close();
  }
}

export async function clearPendingFiles() {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await settled(tx);
    } finally {
      db.close();
    }
  } catch { /* best effort */ }
}

/** Reads the store and empties it, whether or not the rows were meant for here. */
export async function takePendingFiles() {
  try {
    const db = await openDb();
    let collect;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      collect = readEntries(store);
      store.clear();
      await settled(tx);
    } finally {
      db.close();
    }
    const { files, dest } = collect();
    if (!files.length || !matchesThisPage(dest)) return null;
    return files;
  } catch { return null; }
}

/** Looks without consuming, for a page that only needs to show what is waiting. */
export async function peekPendingFiles() {
  try {
    const db = await openDb();
    let collect;
    try {
      const tx = db.transaction(STORE, 'readonly');
      collect = readEntries(tx.objectStore(STORE));
      await settled(tx);
    } finally {
      db.close();
    }
    const { files, dest } = collect();
    if (!files.length || !matchesThisPage(dest)) return [];
    return files;
  } catch { return []; }
}
