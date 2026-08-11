// ui.js
// 移动端极简 UI（阅后即焚 + 聊天优先 + 上传即上下文）：
// 顶栏：[🗑 清空] [标题] [⚙ 分析概括小说]
// 主区：聊天消息流（微信风格气泡）
// 底栏：[模型] [输入框] [＋上传] [发送]

import * as Store from "./store.js";
import * as Settings from "./settings.js";
import { callLLM } from "./api.js";
import { readTextFromFile } from "./split.js";
import { runIndex } from "./indexer.js";

const state = {
  convId: null,
  apiAlias: null,
  abortCtrl: null,
  // 聊天上下文：上传的小说 txt / 生成的索引，自动加入，无需用户勾选
  selectedAssetIds: new Set(),
};

// ============== 启动 ==============
export async function boot() {
  // 加载默认 API（localStorage，阅后即焚不影响）
  const def = Settings.getDefaults();
  const apis = Settings.listApis();
  if (def.defaultApiAlias && apis.find(a => a.alias === def.defaultApiAlias)) {
    state.apiAlias = def.defaultApiAlias;
  } else if (apis.length > 0) {
    state.apiAlias = apis[0].alias;
  }
  updateModelButton();

  // 🔥 阅后即焚：先整库清空上一次的对话/小说/索引，再开全新对话
  await Store.purgeAll();
  const cur = await Store.createConversation({ title: "新对话" });
  await switchConv(cur.id, false);
  await renderChat();
}

async function switchConv(convId, closeDrawer = true) {
  state.convId = convId;
  state.selectedAssetIds.clear();
  const conv = await Store.getConversation(convId);
  $("#convTitle").textContent = conv ? conv.title : "新对话";
  await renderChat();
}

// ============== 渲染聊天 ==============
async function renderChat() {
  if (!state.convId) return;
  const allMetas = await Store.listAssetMetas(state.convId);
  const chatMetas = allMetas
    .filter(a => a.type === "chat")
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const wrap = $("#chatMsgs");
  wrap.innerHTML = "";
  if (chatMetas.length === 0) {
    wrap.innerHTML = `<div class="empty-hint">开始对话吧。<br>点击底部 <strong>＋</strong> 上传小说 TXT，AI 即可阅读并回答你的问题。<br><span class="muted small">🔥 阅后即焚：关闭本页后数据自动清除</span></div>`;
    return;
  }
  for (const m of chatMetas) {
    const full = await Store.getAsset(state.convId, m.id);
    const content = full ? full.content || "" : "";
    const role = full ? full.role : "system";
    const row = document.createElement("div");
    row.className = "msg-row " + role;
    if (role === "assistant" && !content) {
      // AI 等待回复中：上方计时框 + 占位气泡（复制按钮等有内容了再显示）
      row.classList.add("pending");
      row.innerHTML = `
        <div class="msg-timer">⏱ 等待回复…</div>
        <div class="msg assistant">…</div>
      `;
    } else {
      const parts = [];
      // AI 已完成的消息：显示历史用时（来自 DB 的 duration 字段）
      if (role === "assistant" && full && full.duration) {
        parts.push(`<div class="msg-timer">⏱ 回复用时 ${escapeHtml(String(full.duration))}s</div>`);
      }
      parts.push(`<div class="msg ${role}">${escapeHtml(content)}</div>`);
      if (role === "user" || role === "assistant") {
        parts.push(`<button class="copy-btn" title="复制这条消息">⧉</button>`);
      }
      row.innerHTML = parts.join("");
    }
    wrap.appendChild(row);
  }
  // 复制按钮：点击复制气泡内容
  wrap.querySelectorAll(".copy-btn").forEach(btn => {
    btn.onclick = async () => {
      const bubble = btn.closest(".msg-row").querySelector(".msg");
      if (!bubble) return;
      await copyText(bubble.textContent);
      btn.textContent = "✓";
      btn.classList.add("done");
      setTimeout(() => { btn.textContent = "⧉"; btn.classList.remove("done"); }, 1200);
    };
  });
  wrap.scrollTop = wrap.scrollHeight;
}

// ============== 复制 / 计时 ==============
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 降级：旧方案（iframe/textarea + execCommand）
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-999px;left:-999px;opacity:0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch (e2) { return false; }
  }
}

let _pendingTimer = null;   // 等待计时的 setInterval id
let _pendingStart = 0;      // 开始等待的时间戳

