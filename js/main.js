// main.js
import { boot } from "./ui.js";

window.addEventListener("DOMContentLoaded", () => {
  boot().catch(e => {
    console.error(e);
    document.body.insertAdjacentHTML("afterbegin", `<div style="position:fixed;top:0;left:0;right:0;background:#fdd;color:#900;padding:12px;z-index:9999">启动失败：${e.message}</div>`);
  });
});
