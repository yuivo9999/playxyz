// ui.js
// 移动端极简 UI：
// 顶栏：[☰] [标题] [📚] [＋]
// 主区：聊天消息流
// 底栏：[＋上传] [模型选择] [输入框] [发送]
// 侧滑：左侧设置抽屉 / 右侧资产库抽屉
// 模型下拉：点击底部模型按钮弹出

import * as Store from "./store.js";
import * as Settings from "./settings.js";
import { callLLM } from "./api.js";
import { readTextFromFile } from "./split.js";
import { runIndex } from "./indexer.js";

const state = {
  convId: null,
  apiAlias: null,
  abortCtrl: null,
  selectedAssetIds: new Set(),
};

// ============== 启动 ==============
export async function boot() {
  // 加载默认 API
  const def = Settings.getDefaults();
  const apis = Settings.listApis();
  if (def.defaultApiAlias && apis.find(a => a.alias === def.defaultApiAlias)) {
    state.apiAlias = def.defaultApiAlias;
  } else if (apis.length > 0) {
    state.apiAlias = apis[0].alias;
  }
  // 加载默认参数到表单
  $("#chunkSize").value = def.chunkSize || 1500;
  $("#maxConcurrency").value = def.maxConcurrency || 3;
  $("#splitPattern").value = def.splitPattern || "";
  updateModelButton();
  // 加载/创建对话
  const list = await Store.listConversations();
  let cur = list[0];
  if (!cur) cur = await Store.createConversation({ title: "新对话" });
  await switchConv(cur.id, false);
  await renderAll();
}

async function switchConv(convId, closeDrawer = true) {
  state.convId = convId;
  state.selectedAssetIds.clear();
  const conv = await Store.getConversation(convId);
  $("#convTitle").textContent = conv ? conv.title : "新对话";
  if (closeDrawer) closeDrawerPanels();
  await renderAll();
}

// ============== 渲染 ==============
async function renderAll() {
  await renderHistory();
  await renderChat();
  await renderAssets();
}

async function renderHistory() {
  const list = await Store.listConversations();
  const wrap = $("#historyList");
  wrap.innerHTML = "";
  if (list.length === 0) {
    wrap.innerHTML = `<div class="muted small" style="padding:6px">暂无对话</div>`;
    return;
  }
  for (const c of list) {
    const row = document.createElement("div");
    row.className = "conv-row" + (c.id === state.convId ? " active" : "");
    row.innerHTML = `
      <div class="conv-info">
        <div class="conv-title">${escapeHtml(c.title)}</div>
        <div class="conv-meta">${new Date(c.updatedAt).toLocaleString()}</div>
      </div>
      <button class="btn-mini danger" data-del-conv="${c.id}">删</button>
    `;
    row.querySelector(".conv-info").onclick = () => switchConv(c.id);
    row.querySelector("[data-del-conv]").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`确认删除「${c.title}」？`)) return;
      await Store.deleteConversation(c.id);
      if (state.convId === c.id) {
        const rest = await Store.listConversations();
        const next = rest[0] || await Store.createConversation({ title: "新对话" });
        await switchConv(next.id, false);
      } else {
        await renderHistory();
      }
    };
    wrap.appendChild(row);
  }
}

async function renderChat() {
  if (!state.convId) return;
  const assets = await Store.listAssets(state.convId);
  const msgs = assets
    .filter(a => a.type === "chat")
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const wrap = $("#chatMsgs");
  wrap.innerHTML = "";
  if (msgs.length === 0) {
    wrap.innerHTML = `<div class="empty-hint">开始对话吧。<br>点击左下角 <strong>＋</strong> 上传小说作为上下文。</div>`;
    return;
  }
  for (const m of msgs) {
    const div = document.createElement("div");
    div.className = "msg " + m.role;
    div.innerHTML = `<div class="msg-role">${m.role === "user" ? "我" : "AI"}</div>${escapeHtml(m.content)}`;
    wrap.appendChild(div);
  }
  wrap.scrollTop = wrap.scrollHeight;
}

