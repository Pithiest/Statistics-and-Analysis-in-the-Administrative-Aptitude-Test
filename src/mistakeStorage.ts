import type { MistakeNotebook } from "./mistakes";

const DB = "pithiest-xc-mistakes-v1";
const STORE = "notebooks";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("本机错题存储不可用，请保留备份。"));
  });
}

export async function readNotebook(key: string): Promise<MistakeNotebook | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error("本机错题读取失败，请重试。"));
    });
  } finally { db.close(); }
}

export async function writeNotebook(key: string, value: MistakeNotebook): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error("本机错题未能保存，请立即导出备份。"));
    });
  } finally { db.close(); }
}
