// ui.js
// ☰ 导航 / 资产库 / 聊天 / 存储管理 / 设置 渲染与事件

import * as Store from "./store.js";
import * as Settings from "./settings.js";
import { callByAlias, getRateLimiterStatus, callLLMOnce, callLLM } from "./api.js";
import { runIndex } from "./indexer.js";
import { readTextFromFile, detectChapters, chunkByChar } from "./split.js";
// 状态
const state = {
  convId: null,
  skill: "chat", // "chat" | "indexer"
  apiAlias: null,
  abortCtrl: null,
  selectedAssetIds: new Set(),
  selectedChapterRanges: new Map(), // assetId -> [{from,to}]
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// =================== 启动 ===================

export async function boot() {
  // 加载默认设置
  const def = Settings.getDefaults();
  const apis = Settings.listApis();
  if (def.defaultApiAlias && apis.find(a => a.alias === def.defaultApiAlias)) {
    state.apiAlias = def.defaultApiAlias;
  } else if (apis.length > 0) {
    state.apiAlias = apis[0].alias;
  }

  // 创建或恢复对话
  const list = await Store.listConversations();
  let cur = list[0];
  if (!cur) {
    cur = await Store.createConversation({ title: "新对话" });
  }
  state.convId = cur.id;

  bindGlobalUI();
  renderAll();
  tickRateLimiter();
  setInterval(tickRateLimiter, 2000);
}

function bindGlobalUI() {
  // ☰ 抽屉
  $("#menuBtn").onclick = () => $("#drawer").classList.toggle("open");
  $("#drawerClose").onclick = () => $("#drawer").classList.remove("open");
  $("#drawer").onclick = (e) => { if (e.target.id === "drawer") $("#drawer").classList.remove("open"); };

  $("#newConvBtn").onclick = async () => {
    const c = await Store.createConversation({ title: "新对话" + (new Date()).toLocaleTimeString() });
    state.convId = c.id;
    state.selectedAssetIds.clear();
    state.selectedChapterRanges.clear();
    renderAll();
    $("#drawer").classList.remove("open");
  };

  $("#settingsBtn").onclick = () => { renderSettings(); openModal("settingsModal"); };
  $("#storageBtn").onclick = () => { renderStorage(); openModal("storageModal"); };
  $("#historyBtn").onclick = () => { renderHistory(); $("#drawer").classList.remove("open"); };

  // 技能切换
  $$(".skill-tab").forEach(el => {
    el.onclick = () => {
      state.skill = el.dataset.skill;
      $$(".skill-tab").forEach(t => t.classList.toggle("active", t.dataset.skill === state.skill));
      renderMain();
    };
  });

  // 模型下拉
  $("#modelSelect").onchange = (e) => { state.apiAlias = e.target.value; };

  // 上传 TXT
  $("#fileInput").onchange = (e) => onUploadFiles(e.target.files);
  $("#dropZone").ondragover = (e) => { e.preventDefault(); $("#dropZone").classList.add("hover"); };
  $("#dropZone").ondragleave = () => $("#dropZone").classList.remove("hover");
  $("#dropZone").ondrop = (e) => {
    e.preventDefault();
    $("#dropZone").classList.remove("hover");
    onUploadFiles(e.dataTransfer.files);
  };

  // 索引模式
  $("#modeSelect").onchange = () => {};
  $("#startIndexBtn").onclick = () => startIndexing();

  // 合并书
  $("#mergeBookBtn").onclick = () => mergeSelectedIntoBook();

  // 聊天
  $("#sendBtn").onclick = () => sendChat();
  $("#chatInput").onkeydown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChat(); }
  };
  $("#abortBtn").onclick = () => { if (state.abortCtrl) state.abortCtrl.abort(); };

  // 设置 / 存储 Modal 关闭
  $$("[data-close]").forEach(el => el.onclick = () => closeModal(el.dataset.close));

  // 设置：新增 API
  $("#addApiBtn").onclick = () => addApiFromForm();
  $("#importJsonBtn").onclick = () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json";
    inp.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          // 期望格式：{ apis: [...], chat: [...] }
          if (data.apis) {
            for (const a of data.apis) Settings.saveApi(a);
          }
          if (data.chats) {
            (async () => {
              for (const c of data.chats) {
                const conv = await Store.createConversation({ title: c.title || "导入对话" });
                for (const a of (c.assets || [])) {
                  await Store.addAsset(conv.id, { ...a, convId: conv.id });
                }
              }
              renderAll();
            })();
          }
        } catch (e) { alert("导入失败：" + e.message); }
      };
      r.readAsText(f);
    };
    inp.click();
  };
  $("#exportJsonBtn").onclick = exportAllAsJson;
  $("#clearAllBtn").onclick = clearAll;

  // 默认值保存
  $("#saveDefaultsBtn").onclick = () => {
    Settings.saveDefaults({
      defaultApiAlias: $("#defaultApiAlias").value || null,
      chunkSize: parseInt($("#chunkSize").value, 10) || 1500,
      maxConcurrency: parseInt($("#maxConcurrency").value, 10) || 3,
      splitPattern: $("#splitPattern").value.trim() || null,
    });
    flash("已保存默认值");
  };
}

