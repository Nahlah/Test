/* حفظ الإعدادات والمحاضر المرجعية والقوالب داخل المتصفح (IndexedDB)، مع بديل مؤقت في الذاكرة. */
"use strict";

const Store = (() => {
  const DB_NAME = "college_minutes_tool";
  const STORE = "kv";
  const memory = new Map();
  let dbPromise = null;
  let persistent = true;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        if (!window.indexedDB) { persistent = false; resolve(null); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { persistent = false; resolve(null); };
        req.onblocked = () => { persistent = false; resolve(null); };
      } catch (e) {
        persistent = false;
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function get(key) {
    const db = await open();
    if (!db) return memory.get(key);
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result === undefined ? memory.get(key) : req.result);
        req.onerror = () => resolve(memory.get(key));
      } catch (e) {
        resolve(memory.get(key));
      }
    });
  }

  async function set(key, value) {
    memory.set(key, value);
    const db = await open();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => { persistent = false; resolve(false); };
        tx.onabort = () => { persistent = false; resolve(false); };
      } catch (e) {
        // بعض المتصفحات لا تحفظ مقابض المجلدات؛ نحفظ في الذاكرة فقط.
        resolve(false);
      }
    });
  }

  async function del(key) {
    memory.delete(key);
    const db = await open();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  return { get, set, del, isPersistent: () => persistent };
})();