async function renderAssets() {
  if (!state.convId) return;
  const list = await Store.listAssets(state.convId);
  const wrap = $("#assetList");
  wrap.innerHTML = "";
  if (list.length === 0) {
    wrap.innerHTML = `<div class="muted small" style="padding:6px">还没有资产。拖拽 TXT 进来或点击下方「＋」上传。</div>`;
    return;
  }
  const order = { txt: 0, book: 1, "index-book": 2, "index-chapter": 3, "index-chunk": 4, chat: 5 };
  list.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.name.localeCompare(b.name));
  for (const a of list) {
    const row = document.createElement("div");
    row.className = "asset-row";
    const tagMap = { txt: "TXT", book: "BOOK", "index-book": "📚", "index-chapter": "📄", "index-chunk": "🔹", chat: "💬" };
    const tag = tagMap[a.type] || a.type;
    const size = a.content ? new Blob([a.content]).size : 0;
    const checked = state.selectedAssetIds.has(a.id) ? "checked" : "";
    row.innerHTML = `
      <label class="check"><input type="checkbox" data-aid="${a.id}" ${checked}></label>
      <div class="asset-info">
        <div class="asset-name"><span class="tag">${tag}</span>${escapeHtml(a.name)}</div>
        <div class="asset-meta">${formatSize(size)}${a.encoding ? " · " + a.encoding : ""}</div>
      </div>
      <div class="asset-actions">
        <button class="btn-mini" data-act="view" data-aid="${a.id}">查看</button>
        <button class="btn-mini danger" data-act="del" data-aid="${a.id}">删</button>
      </div>
    `;
    wrap.appendChild(row);
  }
  wrap.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.onchange = () => {
      if (cb.checked) state.selectedAssetIds.add(cb.dataset.aid);
      else state.selectedAssetIds.delete(cb.dataset.aid);
    };
  });
  wrap.querySelectorAll("button[data-act]").forEach(btn => {
    btn.onclick = () => handleAssetAction(btn.dataset.act, btn.dataset.aid);
  });
}

async function handleAssetAction(act, aid) {
  const a = await Store.getAsset(state.convId, aid);
  if (!a) return;
  if (act === "del") {
    if (!confirm(`删除「${a.name}」？`)) return;
    await Store.deleteAsset(state.convId, aid);
    state.selectedAssetIds.delete(aid);
    await renderAssets();
  } else if (act === "view") {
    $("#viewerTitle").textContent = a.name;
    $("#viewerBody").textContent = a.content || "(空)";
    $("#viewerMeta").textContent = `${a.type} · ${formatSize(new Blob([a.content || ""]).size)}`;
    openModal("viewerModal");
  }
}

// ============== 抽屉 / Modal 控制 ==============
function openDrawer(id) { $("#" + id).classList.add("open"); }
function closeDrawerPanels() {
  document.querySelectorAll(".drawer").forEach(d => d.classList.remove("open"));
  $("#modelMenu").style.display = "none";
}
function openModal(id) { $("#" + id).classList.add("open"); }
function closeModal(id) { $("#" + id).classList.remove("open"); }

// ============== 模型按钮 / 菜单 ==============
function updateModelButton() {
  const apis = Settings.listApis();
  if (apis.length === 0) {
    $("#modelLabel").textContent = "添加模型";
  } else {
    const cur = apis.find(a => a.alias === state.apiAlias) || apis[0];
    state.apiAlias = cur.alias;
    $("#modelLabel").textContent = `${cur.alias}`;
  }
}

function renderModelMenu() {
  const apis = Settings.listApis();
  const wrap = $("#modelMenuList");
  wrap.innerHTML = "";
  if (apis.length === 0) {
    wrap.innerHTML = `<div class="muted small" style="padding:6px">还没有模型，点击下方添加</div>`;
  } else {
    for (const a of apis) {
      const row = document.createElement("div");
      row.className = "model-menu-item" + (a.alias === state.apiAlias ? " active" : "");
      row.innerHTML = `
        <span>${escapeHtml(a.alias)} <span class="muted small">· ${escapeHtml(a.model)}</span></span>
        <span class="edit">编辑</span>
      `;
      row.onclick = (e) => {
        if (e.target.classList.contains("edit")) {
          openModelModal(a.alias);
        } else {
          state.apiAlias = a.alias;
          Settings.saveDefaults({ ...Settings.getDefaults(), defaultApiAlias: a.alias });
          updateModelButton();
          closeDrawerPanels();
        }
      };
      wrap.appendChild(row);
    }
  }
  $("#modelMenu").style.display = "";
}