function tickRateLimiter() {
  const s = getRateLimiterStatus();
  $("#rateStat").textContent = `令牌桶：${s.tokens} / ${s.capacity}`;
}

// =================== 渲染 ===================

async function renderAll() {
  renderHistory();
  renderApiSelect();
  renderAssets();
  renderMain();
  renderStorage();
}

function renderApiSelect() {
  const apis = Settings.listApis();
  const sel = $("#modelSelect");
  sel.innerHTML = "";
  if (apis.length === 0) {
    sel.innerHTML = `<option value="">(请先在「设置」添加 API)</option>`;
    state.apiAlias = null;
    return;
  }
  for (const a of apis) {
    const opt = document.createElement("option");
    opt.value = a.alias;
    opt.textContent = `${a.alias} · ${a.model}`;
    sel.appendChild(opt);
  }
  if (!apis.find(a => a.alias === state.apiAlias)) state.apiAlias = apis[0].alias;
  sel.value = state.apiAlias;
}

async function renderHistory() {
  const list = await Store.listConversations();
  const wrap = $("#historyList");
  wrap.innerHTML = "";
  if (list.length === 0) {
    wrap.innerHTML = `<div class="muted">暂无历史对话</div>`;
    return;
  }
  for (const c of list) {
    const row = document.createElement("div");
    row.className = "conv-row" + (c.id === state.convId ? " active" : "");
    row.innerHTML = `
      <label class="check"><input type="checkbox" data-cid="${c.id}"></label>
      <div class="conv-info">
        <div class="conv-title">${escapeHtml(c.title)}</div>
        <div class="conv-meta">${new Date(c.updatedAt).toLocaleString()}</div>
      </div>
    `;
    row.querySelector(".conv-info").onclick = () => {
      state.convId = c.id;
      state.selectedAssetIds.clear();
      state.selectedChapterRanges.clear();
      renderAll();
      $("#drawer").classList.remove("open");
    };
    wrap.appendChild(row);
  }
  $("#deleteSelectedConvBtn").onclick = async () => {
    const ids = $$("#historyList input:checked").map(i => i.dataset.cid);
    if (ids.length === 0) return flash("请先勾选要删除的对话");
    if (!confirm(`确认删除 ${ids.length} 个对话？此操作不可恢复。`)) return;
    await Store.deleteConversations(ids);
    if (ids.includes(state.convId)) {
      const rest = await Store.listConversations();
      if (rest.length > 0) state.convId = rest[0].id;
      else {
        const nc = await Store.createConversation({ title: "新对话" });
        state.convId = nc.id;
      }
    }
    renderAll();
  };
}

