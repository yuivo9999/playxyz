// indexer.js
// port 自 VCPBookIndexGen / novel_indexer
// 支持 speed（每章并行信号量） / deep（串行+滚动记忆）两种模式
// 千章以上全书总结走金字塔递推归并

import { callLLM, callLLMOnce, Semaphore } from "./api.js";
import { detectChapters, chunkByChar } from "./split.js";
import { getDefaults } from "./settings.js";
import { putAsset } from "./store.js";

const SYS_PROMPT_CHAPTER = "你是一个专业的小说章节梗概助手。请用 150~300 字中文，客观概括本章节的核心剧情：人物、冲突、转折、悬念。不要剧透后续章节，不要加主观评价。";
const SYS_PROMPT_CHUNK = "你是一个专业的小说内容总结助手。请用 80~150 字中文，概括下列小说原文片段的要点，保持人物名、事件顺序、关键信息。";
const SYS_PROMPT_BOOK = "你是一个专业的小说全书梗概助手。请基于以下多章梗概，用 800~1500 字中文，写出全书的主线剧情、人物弧光、关键转折与主题。不要剧透章外内容。";
const SYS_PROMPT_MERGE = "你是小说梗概合并助手。请将以下多段梗概合并为一段 300~600 字的中文梗概，保留关键信息、去重、消除冗余。";

// ---------- 工具 ----------

function buildMessages(sysPrompt, userText) {
  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userText },
  ];
}

function shortTitle(s) {
  return s.length > 32 ? s.slice(0, 32) + "…" : s;
}

// 抗截断：超长上下文按块截取尾部 + 头部 + 提示词
function fitContext(text, maxChars) {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.6));
  const tail = text.slice(-Math.floor(maxChars * 0.4));
  return head + "\n\n[…中段省略…]\n\n" + tail;
}

// ---------- Speed 模式：每章并发（信号量） ----------

export async function runSpeedMode({ apiCfg, bookAsset, chapters, onProgress, signal, log }) {
  const { maxConcurrency = 3 } = getDefaults();
  const sem = new Semaphore(maxConcurrency);
  const total = chapters.length;
  const out = new Array(total);

  await Promise.all(chapters.map(async (ch, i) => {
    if (signal?.aborted) return;
    await sem.run(async () => {
      if (signal?.aborted) return;
      onProgress && onProgress({ phase: "chapter", current: i + 1, total, title: ch.title });
      try {
        // 先切块总结，再合并
        const chunks = chunkByChar(ch.content, 1500);
        const chunkSums = [];
        for (let k = 0; k < chunks.length; k++) {
          if (signal?.aborted) return;
          onProgress && onProgress({ phase: "chunk", chapter: i + 1, chunk: k + 1, chunkTotal: chunks.length, title: ch.title });
          const s = await callLLMOnce(apiCfg, buildMessages(SYS_PROMPT_CHUNK, chunks[k]), { signal });
          chunkSums.push(s);
          // 写回 chunk 资产
          await putAsset(bookAsset.convId, {
            id: `idx_chunk_${bookAsset.id}_${i}_${k}`,
            convId: bookAsset.convId,
            type: "index-chunk",
            name: `${shortTitle(bookAsset.name || bookAsset.title)} · ${ch.title} · 块${k+1}`,
            bookId: bookAsset.id,
            chapterIndex: i,
            chunkIndex: k,
            content: s,
          });
        }
        // 合并
        let summary;
        if (chunkSums.length === 1) {
          summary = chunkSums[0];
        } else {
          const merged = await callLLMOnce(apiCfg, buildMessages(SYS_PROMPT_MERGE, chunkSums.join("\n\n---\n\n")), { signal });
          summary = merged;
        }
        out[i] = { title: ch.title, summary };
        // 写回 chapter 资产
        await putAsset(bookAsset.convId, {
          id: `idx_chap_${bookAsset.id}_${i}`,
          convId: bookAsset.convId,
          type: "index-chapter",
          name: `${shortTitle(bookAsset.name || bookAsset.title)} · ${ch.title}`,
          bookId: bookAsset.id,
          chapterIndex: i,
          content: `# ${ch.title}\n\n${summary}`,
        });
      } catch (e) {
        log && log("error", `第 ${i+1} 章失败：${e.message}`);
        // 降级：只留原文章节名
        out[i] = { title: ch.title, summary: "(本章节因调用失败未生成梗概，原文已保留。)" };
      }
    });
  }));

  if (signal?.aborted) return { chapters: out, aborted: true };

  // 全书梗概（金字塔归并）
  onProgress && onProgress({ phase: "book", current: 0, total: 1, title: "全书总结" });
  const bookSummary = await pyramidMerge(apiCfg, out.map(c => `# ${c.title}\n${c.summary}`).join("\n\n---\n\n"), SYS_PROMPT_MERGE, SYS_PROMPT_BOOK, 4000, signal, (p) => onProgress && onProgress({ phase: "book-merge", ...p }));
  await putAsset(bookAsset.convId, {
    id: `idx_book_${bookAsset.id}`,
    convId: bookAsset.convId,
    type: "index-book",
    name: `${shortTitle(bookAsset.name || bookAsset.title)} · 全书梗概`,
    bookId: bookAsset.id,
    content: `# ${bookAsset.name || bookAsset.title} · 全书梗概\n\n${bookSummary}`,
  });
  return { chapters: out, bookSummary };
}

// ---------- Deep 模式：串行 + 滚动记忆 ----------

