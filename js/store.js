// store.js
// IndexedDB 封装：每个 conv_id 一个对象库
// 库内记录：{ id, type, name, content, ...meta, createdAt }
// 资产类型：txt / book / index-book / index-chapter / index-chunk / chat
//
// 关键设计：
// - 单例 db handle（页面生命周期内复用，避免反复 open/close）
// - 串行化队列（enqueue）：避免并发 transaction
// - 升级版本时由 ensureConvStore / deleteConvStore 动态告知 onupgradeneeded 要做什么

const DB_NAME = "web_novel_reader";
// ⚠️ 永远只增不减！浏览器里残留了 version=2 的旧库（v1+ 动态升级）
// 我们升到 3 拿到 onupgradeneeded 控制权，在里面清掉所有孤儿 store
const DB_VERSION = 3;

let _dbPromise = null;        // 单例 IDBDatabase
let _queueTail = Promise.resolve();
let _pendingUpgrade = null;   // { ver, toCreate: Set, toDelete: Set }

// ---------- 串行化 ----------
function enqueue(fn) {
  const job = _queueTail.then(fn, fn);
  _queueTail = job.catch(() => {});
  return job;
}

// ---------- DB 开关（带升级） ----------
function openDBWithPlan(version, plan) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // 基础 store 必建
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("conv_index")) {
        db.createObjectStore("conv_index", { keyPath: "id" });
      }
      // 清理旧的孤儿动态 store（除保留的固定 store 外，凡是形如 conv_xxx 的都删）
      // 之所以这样做：v2 时代代码会在运行中动态建 conv_xxx，
      // 但现在改用单对象库存全部资产，那些 conv_xxx 全部作废
      const keep = new Set(["meta", "conv_index"]);
      const orphanStores = Array.from(db.objectStoreNames).filter(n => !keep.has(n));
      for (const sid of orphanStores) {
        try { db.deleteObjectStore(sid); } catch (err) { /* 忽略 */ }
      }
      if (plan && plan.toCreate) {
        for (const sid of plan.toCreate) {
          if (!db.objectStoreNames.contains(sid)) {
            try { db.createObjectStore(sid, { keyPath: "id" }); } catch (err) {}
          }
        }
      }
      if (plan && plan.toDelete) {
        for (const sid of plan.toDelete) {
          if (db.objectStoreNames.contains(sid)) {
            try { db.deleteObjectStore(sid); } catch (err) {}
          }
        }
      }
    };
    req.onsuccess = () => {
      if (_pendingUpgrade && _pendingUpgrade.ver <= version) {
        _pendingUpgrade = null;
      }
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB 被阻塞，请关闭其他标签页后刷新"));
  });
}

async function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = openDBWithPlan(DB_VERSION, null).catch(err => {
    _dbPromise = null;
    throw err;
  });
  return _dbPromise;
}

// 动态为 convId 建 store（必要时升版本）
async function ensureConvStore(convId) {
  return enqueue(async () => {
    let db = await getDB();
    if (db.objectStoreNames.contains(convId)) return;
    // 关闭当前连接，升级 + 创建
    const newVer = db.version + 1;
    _pendingUpgrade = { ver: newVer, toCreate: new Set([convId]), toDelete: new Set() };
    db.close();
    _dbPromise = null;
    _dbPromise = openDBWithPlan(newVer, _pendingUpgrade);
    await _dbPromise;
  });
}