async function renderAssets() {
  const list = await Store.listAssets(state.convId);
  const wrap = $("#assetList");
  wrap.innerHTML = "";
  if (list.length === 0) {
    wrap.innerHTML = `<div class="muted">还没有资产。在上方上传 TXT，或先在「设置」配置 API。</div>`;
    return;
  }
  // 排序：txt / book 在前，index 在后
  const order = { txt: 0, book: 1, "index-book": 2, "index-chapter": 3, "index-chunk": 4, chat: 5 };
  list.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.name.localeCompare(b.name));
  for (const a of list) {
    const row = document.createElement("div");
    row.className = "asset-row";
    const size = a.content ? new Blob([a.content]).size : 0;
    const tagMap = { txt: "TXT", book: "BOOK", "index-book": "📚", "index-chapter": "📄", "index-chunk": "🔹", chat: "💬" };
    const tag = tagMap[a.type] || a.type;
    const checked = state.selectedAssetIds.has(a.id) ? "checked" : "";
    row.innerHTML = `
      <label class="check"><input type="checkbox" data-aid="${a.id}" ${checked}></label>
      <div class="asset-info">
        <div class="asset-name"><span class="tag">${tag}</span> ${escapeHtml(a.name)}</div>
        <div class="asset-meta">${formatSize(size)}${a.encoding ? " · " + a.encoding : ""}${a.bookId ? " · 归属书：" + a.bookId.slice(0,12) : ""}</div>
      </div>
      <div class="asset-actions">
        ${a.type === "book" ? `<button class="btn-mini" data-act="view" data-aid="${a.id}">查看</button>` : ""}
        ${a.type && a.type.startsWith("index-") ? `<button class="btn-mini" data-act="view" data-aid="${a.id}">查看</button>` : ""}
        <button class="btn-mini" data-act="copy" data-aid="${a.id}">复制</button>
        <button class="btn-mini danger" data-act="del" data-aid="${a.id}">删除</button>
      </div>
    `;
    wrap.appendChild(row);
  }
  // 事件
  wrap.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.onchange = () => {
      const id = cb.dataset.aid;
      if (cb.checked) state.selectedAssetIds.add(id); else state.selectedAssetIds.delete(id);
      updateSelectedPreview();
    };
  });
  wrap.querySelectorAll("button[data-act]").forEach(btn => {
    btn.onclick = () => handleAssetAction(btn.dataset.act, btn.dataset.aid);
  });
  updateSelectedPreview();
}

function updateSelectedPreview() {
  const ids = Array.from(state.selectedAssetIds);
  $("#selectedSummary").textContent = ids.length === 0 ? "（未选）" : `已选 ${ids.length} 项`;
}

async function handleAssetAction(act, aid) {
  const a = await Store.getAsset(state.convId, aid);
  if (!a) return;
  if (act === "del") {
    if (!confirm(`确认删除资产「${a.name}」？`)) return;
    await Store.deleteAsset(state.convId, aid);
    state.selectedAssetIds.delete(aid);
    renderAll();
  } else if (act === "view") {
    showAssetContent(a);
  } else if (act === "copy") {
    const c = a.content || "";
    try {
      await navigator.clipboard.writeText(c);
      flash("已复制到剪贴板");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = c; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      flash("已复制（fallback）");
    }
  }
}

async function showAssetContent(a) {
  $("#viewerTitle").textContent = a.name;
  $("#viewerBody").textContent = a.content || "(空)";
  $("#viewerMeta").textContent = `${a.type} · ${formatSize(new Blob([a.content || ""]).size)}`;
  openModal("viewerModal");
}

function renderMain() {
  // 顶栏：模型
  renderApiSelect();
  // 区段
  $$(".skill-tab").forEach(t => t.classList.toggle("active", t.dataset.skill === state.skill));
  if (state.skill === "indexer") {
    $("#indexerPanel").style.display = "";
    $("#chatPanel").style.display = "none";
    renderIndexerPanel();
  } else {
    $("#indexerPanel").style.display = "none";
    $("#chatPanel").style.display = "";
    renderChatPanel();
  }
}

async function renderIndexerPanel() {
  // 选书
  const assets = await Store.listAssets(state.convId);
  const books = assets.filter(a => a.type === "book");
  const sel = $("#bookSelect");
  sel.innerHTML = "";
  if (books.length === 0) {
    sel.innerHTML = `<option value="">(请先上传 TXT 并合并为「书」)</option>`;
    $("#startIndexBtn").disabled = true;
  } else {
    for (const b of books) {
      const opt = document.createElement("option");
      opt.value = b.id; opt.textContent = b.name;
      sel.appendChild(opt);
    }
    $("#startIndexBtn").disabled = false;
  }
}

async function renderChatPanel() {
  const list = await Store.listAssets(state.convId);
  const chatMsgs = list.filter(a => a.type === "chat").sort((a, b) => a.createdAt - b.createdAt);
  const wrap = $("#chatMsgs");
  wrap.innerHTML = "";
  if (chatMsgs.length === 0) {
    wrap.innerHTML = `<div class="muted">开始对话吧。勾选左侧资产作为上下文，或直接发问。</div>`;
  } else {
    for (const m of chatMsgs) {
      const div = document.createElement("div");
      div.className = "msg " + m.role;
      div.innerHTML = `<div class="msg-role">${m.role === "user" ? "我" : "AI"}</div><div class="msg-body">${escapeHtml(m.content)}</div>`;
      wrap.appendChild(div);
    }
    wrap.scrollTop = wrap.scrollHeight;
  }
}

