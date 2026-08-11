// main.js
import { boot } from "./ui.js";

function showStartupError(err) {
  console.error("[启动失败]", err);
  // 顶栏下方的小红条，z-index 不顶到顶栏，按钮始终可点
  const bar = document.createElement("div");
  bar.style.cssText = [
    "position:fixed",
    "top:52px",
    "left:0",
    "right:0",
    "background:#fee2e2",
    "color:#991b1b",
    "padding:10px 16px",
    "z-index:49",
    "border-bottom:1px solid #fecaca",
    "font-size:13px",
    "line-height:1.5",
    "box-shadow:0 2px 4px rgba(0,0,0,0.04)",
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
      // 等删除完成
      await new Promise(r => setTimeout(r, 300));
      location.reload();
    } catch (e) {
      alert("清空失败：" + e.message);
    }
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

window.addEventListener("DOMContentLoaded", () => {
  boot().catch(showStartupError);
});