function openModelModal(alias = null) {
  $("#modelModalTitle").textContent = alias ? `编辑模型：${alias}` : "添加模型";
  $("#apiAlias").value = ""; $("#apiBaseUrl").value = "";
  $("#apiKey").value = ""; $("#apiModel").value = "";
  $("#apiProxy").value = "";
  $("#apiAlias").disabled = !!alias;
  $("#delModelBtn").style.display = alias ? "" : "none";
  $("#delModelBtn").dataset.alias = alias || "";
  if (alias) {
    const a = Settings.getApi(alias);
    if (a) {
      $("#apiAlias").value = a.alias;
      $("#apiBaseUrl").value = a.base_url || "";
      $("#apiKey").value = a.api_key || "";
      $("#apiModel").value = a.model || "";
      $("#apiProxy").value = a.proxy || "";
    }
  }
  closeDrawerPanels();
  openModal("modelModal");
}

function saveModelFromForm() {
  const alias = $("#apiAlias").value.trim();
  const base_url = $("#apiBaseUrl").value.trim();
  const api_key = $("#apiKey").value.trim();
  const model = $("#apiModel").value.trim();
  const proxy = $("#apiProxy").value.trim();
  if (!alias || !base_url || !model) {
    flash("请填写别名、Base URL、Model");
    return;
  }
  const rec = { alias, base_url, api_key, model, proxy };
  Settings.saveApi(rec);
  if (!state.apiAlias) state.apiAlias = alias;
  Settings.saveDefaults({ ...Settings.getDefaults(), defaultApiAlias: state.apiAlias });
  updateModelButton();
  closeModal("modelModal");
  flash("已保存");
}

function deleteModelFromForm() {
  const alias = $("#delModelBtn").dataset.alias;
  if (!alias) return;
  if (!confirm(`删除模型「${alias}」？`)) return;
  Settings.deleteApi(alias);
  const apis = Settings.listApis();
  state.apiAlias = apis[0]?.alias || null;
  Settings.saveDefaults({ ...Settings.getDefaults(), defaultApiAlias: state.apiAlias });
  updateModelButton();
  closeModal("modelModal");
  flash("已删除");
}

// ============== 上传 ==============
async function onUploadFiles(fileList) {
  console.log("[上传] 收到文件数：", fileList ? fileList.length : 0);
  if (!fileList || fileList.length === 0) {
    flash("未选择文件");
    return;
  }
  const files = Array.from(fileList).filter(f => {
    const ok = /\.(txt|md)$/i.test(f.name) || f.type.startsWith("text/") || f.type === "";
    console.log("[上传] 过滤:", f.name, "type=", f.type, "size=", f.size, "ok=", ok);
    return ok;
  });
  console.log("[上传] 通过过滤后文件数：", files.length, files.map(f => f.name));
  if (files.length === 0) {
    flash("仅支持 .txt / .md 文件（检测到文件：" + Array.from(fileList).map(f => f.name).join(", ") + "）");
    return;
  }
  let okCount = 0;
  for (const f of files) {
    console.log("[上传] 开始处理:", f.name, "size=", f.size);
    if (f.size > 100 * 1024 * 1024) { flash(`${f.name} 超过 100MB，跳过`); continue; }
    if (f.size === 0) { flash(`${f.name} 是空文件`); continue; }
    try {
      const { text, encoding, size, name } = await readTextFromFile(f);
      console.log("[上传] 读取完成:", name, "encoding=", encoding, "textLen=", (text || "").length);
      if (!text || text.length === 0) { flash(`${f.name} 解析后内容为空（可能编码不支持）`); continue; }
      await Store.addAsset(state.convId, {
        type: "txt", name, content: text, encoding, size, convId: state.convId, createdAt: Date.now(),
      });
      console.log("[上传] 已写入 DB:", name);
      okCount++;
    } catch (e) {
      console.error("[上传] 失败", f.name, e);
      flash("读取失败：" + f.name + " " + e.message);
    }
  }
  await renderAssets();
  if (okCount > 0) flash(`已上传 ${okCount} 个文件`);
}