// AI 等待回复期间，每秒刷新最后一个 pending 气泡上方的计时
function startPendingTimer() {
  _pendingStart = Date.now();
  if (_pendingTimer) clearInterval(_pendingTimer);
  _pendingTimer = setInterval(() => {
    const els = $$("#chatMsgs .msg-row.assistant.pending .msg-timer");
    if (els.length === 0) { clearInterval(_pendingTimer); _pendingTimer = null; return; }
    const secs = Math.round((Date.now() - _pendingStart) / 1000);
    els[els.length - 1].textContent = `⏱ 等待回复 ${secs}s`;
  }, 1000);
}

// 停止计时并写入最终文案（首字用时 / 回复完成 / 失败）
function stopPendingTimer(finalText) {
  if (_pendingTimer) { clearInterval(_pendingTimer); _pendingTimer = null; }
  const rows = $$("#chatMsgs .msg-row.assistant");
  const row = rows[rows.length - 1];
  if (!row) return;
  row.classList.remove("pending");
  const t = row.querySelector(".msg-timer");
  if (t) t.textContent = finalText;
}

// ============== Modal 控制 ==============
function openModal(id) { $("#" + id).classList.add("open"); }
function closeModal(id) { $("#" + id).classList.remove("open"); }
function hideModelMenu() { $("#modelMenu").style.display = "none"; }

// ============== 模型按钮 / 菜单 ==============
// 从 NVIDIA build.nvidia.com 的 Node 代码块里自动抽出 base_url / api_key / model
function parseNvidiaCode(code) {
  const out = { base_url: null, api_key: null, model: null, alias: null, errors: [] };
  if (!code || !code.trim()) {
    out.errors.push("粘贴内容为空");
    return out;
  }

  // 1) invokeUrl（NVIDIA 标准字段名）
  const urlMatch = code.match(/invokeUrl\s*=\s*["'`]([^"'`]+)["'`]/);
  if (urlMatch) {
    let url = urlMatch[1].trim();
    // api.js 会自动拼 /chat/completions，这里把结尾剥掉避免重复
    url = url.replace(/\/chat\/completions\/?$/i, "").replace(/\/+$/, "");
    out.base_url = url;
  } else {
    // 兜底：抓 https://integrate.api.nvidia.com/...
    const fallback = code.match(/https:\/\/integrate\.api\.nvidia\.com\/[^"'`\s]+/);
    if (fallback) {
      out.base_url = fallback[0].replace(/\/chat\/completions\/?$/i, "").replace(/\/+$/, "");
    } else {
      out.errors.push("未找到 URL");
    }
  }

  // 2) Bearer token（两种写法都兼容）
  const authObj = code.match(/["']Authorization["']\s*:\s*["'`]Bearer\s+([A-Za-z0-9._\-]+)["'`]/i);
  const authBare = code.match(/Bearer\s+(nvapi-[A-Za-z0-9._\-]+)/);
  if (authObj) {
    out.api_key = authObj[1].trim();
  } else if (authBare) {
    out.api_key = authBare[1].trim();
  } else {
    out.errors.push("未找到 nvapi-... 密钥");
  }

  // 3) model（payload 里 "model": "xxx"）
  const modelMatch = code.match(/["']model["']\s*:\s*["'`]([^"'`]+)["'`]/);
  if (modelMatch) {
    out.model = modelMatch[1].trim();
  } else {
    out.errors.push("未找到 model 字段");
  }

  // 4) 自动起别名 nvidia-<model 末段>
  if (out.model) {
    const tail = (out.model.split("/").pop() || out.model).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    out.alias = "nvidia-" + (tail || "model");
  } else {
    out.alias = "";
  }

  return out;
}

