// store.js
// IndexedDB 封装：每个 conv_id 一个对象库
// 库内记录：{ id, type, name, content, ...meta, createdAt }
// 资产类型：txt / book / index-book / index-chapter / index-chunk / chat

const DB_NAME = "web_novel_reader";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      // conv_index 存所有对话的元数据 + 容量估算
      if (!db.objectStoreNames.contains("conv_index")) {
        db.createObjectStore("conv_index", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function ensureConvStore(db, convId) {
  if (db.objectStoreNames.contains(convId)) return;
  // 动态创建对象库
  await new Promise((resolve, reject) => {
    const ver = db.version + 1;
    db.close();
    const req = indexedDB.open(DB_NAME, ver);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
      if (!d.objectStoreNames.contains("conv_index")) d.createObjectStore("conv_index", { keyPath: "id" });
      if (!d.objectStoreNames.contains(convId)) {
        d.createObjectStore(convId, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, stores, mode = "readonly") {
  return db.transaction(stores, mode);
}

function promisifyReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- conv_index 操作 ----------

export async function listConversations() {
  const db = await openDB();
  const t = tx(db, ["conv_index"]);
  const all = await promisifyReq(t.objectStore("conv_index").getAll());
  db.close();
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function createConversation(conv) {
  const db = await openDB();
  const id = conv.id || ("conv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
  const now = Date.now();
  const record = {
    id,
    title: conv.title || "新对话",
    createdAt: now,
    updatedAt: now,
    defaultApiAlias: conv.defaultApiAlias || null,
    skill: conv.skill || "chat",
    lastSelection: conv.lastSelection || null, // 资产勾选上下文快照
  };
  await ensureConvStore(db, id);
  const t = tx(db, ["conv_index"], "readwrite");
  await promisifyReq(t.objectStore("conv_index").put(record));
  db.close();
  return record;
}

export async function updateConversation(convId, patch) {
  const db = await openDB();
  const t = tx(db, ["conv_index"], "readwrite");
  const cur = await promisifyReq(t.objectStore("conv_index").get(convId));
  if (cur) {
    Object.assign(cur, patch, { updatedAt: Date.now() });
    await promisifyReq(t.objectStore("conv_index").put(cur));
  }
  db.close();
  return cur;
}

export async function getConversation(convId) {
  const db = await openDB();
  const t = tx(db, ["conv_index"]);
  const r = await promisifyReq(t.objectStore("conv_index").get(convId));
  db.close();
  return r || null;
}

// 删除整个对话（含其对象库）
export async function deleteConversation(convId) {
  const db = await openDB();
  await ensureConvStore(db, convId);
  // 先删所有记录
  const t = tx(db, [convId, "conv_index"], "readwrite");
  await promisifyReq(t.objectStore(convId).clear());
  await promisifyReq(t.objectStore("conv_index").delete(convId));
  // 删对象库
  await new Promise((resolve, reject) => {
    const ver = db.version + 1;
    db.close();
    const req = indexedDB.open(DB_NAME, ver);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (d.objectStoreNames.contains(convId)) d.deleteObjectStore(convId);
    };
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteConversations(convIds) {
  for (const id of convIds) {
    await deleteConversation(id);
  }
}

// ---------- 资产操作 ----------

export async function addAsset(convId, asset) {
  const db = await openDB();
  await ensureConvStore(db, convId);
  const id = asset.id || (asset.type + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
  const record = { id, createdAt: Date.now(), ...asset };
  const t = tx(db, [convId], "readwrite");
  await promisifyReq(t.objectStore(convId).put(record));
  await touchConv(db, convId);
  db.close();
  return record;
}

export async function putAsset(convId, asset) {
  // 强制覆盖（id 存在则更新）
  const db = await openDB();
  await ensureConvStore(db, convId);
  const record = { createdAt: Date.now(), ...asset };
  const t = tx(db, [convId], "readwrite");
  await promisifyReq(t.objectStore(convId).put(record));
  await touchConv(db, convId);
  db.close();
  return record;
}

export async function listAssets(convId) {
  const db = await openDB();
  await ensureConvStore(db, convId);
  const t = tx(db, [convId]);
  const all = await promisifyReq(t.objectStore(convId).getAll());
  db.close();
  return all;
}

export async function getAsset(convId, assetId) {
  const db = await openDB();
  await ensureConvStore(db, convId);
  const t = tx(db, [convId]);
  const r = await promisifyReq(t.objectStore(convId).get(assetId));
  db.close();
  return r || null;
}

export async function deleteAsset(convId, assetId) {
  const db = await openDB();
  await ensureConvStore(db, convId);
  const t = tx(db, [convId], "readwrite");
  await promisifyReq(t.objectStore(convId).delete(assetId));
  await touchConv(db, convId);
  db.close();
}

async function touchConv(db, convId) {
  try {
    const t = tx(db, ["conv_index"], "readwrite");
    const cur = await promisifyReq(t.objectStore("conv_index").get(convId));
    if (cur) {
      cur.updatedAt = Date.now();
      await promisifyReq(t.objectStore("conv_index").put(cur));
    }
  } catch (e) {
    // conv_index 可能尚未存在（首次写入前），忽略
  }
}

// ---------- 容量估算 ----------

export async function estimateStorage() {
  if (navigator.storage && navigator.storage.estimate) {
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 0 };
  }
  return { usage: 0, quota: 0 };
}

export async function computeConvSize(convId) {
  const assets = await listAssets(convId);
  let bytes = 0;
  for (const a of assets) {
    if (typeof a.content === "string") {
      bytes += new Blob([a.content]).size;
    } else if (a.content instanceof ArrayBuffer) {
      bytes += a.content.byteLength;
    } else if (a.content) {
      try { bytes += new Blob([JSON.stringify(a.content)]).size; } catch {}
    }
    if (a.fileIds && Array.isArray(a.fileIds)) {
      // book 资产引用其他 txt 资产，单独不重复计
    }
  }
  return { assets, bytes };
}

export function formatBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + " " + u[i];
}