export async function runDeepMode({ apiCfg, bookAsset, chapters, onProgress, signal, log }) {
  const total = chapters.length;
  const out = new Array(total);
  let rollingContext = ""; // 最近若干章梗概的滚动窗口
  const ROLLING_MAX = 3;    // 保留最近 3 章梗概
  const ROLLING_CHARS = 3000;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) break;
    onProgress && onProgress({ phase: "chapter", current: i + 1, total, title: chapters[i].title });
    try {
      const ch = chapters[i];
      const contextHeader = rollingContext
        ? `以下是前几章梗概回顾（用于保持连贯性）：\n${rollingContext}\n\n现在请总结本章：\n`
        : "";
      const userText = contextHeader + fitContext(ch.content, 6000);
      const summary = await callLLMOnce(apiCfg, buildMessages(SYS_PROMPT_CHAPTER, userText), { signal });
      out[i] = { title: ch.title, summary };
      await putAsset(bookAsset.convId, {
        id: `idx_chap_${bookAsset.id}_${i}`,
        convId: bookAsset.convId,
        type: "index-chapter",
        name: `${shortTitle(bookAsset.name || bookAsset.title)} · ${ch.title}`,
        bookId: bookAsset.id,
        chapterIndex: i,
        content: `# ${ch.title}\n\n${summary}`,
      });

      // 更新滚动记忆
      rollingContext = (rollingContext + "\n\n" + `# ${ch.title}\n${summary}`).slice(-ROLLING_CHARS);
      // 若滚动超长，自我浓缩一次
      if (rollingContext.length >= ROLLING_CHARS) {
        try {
          const condensed = await callLLMOnce(apiCfg, buildMessages(SYS_PROMPT_MERGE, rollingContext), { signal });
          rollingContext = condensed.slice(0, ROLLING_CHARS);
        } catch (e) { /* keep */ }
      }
    } catch (e) {
      log && log("error", `第 ${i+1} 章失败：${e.message}`);
      out[i] = { title: chapters[i].title, summary: "(本章节因调用失败未生成梗概，原文已保留。)" };
    }
  }

  if (signal?.aborted) return { chapters: out, aborted: true };

  // 全书梗概
  onProgress && onProgress({ phase: "book", current: 0, total: 1, title: "全书总结" });
  const joined = out.map(c => `# ${c.title}\n${c.summary}`).join("\n\n---\n\n");
  const bookSummary = await pyramidMerge(apiCfg, joined, SYS_PROMPT_MERGE, SYS_PROMPT_BOOK, 4000, signal, (p) => onProgress && onProgress({ phase: "book-merge", ...p }));
  await putAsset(bookAsset.convId, {
    id: `idx_book_${bookAsset.id}`,
    convId: bookAsset.convId,
    type: "index-book",
    name: `${shortTitle(bookAsset.name || bookAsset.title)} · 全书梗概`,
    bookId: bookAsset.id,
    content: `# ${bookAsset.name || bookAsset.title} · 全书梗概\n\n${bookSummary}`,
  });
  return { chapters: out, bookSummary };
}

// ---------- 金字塔归并 ----------

async function pyramidMerge(apiCfg, bigText, mergePrompt, finalPrompt, groupSize = 4000, signal, onP) {
  if (!bigText.trim()) return "";
  // 段
  const segs = bigText.split(/\n\n---\n\n/);
  if (segs.length === 0) return "";
  let level = segs;
  let round = 0;
  while (level.length > 1) {
    if (signal?.aborted) return level.join("\n\n");
    round++;
    onP && onP({ level: round, current: 0, total: Math.ceil(level.length / 6) });
    const next = [];
    for (let i = 0; i < level.length; i += 6) {
      if (signal?.aborted) return level.join("\n\n");
      const group = level.slice(i, i + 6).join("\n\n---\n\n");
      try {
        const s = await callLLMOnce(apiCfg, buildMessages(mergePrompt, group), { signal });
        next.push(s);
      } catch (e) {
        // 失败：保留原内容
        next.push(group);
      }
      onP && onP({ level: round, current: Math.floor(i/6)+1, total: Math.ceil(level.length/6) });
    }
    level = next;
  }
  // 终轮：用 finalPrompt 升华
  if (level.length === 1) {
    try {
      const final = await callLLMOnce(apiCfg, buildMessages(finalPrompt, level[0]), { signal });
      return final;
    } catch (e) {
      return level[0];
    }
  }
  return level.join("\n\n");
}

// ---------- 对外入口 ----------

export async function runIndex({ mode, apiCfg, bookAsset, onProgress, signal, log }) {
  // 1. 找 book 对应的 txt 资产（按 fileIds 顺序）
  const { listAssets } = await import("./store.js");
  const all = await listAssets(bookAsset.convId);
  const txts = bookAsset.fileIds.map(fid => all.find(a => a.id === fid)).filter(Boolean);
  if (txts.length === 0) throw new Error("该书没有关联的 TXT 文件");
  const fullText = txts.map(t => t.content).join("\n\n");
  const customPattern = getDefaults().splitPattern;
  // 2. 切章
  onProgress && onProgress({ phase: "split", title: "章节切分中…" });
  const chapters = detectChapters(fullText, customPattern);
  if (chapters.length === 0) {
    throw new Error("未嗅探到任何章节。请在「设置」中填写自定义章节正则（如 ^第[一二三四五六七八九十百千0-9]+章.*$）。");
  }
  log && log("info", `共切分 ${chapters.length} 章`);
  // 3. 索引
  if (mode === "deep") {
    return await runDeepMode({ apiCfg, bookAsset, chapters, onProgress, signal, log });
  }
  return await runSpeedMode({ apiCfg, bookAsset, chapters, onProgress, signal, log });
}
