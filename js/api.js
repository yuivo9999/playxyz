// api.js
// OpenAI 兼容协议的流式 LLM 调用（无令牌桶）

import { getApi } from "./settings.js";

// ---------- SSE 解析 ----------
// 按行解析 data: {...} 流，data: [DONE] 结束
function parseSSEChunk(buffer) {
  const events = [];
  const parts = buffer.split("\n");
  let rest = "";
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (i === parts.length - 1 && !buffer.endsWith("\n")) {
      rest = line;
      break;
    }
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        events.push({ done: true });
      } else if (payload) {
        try { events.push({ data: JSON.parse(payload) }); }
        catch { events.push({ data: payload }); }
      }
    }
  }
  return { events, rest };
}

// ---------- 流式调用 ----------
// apiCfg: { base_url, api_key, model }
// messages: [{role, content}]
// onToken: (textDelta) => void
// onDone: () => void
// onError: (err) => void
// signal: AbortSignal
export async function callLLM(apiCfg, messages, { onToken, onDone, onError, signal } = {}) {
  const url = (apiCfg.base_url || "").replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model: apiCfg.model,
    messages,
    stream: true,
    temperature: 0.4,
  };
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + (apiCfg.api_key || ""),
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    onError && onError(new Error("网络错误：" + e.message + "（可能是 CORS 拦截或 base_url 错误）"));
    return;
  }
  if (!resp.ok) {
    let txt = "";
    try { txt = await resp.text(); } catch {}
    onError && onError(new Error(`HTTP ${resp.status}：${txt.slice(0, 300)}`));
    return;
  }
  if (!resp.body) {
    onError && onError(new Error("响应无 body（可能被代理拦截）"));
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSSEChunk(buffer);
      buffer = rest;
      for (const ev of events) {
        if (ev.done) { onDone && onDone(); return; }
        const d = ev.data;
        const delta = d?.choices?.[0]?.delta?.content
          || d?.choices?.[0]?.message?.content
          || "";
        if (delta) onToken && onToken(delta);
      }
    }
    onDone && onDone();
  } catch (e) {
    onError && onError(e);
  }
}

// 一次性调用（用于小段总结、信号量内汇总）
export async function callLLMOnce(apiCfg, messages, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let text = "";
    callLLM(apiCfg, messages, {
      signal,
      onToken: (t) => { text += t; },
      onDone: () => resolve(text),
      onError: (e) => reject(e),
    });
  });
}

// 信号量：Promise 池（用于 speed 模式并发限流）
export class Semaphore {
  constructor(n) { this.n = n; this.cur = 0; this.q = []; }
  async acquire() {
    if (this.cur < this.n) { this.cur++; return; }
    await new Promise(r => this.q.push(r));
    this.cur++;
  }
  release() {
    this.cur--;
    const next = this.q.shift();
    if (next) next();
  }
  async run(fn) {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }
}

// 包装 callLLM 走指定 alias
export async function callByAlias(alias, messages, hooks) {
  const api = getApi(alias);
  if (!api) throw new Error("未找到 API 别名：" + alias);
  return callLLM(api, messages, hooks);
}