// =================== 上传 ===================

async function onUploadFiles(fileList) {
  const files = Array.from(fileList).filter(f => /\.(txt|md)$/i.test(f.name) || f.type.startsWith("text/"));
  if (files.length === 0) { flash("仅支持 .txt / .md"); return; }
  for (const f of files) {
    if (f.size > 100 * 1024 * 1024) { flash(`文件 ${f.name} 超过 100MB，跳过`); continue; }
    try {
      const { text, encoding, size, name } = await readTextFromFile(f);
      const id = "txt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      await Store.addAsset(state.convId, {
        id, type: "txt", name, content: text, encoding, size, createdAt: Date.now(),
      });
    } catch (e) {
      flash("读取失败：" + f.name + " " + e.message);
    }
  }
  renderAll();
}

async function mergeSelectedIntoBook() {
  const assets = await Store.listAssets(state.convId);
  const txts = assets.filter(a => a.type === "txt" && state.selectedAssetIds.has(a.id));
  if (txts.length < 2) { flash("请先勾选 2 个或以上 TXT（同一本书的多卷）"); return; }
  // 排序：按 name 自然序（上/中/下、1/2/3）
  txts.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
  const baseName = (txts[0].name.replace(/\.(txt|md)$/i, "").replace(/[\s_-]+(上|中|下|vol\.?\s*\d+|\d+)$/i, ""));
  const bookName = prompt("请输入书名（合并后）", baseName);
  if (!bookName) return;
  const id = "book_" + Date.now();
  await Store.addAsset(state.convId, {
    id, type: "book", name: bookName, fileIds: txts.map(t => t.id), createdAt: Date.now(),
  });
  flash(`已合并为「${bookName}」`);
  renderAll();
}

// =================== 索引 ===================