function applyNvidiaParseToForm() {
  const code = $("#nvidiaPaste").value;
  const r = parseNvidiaCode(code);
  const status = $("#nvidiaParseStatus");
  if (r.errors.length && !r.base_url && !r.api_key && !r.model) {
    status.style.color = "#991b1b";
    status.textContent = "❌ 识别失败：" + r.errors.join("；");
    return;
  }
  if (r.base_url) $("#apiBaseUrl").value = r.base_url;
  if (r.api_key)  $("#apiKey").value = r.api_key;
  if (r.model)    $("#apiModel").value = r.model;
  if (r.alias && !$("#apiAlias").value) $("#apiAlias").value = r.alias;
  // 别名冲突时自动追加 -2 / -3 ...
  if ($("#apiAlias").value) {
    const exist = Settings.listApis().map(a => a.alias);
    let alias = $("#apiAlias").value;
    let i = 2;
    while (exist.includes(alias)) {
      alias = $("#apiAlias").value.replace(/-\d+$/, "") + "-" + i++;
    }
    $("#apiAlias").value = alias;
  }

  if (r.errors.length) {
    status.style.color = "#856404";
    status.textContent = "⚠️ 部分字段需手动补：" + r.errors.join("；") + "（已自动填好其它项）";
  } else {
    status.style.color = "#1f7a3a";
    status.textContent = "✅ 已填入：URL / Key / Model / 名称，请点下方「保存」";
  }
}

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
          hideModelMenu();
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
  $("#apiAlias").disabled = !!alias;
  $("#delModelBtn").style.display = alias ? "" : "none";
  $("#delModelBtn").dataset.alias = alias || "";
  // 清掉上次的粘贴/识别状态
  const pasteEl = $("#nvidiaPaste"); if (pasteEl) pasteEl.value = "";
  const statusEl = $("#nvidiaParseStatus");
  if (statusEl) { statusEl.textContent = ""; statusEl.style.color = ""; }
  if (alias) {
    const a = Settings.getApi(alias);
    if (a) {
      $("#apiAlias").value = a.alias;
      $("#apiBaseUrl").value = a.base_url || "";
      $("#apiKey").value = a.api_key || "";
      $("#apiModel").value = a.model || "";
    }
  }
  hideModelMenu();
  openModal("modelModal");
}

