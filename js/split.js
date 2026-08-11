// split.js
// 编码识别 + 章节切分（port 自 VCPBookIndexGen 的 extractor，免 LLM）

// 编码识别：优先 UTF-8（带 BOM 强 UTF-8），否则试 GBK
export function readTextFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result;
      // BOM
      const view = new Uint8Array(buf);
      let encoding = "utf-8";
      let text;
      if (view.length >= 3 && view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF) {
        encoding = "utf-8";
        text = new TextDecoder("utf-8").decode(buf);
      } else {
        // 试 UTF-8：若含替换符 \uFFFD 则切 GBK
        try {
          const t = new TextDecoder("utf-8", { fatal: false }).decode(buf);
          if (t.includes("\uFFFD")) {
            encoding = "gbk";
            text = new TextDecoder("gbk").decode(buf);
          } else {
            text = t;
          }
        } catch {
          encoding = "gbk";
          text = new TextDecoder("gbk").decode(buf);
        }
      }
      resolve({ text, encoding, size: file.size, name: file.name });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// 默认章节正则：第一章 / 第X回 / Chapter N / 楔子/序章/终章/后记
// 注意：中文不接 \b，用 (?=\s|$|（/（ 等分隔）
const DEFAULT_PATTERNS = [
  { name: "cn-num", re: /^\s*第\s*[零一二三四五六七八九十百千0-9０-９]+\s*[章回卷节部篇]/ },
  { name: "english", re: /^\s*Chapter\s+[0-9IVXLCDM]+/i },
  { name: "special", re: /^\s*(楔\s*子|序\s*章|终\s*章|尾\s*声|后\s*记|前\s*言|引\s*子|番\s*外)/ },
];

export function detectChapters(text, customPattern) {
  const lines = text.split(/\r?\n/);
  // 先粗筛：找疑似章节首行
  const candidates = [];
  const patterns = customPattern
    ? [{ name: "custom", re: new RegExp(customPattern, "gm") }]
    : DEFAULT_PATTERNS;

  // 模式 1：按行匹配
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.length > 80) continue; // 章节标题一般不长
    for (const p of patterns) {
      // 不带 m 标志，对整行做 test
      const r = new RegExp(p.re.source);
      if (r.test(line)) {
        candidates.push({ line, index: i });
        break;
      }
    }
  }

  // 模式 2：基于行内数字 "第X章" 也算
  // 已包含在 cn-num 中。

  // 合并相邻（同章可能被多行描述）
  // 这里简化为：每个候选 = 一章起点
  if (candidates.length === 0) return [];

  const chapters = [];
  for (let i = 0; i < candidates.length; i++) {
    const startLine = candidates[i].index;
    const endLine = i + 1 < candidates.length ? candidates[i + 1].index : lines.length;
    const content = lines.slice(startLine, endLine).join("\n").trim();
    chapters.push({
      title: candidates[i].line,
      startLine,
      endLine,
      content,
      charCount: content.length,
    });
  }
  return chapters;
}

// 抗截断切块：按 chunk_size 在段落/句边界切
export function chunkByChar(text, chunkSize = 1500) {
  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);
  let buf = "";
  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length > chunkSize && buf) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
    // 单段超长：按句切
    while (buf.length > chunkSize) {
      // 找最近的句号/问号/叹号
      const slice = buf.slice(0, chunkSize);
      const lastStop = Math.max(
        slice.lastIndexOf("。"),
        slice.lastIndexOf("！"),
        slice.lastIndexOf("？"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
      );
      const cut = lastStop > chunkSize * 0.5 ? lastStop + 1 : chunkSize;
      chunks.push(buf.slice(0, cut));
      buf = buf.slice(cut);
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