async function mergeSelectedIntoBook() {
  const assets = await Store.listAssets(state.convId);
  const txts = assets.filter(a => a.type === "txt" && state.selectedAssetIds.has(a.id));
  if (txts.length < 2) { flash("请先勾选 2 个或以上 TXT"); return; }
  txts.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
  const baseName = txts[0].name.replace(/\.(txt|md)$/i, "");
  const bookName = prompt("请输入书名", baseName);
  if (!bookName) return;
  await Store.addAsset(state.convId, {
    type: "book", name: bookName, fileIds: txts.map(t => t.id), convId: state.convId, createdAt: Date.now(),
  });
  flash(`已合并为「${bookName}」`);
  await renderAssets();
}

// ============== 聊天发送 ==============
async function sendChat() {
  try {
    return await sendChatInner();
  } catch (e) {
    console.error("[sendChat 外层错误]", e);
    flash("发送失败：" + e.message);
    setSending(false);
  }
}

async function sendChatInner() {
  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  if (!state.apiAlias) {
    flash("请先在底部选择/添加模型");
    return;
  }
  const api = Settings.getApi(state.apiAlias);
  if (!api) { flash("API 配置缺失"); return; }
  console.log("[sendChat] api=", api.alias, "base_url=", api.base_url, "model=", api.model, "proxy=", (api.proxy || "无"));
  input.value = "";
  autoResizeInput();

  // 用户消息入 DB
  await Store.addAsset(state.convId, { type: "chat", role: "user", content: text, convId: state.convId, createdAt: Date.now() });

  // 构造上下文
  const ctx = await buildContext();
  const messages = [];
  if (ctx.system) messages.push({ role: "system", content: ctx.system });
  if (ctx.contexts.length > 0) {
    messages.push({ role: "system", content: "以下是与当前对话相关的资料：\n\n" + ctx.contexts });
  }
  messages.push({ role: "user", content: text });

  // 先渲染一次（看到自己刚发的消息）
  await renderChat();

  // 占位 AI 消息
  const aiId = "chat_" + Date.now() + "_ai";
  await Store.addAsset(state.convId, { type: "chat", id: aiId, role: "assistant", content: "", convId: state.convId, createdAt: Date.now() });
  await renderChat();

  // 找占位元素
  const allAssistant = $$("#chatMsgs .msg.assistant");
  const aiRow = allAssistant[allAssistant.length - 1];
  let acc = "";

  state.abortCtrl = new AbortController();
  setSending(true);

  // 关键：callLLM 是 fire-and-forget，必须在回调里 setSending(false)
  // 不能 await 整个 callLLM，否则 await resolve 后立刻 setSending(false) 掩盖错误
  callLLM(api, messages, {
    signal: state.abortCtrl.signal,
    onToken: (t) => {
      acc += t;
      if (aiRow) aiRow.innerHTML = `<div class="msg-role">AI</div>${escapeHtml(acc)}`;
      const w = $("#chatMsgs");
      w.scrollTop = w.scrollHeight;
    },
    onDone: async () => {
      // 回写最终内容
      try {
        await Store.putAsset(state.convId, { id: aiId, type: "chat", role: "assistant", content: acc, convId: state.convId, createdAt: Date.now() });
      } catch (e) { console.error("回写 AI 消息失败", e); }
      setSending(false);
    },
    onError: async (e) => {
      console.error("[LLM 错误]", e);
      acc += (acc ? "\n\n" : "") + `⚠️ 调用失败：${e.message}\n（可能原因：模型 base_url 不可达 / CORS 被拒 / key 错误）`;
      if (aiRow) aiRow.innerHTML = `<div class="msg-role">AI</div>${escapeHtml(acc)}`;
      try {
        await Store.putAsset(state.convId, { id: aiId, type: "chat", role: "assistant", content: acc, convId: state.convId, createdAt: Date.now() });
      } catch (e2) { console.error("回写错误消息失败", e2); }
      setSending(false);
      flash("AI 调用失败");
    },
  });
}