function saveModelFromForm() {
  const alias = $("#apiAlias").value.trim();
  let base_url = $("#apiBaseUrl").value.trim();
  const api_key = $("#apiKey").value.trim();
  const model = $("#apiModel").value.trim();
  if (!alias || !base_url || !api_key || !model) {
    flash("请填写名称、URL、API Key、Model 四项");
    return;
  }
  // 兼容：用户填了完整 /chat/completions 地址时剥掉（api.js 会自动拼）
  base_url = base_url.replace(/\/chat\/completions\/?$/i, "").replace(/\/+$/, "");
  const rec = { alias, base_url, api_key, model };
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

// ============== 上传小说（唯一上传入口：底部 ＋） ==============
async function onUploadFiles(fileList) {
  if (!fileList || fileList.length === 0) {
    flash("未选择文件");
    return;
  }
  const files = Array.from(fileList).filter(f => {
    return /\.(txt|md)$/i.test(f.name) || f.type.startsWith("text/") || f.type === "";
  });
  if (files.length === 0) {
    flash("仅支持 .txt / .md 文件");
    return;
  }
  let okCount = 0;
  for (const f of files) {
    if (f.size > 100 * 1024 * 1024) { flash(`${f.name} 超过 100MB，跳过`); continue; }
    if (f.size === 0) { flash(`${f.name} 是空文件`); continue; }
    try {
      const { text, encoding, size, name } = await readTextFromFile(f);
      if (!text || text.length === 0) { flash(`${f.name} 解析后内容为空（可能编码不支持）`); continue; }
      // 1) 存 txt 原文
      const txt = await Store.addAsset(state.convId, {
        type: "txt", name, content: text, encoding, size, convId: state.convId, createdAt: Date.now(),
      });
      // 2) 自动生成「书」记录（供 ⚙ 分析概括用）
      const bookName = name.replace(/\.(txt|md)$/i, "");
      await Store.addAsset(state.convId, {
        type: "book", name: bookName, fileIds: [txt.id], convId: state.convId, createdAt: Date.now(),
      });
      // 3) 自动加入聊天上下文 → AI 立即可阅读
      state.selectedAssetIds.add(txt.id);
      okCount++;
    } catch (e) {
      console.error("[上传] 失败", f.name, e);
      flash("读取失败：" + f.name + " " + e.message);
    }
  }
  if (okCount > 0) {
    flash(`已上传 ${okCount} 个文件，AI 现在可以阅读了`);
  }
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
  const startTime = Date.now();  // 计时起点
  input.value = "";
  autoResizeInput();

  // ① 用户消息立即写入并渲染 → 立刻看到自己的发言（不等上下文构建）
  await Store.addAsset(state.convId, { type: "chat", role: "user", content: text, convId: state.convId, createdAt: Date.now() });
  await renderChat();

  // ② 构建上下文（用户消息已显示，这里慢一点无感）
  const ctx = await buildContext();
  const messages = [];
  if (ctx.system) messages.push({ role: "system", content: ctx.system });
  if (ctx.contexts.length > 0) {
    messages.push({ role: "system", content: "以下是与当前对话相关的资料：\n\n" + ctx.contexts });
  }
  messages.push({ role: "user", content: text });

  // ③ AI 占位消息 + 等待计时
  const aiId = "chat_" + Date.now() + "_ai";
  await Store.addAsset(state.convId, { type: "chat", id: aiId, role: "assistant", content: "", convId: state.convId, createdAt: Date.now() });
  await renderChat();
  startPendingTimer();

  const aiBubbles = $$("#chatMsgs .msg-row.assistant .msg");
  const aiRow = aiBubbles[aiBubbles.length - 1];
  let acc = "";
  let firstTokenAt = null;

  state.abortCtrl = new AbortController();
  setSending(true);

  callLLM(api, messages, {
    signal: state.abortCtrl.signal,
    onToken: (t) => {
      // 收到第一个字：冻结等待计时，显示「首字用时」
      if (!firstTokenAt) {
        firstTokenAt = Date.now();
        stopPendingTimer(`⏱ 首字用时 ${((firstTokenAt - startTime) / 1000).toFixed(1)}s`);
      }
      acc += t;
      if (aiRow) aiRow.textContent = acc;
      const w = $("#chatMsgs");
      w.scrollTop = w.scrollHeight;
    },
    onDone: async () => {
      const dur = ((Date.now() - startTime) / 1000).toFixed(1);
      stopPendingTimer(`⏱ 回复完成 ${dur}s`);
      try {
        await Store.putAsset(state.convId, { id: aiId, type: "chat", role: "assistant", content: acc, duration: dur, convId: state.convId, createdAt: Date.now() });
      } catch (e) { console.error("回写 AI 消息失败", e); }
      setSending(false);
      // 重建消息列表：AI 消息带上复制按钮 + 「⏱ 回复用时」标签
      await renderChat();
    },
    onError: async (e) => {
      console.error("[LLM 错误]", e);
      const dur = ((Date.now() - startTime) / 1000).toFixed(1);
      stopPendingTimer(`⏱ 调用失败 ${dur}s`);
      const errMsg = e.message || String(e);
      acc += (acc ? "\n\n" : "") + `⚠️ 调用失败：${errMsg}`;
      try {
        await Store.putAsset(state.convId, { id: aiId, type: "chat", role: "assistant", content: acc, duration: dur, convId: state.convId, createdAt: Date.now() });
      } catch (e2) { console.error("回写错误消息失败", e2); }
      setSending(false);
      await renderChat();
    },
  });
}

// 聊天上下文：取当前会话中「已加入上下文」的资产（上传的 txt / 生成的索引）
// 超长内容做头尾截断，避免一次对话塞爆模型上下文
const MAX_PER_ASSET = 30000;
async function buildContext() {
  const metas = await Store.listAssetMetas(state.convId);
  const selected = metas.filter(a => state.selectedAssetIds.has(a.id));
  const contexts = [];
  for (const m of selected) {
    const full = await Store.getAsset(state.convId, m.id);
    if (full && full.content) {
      let c = full.content;
      if (c.length > MAX_PER_ASSET) {
        c = c.slice(0, Math.floor(MAX_PER_ASSET * 0.7))
          + "\n\n[…中段省略…]\n\n"
          + c.slice(-Math.floor(MAX_PER_ASSET * 0.3));
      }
      contexts.push(`### ${full.name || ""}（${m.type}）\n${c}`);
    }
  }
  const system = "你是一个小说阅读助手，请基于用户提供的资料回答。";
  return { system, contexts: contexts.join("\n\n") };
}

function setSending(on) {
  $("#sendBtn").style.display = on ? "none" : "";
  $("#abortBtn").style.display = on ? "" : "none";
  $("#sendBtn").disabled = on;
}

// ============== 索引（分析概括小说） ==============
async function openIndexerModal() {
  if (!state.apiAlias) { flash("请先配置模型"); return; }
  const metas = await Store.listAssetMetas(state.convId);
  const books = metas.filter(a => a.type === "book");
  const sel = $("#bookSelect");
  sel.innerHTML = "";
  if (books.length === 0) {
    sel.innerHTML = `<option value="">(请先通过底部 ＋ 上传小说 TXT)</option>`;
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
      onProgress: (info) => {
        // indexer.js 传的是 { phase, current, total, title, ... }
        let text = "";
        let ratio = 0;
        if (!info) {
          text = "处理中…";
        } else if (info.phase === "split") {
          text = "章节切分中…";
          ratio = 0.02;
        } else if (info.phase === "chapter") {
          text = `总结章节 ${info.current}/${info.total}：${info.title || ""}`;
          ratio = 0.05 + (info.current / Math.max(1, info.total)) * 0.7;
        } else if (info.phase === "chunk") {
          text = `章节 ${info.chapter || "?"}：块 ${info.chunk}/${info.chunkTotal}（${info.title || ""}）`;
          const total = info.total || 1;
          const ch = info.chapter || 1;
          ratio = 0.05 + ((ch - 1) / total + (info.chunk / Math.max(1, info.chunkTotal)) / total) * 0.7;
        } else if (info.phase === "book") {
          text = "正在生成全书梗概…";
          ratio = 0.85;
        } else if (info.phase === "book-merge") {
          text = `合并梗概 第 ${info.current}/${info.total} 层 ${info.level || ""}`;
          ratio = 0.85 + (info.current / Math.max(1, info.total)) * 0.12;
        } else {
          text = "处理中…";
        }
        $("#progressText").textContent = text;
        const w = Math.max(0, Math.min(100, ratio * 100));
        $("#progressBar").style.width = w.toFixed(0) + "%";
      },
      log: (line) => {
        $("#indexLog").textContent += line + "\n";
        $("#indexLog").scrollTop = $("#indexLog").scrollHeight;
      },
      signal: state.abortCtrl.signal,
    });
    // 索引完成后，把「全书梗概」自动加入聊天上下文 → AI 可基于全书概括回答问题
    const idxBook = await Store.getAsset(state.convId, `idx_book_${book.id}`);
    if (idxBook) state.selectedAssetIds.add(idxBook.id);
    flash("索引完成，AI 现在可基于全书梗概回答");
    closeModal("indexerModal");
  } catch (e) {
    flash("索引出错：" + e.message);
  } finally {
    $("#startIndexBtn").disabled = false;
    $("#abortIndexBtn").style.display = "none";
  }
}