async function startIndexing() {
  if (!state.apiAlias) { flash("请先在「设置」配置 API"); return; }
  const apiCfg = Settings.getApi(state.apiAlias);
  if (!apiCfg) { flash("API 配置缺失"); return; }
  const bookId = $("#bookSelect").value;
  if (!bookId) return;
  const book = await Store.getAsset(state.convId, bookId);
  if (!book) return;
  const mode = $("#modeSelect").value;
  state.abortCtrl = new AbortController();
  $("#startIndexBtn").disabled = true;
  $("#abortBtn").style.display = "";
  $("#progressWrap").style.display = "";
  $("#progressText").textContent = "准备中…";
  $("#progressBar").style.width = "0%";
  const log = (lvl, msg) => {
    const el = $("#indexLog");
    el.style.display = "";
    const t = new Date().toLocaleTimeString();
    el.textContent += `[${t}] ${lvl === "error" ? "❌" : "ℹ️"} ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  };
  try {
    const result = await runIndex({
      mode, apiCfg, bookAsset: book, signal: state.abortCtrl.signal, log,
      onProgress: (p) => {
        if (p.phase === "split") { $("#progressText").textContent = p.title; }
        else if (p.phase === "chapter") {
          $("#progressText").textContent = `章节 ${p.current}/${p.total}：${p.title}`;
          $("#progressBar").style.width = (p.current / p.total * 100).toFixed(1) + "%";
        } else if (p.phase === "chunk") {
          $("#progressText").textContent = `章节 ${p.chapter}/${p.total||"?"} 块 ${p.chunk}/${p.chunkTotal}：${p.title}`;
        } else if (p.phase === "book" || p.phase === "book-merge") {
          $("#progressText").textContent = `全书总结（${p.phase}）`;
        }
      },
    });
    if (result.aborted) log("info", "已取消");
    else log("info", "✅ 索引完成");
  } catch (e) {
    log("error", e.message);
  } finally {
    state.abortCtrl = null;
    $("#startIndexBtn").disabled = false;
    $("#abortBtn").style.display = "none";
    renderAll();
  }
}

// =================== 聊天 ===================

async function sendChat() {
  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  if (!state.apiAlias) { flash("请先在「设置」配置 API"); return; }
  const apiCfg = Settings.getApi(state.apiAlias);
  if (!apiCfg) { flash("API 配置缺失"); return; }

  // 收集上下文
  const ctxParts = [];
  if (state.selectedAssetIds.size > 0) {
    for (const aid of state.selectedAssetIds) {
      const a = await Store.getAsset(state.convId, aid);
      if (!a) continue;
      let content = a.content || "";
      // 若选了 txt，可能很长：按字符截取 + 标注
      if (a.type === "txt" && content.length > 6000) {
        content = content.slice(0, 6000) + "\n\n[…原文过长，已截取…]";
      }
      ctxParts.push(`【${a.name}】\n${content}`);
    }
  }
  // 拉历史
  const all = await Store.listAssets(state.convId);
  const hist = all.filter(a => a.type === "chat").sort((a, b) => a.createdAt - b.createdAt).slice(-20);
  const messages = [];
  if (ctxParts.length > 0) {
    messages.push({ role: "system", content: "以下是从用户资产库中选取的上下文，请结合回答用户问题：\n\n" + ctxParts.join("\n\n---\n\n") });
  }
  for (const m of hist) messages.push({ role: m.role, content: m.content });
  messages.push({ role: "user", content: text });

  // 写 user 消息
  const userMsg = await Store.addAsset(state.convId, {
    id: "chat_" + Date.now() + "_u", type: "chat", role: "user", content: text, createdAt: Date.now(),
  });
  input.value = "";
  renderChatPanel();

  // AI 回复（流式）
  state.abortCtrl = new AbortController();
  $("#sendBtn").disabled = true;
  $("#abortBtn").style.display = "";

  // 先插入占位
  const wrap = $("#chatMsgs");
  const placeholder = document.createElement("div");
  placeholder.className = "msg ai streaming";
  placeholder.innerHTML = `<div class="msg-role">AI</div><div class="msg-body"></div>`;
  wrap.appendChild(placeholder);
  wrap.scrollTop = wrap.scrollHeight;
  const body = placeholder.querySelector(".msg-body");

  let full = "";
  await callLLM(apiCfg, messages, {
    signal: state.abortCtrl.signal,
    onToken: (t) => { full += t; body.textContent = full; wrap.scrollTop = wrap.scrollHeight; },
    onDone: async () => {
      await Store.addAsset(state.convId, {
        id: "chat_" + Date.now() + "_a", type: "chat", role: "assistant", content: full, createdAt: Date.now(),
      });
      placeholder.classList.remove("streaming");
      renderAssets(); // 资产库也会出现 chat
    },
    onError: async (e) => {
      body.textContent = "（生成失败）" + e.message;
      placeholder.classList.add("error");
    },
  });

  state.abortCtrl = null;
  $("#sendBtn").disabled = false;
  $("#abortBtn").style.display = "none";
}

// =================== 设置 ===================

function renderSettings() {
  const apis = Settings.listApis();
  const def = Settings.getDefaults();
  const list = $("#apiList");
  list.innerHTML = "";
  if (apis.length === 0) {
    list.innerHTML = `<div class="muted">还没有 API 配置，添加一组开始。</div>`;
  }
  for (const a of apis) {
    const row = document.createElement("div");
    row.className = "api-row";
    row.innerHTML = `
      <div class="api-head">
        <strong>${escapeHtml(a.alias)}</strong>
        <span class="muted">${escapeHtml(a.model)} · ${escapeHtml(a.base_url)}</span>
        <button class="btn-mini danger" data-alias="${escapeAttr(a.alias)}" data-act="del">删除</button>
      </div>
      <div class="api-key">key: ${"•".repeat(Math.min(12, (a.api_key || "").length))}（明文存于本浏览器）</div>
    `;
    row.querySelector("button").onclick = () => {
      if (confirm(`删除 API「${a.alias}」？`)) {
        Settings.deleteApi(a.alias);
        renderSettings();
        renderApiSelect();
      }
    };
    list.appendChild(row);
  }
  $("#defaultApiAlias").value = def.defaultApiAlias || "";
  $("#chunkSize").value = def.chunkSize;
  $("#maxConcurrency").value = def.maxConcurrency;
  $("#splitPattern").value = def.splitPattern || "";
}

function addApiFromForm() {
  const alias = $("#apiAlias").value.trim();
  const base_url = $("#apiBaseUrl").value.trim();
  const api_key = $("#apiKey").value.trim();
  const model = $("#apiModel").value.trim();
  if (!alias || !base_url || !api_key || !model) { flash("请填写完整"); return; }
  Settings.saveApi({ alias, base_url, api_key, model });
  $("#apiAlias").value = ""; $("#apiBaseUrl").value = ""; $("#apiKey").value = ""; $("#apiModel").value = "";
  renderSettings(); renderApiSelect();
  flash("已保存");
}

// =================== 存储管理 ===================

async function renderStorage() {
  const { usage, quota } = await Store.estimateStorage();
  $("#storageTotal").textContent = `${Store.formatBytes(usage)} / ${Store.formatBytes(quota)}（浏览器配额）`;
  const list = await Store.listConversations();
  const wrap = $("#storageList");
  wrap.innerHTML = "";
  for (const c of list) {
    const { bytes, assets } = await Store.computeConvSize(c.id);
    const row = document.createElement("div");
    row.className = "storage-row";
    row.innerHTML = `
      <label class="check"><input type="checkbox" data-cid="${c.id}"></label>
      <div class="storage-info">
        <div class="storage-title">${escapeHtml(c.title)}</div>
        <div class="storage-meta">${assets.length} 项资产 · ${Store.formatBytes(bytes)} · ${new Date(c.updatedAt).toLocaleString()}</div>
      </div>
      <button class="btn-mini danger" data-cid="${c.id}" data-act="del">删除</button>
    `;
    row.querySelector("button").onclick = async () => {
      if (!confirm(`确认删除对话「${c.title}」？`)) return;
      await Store.deleteConversation(c.id);
      if (c.id === state.convId) {
        const rest = await Store.listConversations();
        state.convId = rest[0]?.id || (await Store.createConversation({ title: "新对话" })).id;
      }
      renderAll();
    };
    wrap.appendChild(row);
  }
  $("#delSelectedStorageBtn").onclick = async () => {
    const ids = $$("#storageList input:checked").map(i => i.dataset.cid);
    if (ids.length === 0) return flash("请先勾选");
    if (!confirm(`确认删除 ${ids.length} 个对话？`)) return;
    await Store.deleteConversations(ids);
    renderAll();
  };
  $("#exportIndexBtn").onclick = () => downloadAllIndexesAsZip(state.convId);
  }

// =================== 导入/导出/清空 ===================

async function exportAllAsJson() {
  const list = await Store.listConversations();
  const payload = { apis: Settings.listApis(), chats: [] };
  for (const c of list) {
    const assets = await Store.listAssets(c.id);
    payload.chats.push({
      title: c.title,
      assets: assets.map(a => ({ ...a })),
    });
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `web_novel_reader_backup_${Date.now()}.json`);
  flash("已导出 JSON");
}

// 用浏览器原生 CompressionStream 把所有 index 资产打成 .tar.gz 风格（简化为 zip-free：直接合并多文件下载）
export async function downloadAllIndexesAsZip(convId) {
  const assets = await Store.listAssets(convId);
  const indexes = assets.filter(a => a.type && a.type.startsWith("index-"));
  if (indexes.length === 0) { flash("没有可导出的索引资产"); return; }
  // 简单做法：每个 index 一个文件下载（浏览器批量下载限制多）
  // 提供单文件合并下载：合并为一个大 .md
  const merged = indexes.map(a => `\n\n# ${a.name}\n\n${a.content || ""}`).join("\n\n---\n\n");
  const blob = new Blob([merged], { type: "text/markdown" });
  downloadBlob(blob, `index_export_${convId}_${Date.now()}.md`);
  flash(`已导出 ${indexes.length} 个索引到一个 .md`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function clearAll() {
  if (!confirm("确认清空全部数据（对话 / 资产 / API 配置）？此操作不可恢复。")) return;
  const list = await Store.listConversations();
  await Store.deleteConversations(list.map(c => c.id));
  Settings.saveDefaults({ defaultApiAlias: null });
  localStorage.removeItem("wnr_apis");
  const nc = await Store.createConversation({ title: "新对话" });
  state.convId = nc.id;
  state.apiAlias = null;
  renderAll();
  flash("已清空");
}

// =================== Modal / 工具 ===================

function openModal(id) { $("#" + id).classList.add("open"); }
function closeModal(id) { $("#" + id).classList.remove("open"); }

function flash(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

function formatSize(n) { return Store.formatBytes(n); }
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function escapeAttr(s) { return escapeHtml(s); }