async function buildContext() {
  const assets = await Store.listAssets(state.convId);
  const selected = assets.filter(a => state.selectedAssetIds.has(a.id) && a.content);
  const contexts = selected.map(a => `### ${a.name}（${a.type}）\n${a.content}`).join("\n\n");
  const system = "你是一个小说阅读助手，请基于用户提供的资料回答。";
  return { system, contexts };
}

function setSending(on) {
  $("#sendBtn").style.display = on ? "none" : "";
  $("#abortBtn").style.display = on ? "" : "none";
  $("#sendBtn").disabled = on;
}

// ============== 索引 ==============
async function openIndexerModal() {
  if (!state.apiAlias) { flash("请先配置模型"); return; }
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
  $("#progressWrap").style.display = "none";
  $("#indexLog").style.display = "none";
  $("#indexLog").textContent = "";
  openModal("indexerModal");
}

async function startIndexing() {
  const bookId = $("#bookSelect").value;
  if (!bookId) return;
  const book = await Store.getAsset(state.convId, bookId);
  if (!book) return;
  const mode = $("#modeSelect").value;
  const def = Settings.getDefaults();
  const api = Settings.getApi(state.apiAlias);
  state.abortCtrl = new AbortController();
  $("#startIndexBtn").disabled = true;
  $("#abortIndexBtn").style.display = "";
  $("#progressWrap").style.display = "";
  $("#indexLog").style.display = "";
  $("#indexLog").textContent = "";

  try {
    await runIndex({
      bookAsset: book,
      apiCfg: api,
      mode,
      onProgress: (text, ratio) => {
        $("#progressText").textContent = text;
        $("#progressBar").style.width = (ratio * 100).toFixed(0) + "%";
      },
      log: (line) => {
        $("#indexLog").textContent += line + "\n";
        $("#indexLog").scrollTop = $("#indexLog").scrollHeight;
      },
      signal: state.abortCtrl.signal,
    });
    flash("索引完成");
    await renderAssets();
  } catch (e) {
    flash("索引出错：" + e.message);
  } finally {
    $("#startIndexBtn").disabled = false;
    $("#abortIndexBtn").style.display = "none";
  }
}