// ============== 清空并新对话（阅后即焚） ==============
async function clearAndNew() {
  if (!confirm("清空本次会话的全部数据（对话/小说/索引）并开启新对话？此操作不可恢复。")) return;
  await Store.purgeAll();
  const nc = await Store.createConversation({ title: "新对话" });
  await switchConv(nc.id, false);
  flash("已清空，开始新对话");
}

// ============== 工具 ==============
function $(s) { return document.querySelector(s); }
function $$(s) { return Array.from(document.querySelectorAll(s)); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
let _toastT = null;
function flash(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(_toastT);
  _toastT = setTimeout(() => t.classList.remove("show"), 2200);
}

function autoResizeInput() {
  const el = $("#chatInput");
  el.style.height = "auto";
  el.style.height = Math.min(120, el.scrollHeight) + "px";
}

// ============== 全局事件绑定（同步，在 DOMContentLoaded 时跑） ==============
export function bindGlobalUI() {
  // 顶栏
  $("#clearConvBtn").onclick = async () => { await clearAndNew(); };
  $("#indexerBtn").onclick = () => { openIndexerModal(); };

  // 上传（底部 ＋ → 隐藏 fileInput）
  $("#uploadBtn").onclick = () => {
    const inp = $("#fileInput");
    inp.value = ""; // 重置，否则选同一个文件不触发 change
    inp.click();
  };
  $("#fileInput").onchange = (e) => {
    onUploadFiles(e.target.files);
  };

  // 模型菜单
  $("#modelBtn").onclick = (e) => {
    e.stopPropagation();
    const menu = $("#modelMenu");
    if (menu.style.display === "none" || !menu.style.display) {
      renderModelMenu();
    } else {
      menu.style.display = "none";
    }
  };
  document.addEventListener("click", (e) => {
    if (!$("#modelMenu").contains(e.target) && e.target.id !== "modelBtn" && !e.target.closest("#modelBtn")) {
      $("#modelMenu").style.display = "none";
    }
  });
  $("#addModelFromMenuBtn").onclick = () => openModelModal();

  // 发送 / 中止 / 输入
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

  // NVIDIA 一键识别
  const parseBtn = $("#parseNvidiaBtn");
  if (parseBtn) parseBtn.onclick = applyNvidiaParseToForm;
  const pasteEl = $("#nvidiaPaste");
  if (pasteEl) pasteEl.addEventListener("paste", () => setTimeout(applyNvidiaParseToForm, 0));

  // 索引
  $("#startIndexBtn").onclick = startIndexing;
  $("#abortIndexBtn").onclick = () => { if (state.abortCtrl) state.abortCtrl.abort(); };
}

// 🔥 阅后即焚：关闭/离开页面时尽力删库（fire-and-forget）
// 主保障其实是 boot() 里每次打开先 purgeAll —— 即使这里没触发，下次打开也不留任何上次数据
window.addEventListener("pagehide", () => {
  try { Store.purgeNow(); } catch (e) { /* 忽略 */ }
});
