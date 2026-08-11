// main.js
import { boot, bindGlobalUI } from "./ui.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function showStartupError(err) {
  console.error("[启动失败]", err);
  // 顶栏下方的红条，不遮顶栏
  const bar = document.createElement("div");
  bar.style.cssText = [
    "position:fixed", "top:48px", "left:0", "right:0",
    "background:#fee2e2", "color:#991b1b",
    "padding:10px 16px", "z-index:49",
    "border-bottom:1px solid #fecaca",
    "font-size:13px", "line-height:1.5",
  ].join(";");
  bar.innerHTML = `
    <strong>⚠ 启动失败：</strong> ${escapeHtml(err && err.message ? err.message : String(err))}
    <button id="__resetDbBtn" style="margin-left:12px;padding:2px 8px;border:1px solid #991b1b;background:#fff;color:#991b1b;border-radius:4px;cursor:pointer">清空数据库重试</button>
    <button id="__closeErrBtn" style="margin-left:6px;padding:2px 8px;border:0;background:transparent;color:#991b1b;cursor:pointer">关闭</button>
  `;
  document.body.appendChild(bar);
  document.getElementById("__closeErrBtn").onclick = () => bar.remove();
  document.getElementById("__resetDbBtn").onclick = async () => {
    if (!confirm("将清空本浏览器内所有对话/资产/索引，确定？")) return;
    try {
      indexedDB.deleteDatabase("web_novel_reader");
      await new Promise(r => setTimeout(r, 400));
      location.reload();
    } catch (e) { alert("清空失败：" + e.message); }
  };
}

// 关键：先同步绑定所有 UI 事件，再异步 boot
// 这样即使 boot 出错，☰ 等按钮仍然可用
function start() {
  try {
    bindGlobalUI();
  } catch (e) {
    console.error("[bindGlobalUI 失败]", e);
  }
  boot().catch(showStartupError);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