// ============== 工具 ==============
function $(s) { return document.querySelector(s); }
function $$(s) { return Array.from(document.querySelectorAll(s)); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
function formatSize(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + " " + u[i];
}
let _toastT = null;
function flash(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(_toastT);
  _toastT = setTimeout(() => t.classList.remove("show"), 1800);
}

function autoResizeInput() {
  const el = $("#chatInput");
  el.style.height = "auto";
  el.style.height = Math.min(120, el.scrollHeight) + "px";
}

// ============== 导入导出 ==============
async function exportAllJson() {
  const data = { apis: Settings.listApis(), chats: [] };
  const convs = await Store.listConversations();
  for (const c of convs) {
    const assets = await Store.listAssets(c.id);
    data.chats.push({ title: c.title, assets });
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `playxyz-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  flash("已导出");
}

function importJson() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json";
  inp.onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const txt = await f.text();
      const data = JSON.parse(txt);
      if (data.apis) data.apis.forEach(a => Settings.saveApi(a));
      if (data.chats) {
        for (const c of data.chats) {
          const conv = await Store.createConversation({ title: c.title || "导入对话" });
          for (const a of (c.assets || [])) {
            await Store.addAsset(conv.id, { ...a, convId: conv.id });
          }
        }
      }
      await renderAll();
      flash("导入完成");
    } catch (err) { alert("导入失败：" + err.message); }
  };
  inp.click();
}

async function clearAll() {
  if (!confirm("清空全部对话和资产？此操作不可恢复。")) return;
  const convs = await Store.listConversations();
  for (const c of convs) await Store.deleteConversation(c.id);
  const nc = await Store.createConversation({ title: "新对话" });
  await switchConv(nc.id, false);
  flash("已清空");
}

// ============== 全局事件绑定（同步，在 DOMContentLoaded 时跑） ==============
export function bindGlobalUI() {
  // 顶栏
  $("#menuBtn").onclick = () => {
    closeDrawerPanels();
    openDrawer("drawer");
  };
  $("#assetBtn").onclick = () => {
    closeDrawerPanels();
    openDrawer("assetDrawer");
  };
  $("#indexerBtn").onclick = () => {
    closeDrawerPanels();
    openIndexerModal();
  };
  $("#newConvBtn").onclick = async () => {
    const c = await Store.createConversation({ title: "新对话 " + new Date().toLocaleTimeString() });
    await switchConv(c.id);
  };

  // 抽屉关闭
  document.querySelectorAll("[data-close-drawer]").forEach(el => el.onclick = closeDrawerPanels);
  document.querySelectorAll("[data-close-asset]").forEach(el => el.onclick = closeDrawerPanels);

  // 底部 / 上传
  // 移动端可靠方案：直接用 label[for] 触发（已在 HTML 中配置）
  // 底部 ＋ 按钮用 JS 点击 file input（用户手势链中有效）
  $("#uploadBtn").onclick = () => {
    const inp = $("#fileInput");
    inp.value = ""; // 重置，否则选同一个文件不触发 change
    inp.click();
  };
  $("#fileInput").onchange = (e) => {
    console.log("[fileInput.change] files=", e.target.files ? e.target.files.length : 0);
    onUploadFiles(e.target.files);
  };
  $("#assetDropZone").ondragover = (e) => { e.preventDefault(); $("#assetDropZone").classList.add("hover"); };
  $("#assetDropZone").ondragleave = () => $("#assetDropZone").classList.remove("hover");
  $("#assetDropZone").ondrop = (e) => {
    e.preventDefault(); $("#assetDropZone").classList.remove("hover");
    onUploadFiles(e.dataTransfer.files);
  };
  $("#mergeBookBtn").onclick = mergeSelectedIntoBook;

  $("#modelBtn").onclick = (e) => {
    e.stopPropagation();
    if ($("#modelMenu").style.display === "none" || !$("#modelMenu").style.display) {
      renderModelMenu();
    } else {
      $("#modelMenu").style.display = "none";
    }
  };
  document.addEventListener("click", (e) => {
    if (!$("#modelMenu").contains(e.target) && e.target.id !== "modelBtn" && !e.target.closest("#modelBtn")) {
      $("#modelMenu").style.display = "none";
    }
  });
  $("#addModelFromMenuBtn").onclick = () => openModelModal();

  $("#sendBtn").onclick = sendChat;
  $("#abortBtn").onclick = () => { if (state.abortCtrl) state.abortCtrl.abort(); };
  $("#chatInput").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  };
  $("#chatInput").oninput = autoResizeInput;

  // 模型 Modal
  $("#saveModelBtn").onclick = saveModelFromForm;
  $("#delModelBtn").onclick = deleteModelFromForm;
  document.querySelectorAll("[data-close]").forEach(el => el.onclick = () => closeModal(el.dataset.close));

  // 数据管理
  $("#exportJsonBtn").onclick = exportAllJson;
  $("#importJsonBtn").onclick = importJson;
  $("#clearAllBtn").onclick = clearAll;

  // 默认值
  $("#saveDefaultsBtn").onclick = () => {
    Settings.saveDefaults({
      defaultApiAlias: state.apiAlias,
      chunkSize: parseInt($("#chunkSize").value, 10) || 1500,
      maxConcurrency: parseInt($("#maxConcurrency").value, 10) || 3,
      splitPattern: $("#splitPattern").value.trim() || null,
    });
    flash("已保存默认值");
  };

  // 索引（顶栏 ⚙ 按钮已经触发 openIndexerModal）
  $("#startIndexBtn").onclick = startIndexing;
  $("#abortIndexBtn").onclick = () => { if (state.abortCtrl) state.abortCtrl.abort(); };
}