// 动态删除 convId 对应 store
async function dropConvStore(convId) {
  // 需要先在 conv_index 把 convId 删掉，再升版本删 store
  const db = await getDB();
  const newVer = db.version + 1;
  _pendingUpgrade = { ver: newVer, toCreate: new Set(), toDelete: new Set([convId]) };
  db.close();
  _dbPromise = null;
  _dbPromise = openDBWithPlan(newVer, _pendingUpgrade);
  return _dbPromise;
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

// ============================================================
// conv_index
// ============================================================

export function listConversations() {
  return enqueue(async () => {
    const db = await getDB();
    const t = tx(db, ["conv_index"]);
    const all = await promisifyReq(t.objectStore("conv_index").getAll());
    return (all || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  });
}

export function createConversation(conv) {
  return enqueue(async () => {
    const id = conv.id || ("conv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
    const now = Date.now();
    const record = {
      id,
      title: conv.title || "新对话",
      createdAt: now,
      updatedAt: now,
      defaultApiAlias: conv.defaultApiAlias || null,
      skill: conv.skill || "chat",
      lastSelection: conv.lastSelection || null,
    };
    await ensureConvStore(id);
    const db = await getDB();
    const t = tx(db, ["conv_index"], "readwrite");
    await promisifyReq(t.objectStore("conv_index").put(record));
    return record;
  });
}

export function updateConversation(convId, patch) {
  return enqueue(async () => {
    const db = await getDB();
    const t = tx(db, ["conv_index"], "readwrite");
    const cur = await promisifyReq(t.objectStore("conv_index").get(convId));
    if (cur) {
      Object.assign(cur, patch, { updatedAt: Date.now() });
      await promisifyReq(t.objectStore("conv_index").put(cur));
    }
    return cur;
  });
}

export function getConversation(convId) {
  return enqueue(async () => {
    const db = await getDB();
    const t = tx(db, ["conv_index"]);
    const r = await promisifyReq(t.objectStore("conv_index").get(convId));
    return r || null;
  });
}

export function deleteConversation(convId) {
  return enqueue(async () => {
    const db = await getDB();
    // 1) 清空内容 + 从 conv_index 删除
    const storeNames = [convId, "conv_index"].filter(n => db.objectStoreNames.contains(n));
    const t = tx(db, storeNames, "readwrite");
    if (db.objectStoreNames.contains(convId)) {
      await promisifyReq(t.objectStore(convId).clear());
    }
    await promisifyReq(t.objectStore("conv_index").delete(convId));
    // 2) 升版本删 store
    await dropConvStore(convId);
  });
}

export async function deleteConversations(convIds) {
  for (const id of convIds) {
    await deleteConversation(id);
  }
}

// ============================================================
// 资产
// ============================================================

export function addAsset(convId, asset) {
  return enqueue(async () => {
    await ensureConvStore(convId);
    const db = await getDB();
    const id = asset.id || (asset.type + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
    const record = { ...asset, id, createdAt: asset.createdAt || Date.now() };
    const t = tx(db, [convId], "readwrite");
    await promisifyReq(t.objectStore(convId).put(record));
    await touchConv(convId);
    return record;
  });
}

export function putAsset(convId, asset) {
  return enqueue(async () => {
    await ensureConvStore(convId);
    const db = await getDB();
    const record = { ...asset, createdAt: asset.createdAt || Date.now() };
    const t = tx(db, [convId], "readwrite");
    await promisifyReq(t.objectStore(convId).put(record));
    await touchConv(convId);
    return record;
  });
}

export function listAssets(convId) {
  return enqueue(async () => {
    await ensureConvStore(convId);
    const db = await getDB();
    const t = tx(db, [convId]);
    const all = await promisifyReq(t.objectStore(convId).getAll());
    return all || [];
  });
}

export function getAsset(convId, assetId) {
  return enqueue(async () => {
    await ensureConvStore(convId);
    const db = await getDB();
    const t = tx(db, [convId]);
    const r = await promisifyReq(t.objectStore(convId).get(assetId));
    return r || null;
  });
}

export function deleteAsset(convId, assetId) {
  return enqueue(async () => {
    await ensureConvStore(convId);
    const db = await getDB();
    const t = tx(db, [convId], "readwrite");
    await promisifyReq(t.objectStore(convId).delete(assetId));
    await touchConv(convId);
  });
}

async function touchConv(convId) {
  try {
    const db = await getDB();
    const t = tx(db, ["conv_index"], "readwrite");
    const cur = await promisifyReq(t.objectStore("conv_index").get(convId));
    if (cur) {
      cur.updatedAt = Date.now();
      await promisifyReq(t.objectStore("conv_index").put(cur));
    }
  } catch (e) {
    // 静默
  }
}

// ============================================================
// 容量
// ============================================================

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

export async function clearAll() {
  return enqueue(async () => {
    const db = await getDB();
    const t = tx(db, ["conv_index"], "readwrite");
    await promisifyReq(t.objectStore("conv_index").clear());
  });
}
