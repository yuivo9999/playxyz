# 网页版超长小说阅读助手

> 纯客户端、本地持久、多 API、可生成三层索引的小说阅读 / 索引助手。
> 基于 `lioensky/VCPBookIndexGen` 的「全书梗概 → 章节梗概 → 原文碎块」分层索引思路 port 到浏览器。

## 特性

- **零后端**：纯静态站点，可直接放 GitHub Pages。
- **本地持久**：API key、上传小说、索引产物、对话历史存于 `localStorage` + `IndexedDB`。
- **多 API / 多模型**：设置里存多组 `{别名, base_url, api_key, model}`，随时切换。
- **两个 skill**：
  - 💬 **仅对话**：勾选资产 → 注入上下文 → 流式对话
  - ⚙️ **VCPBookIndexGen**：选书 → speed / deep 模式 → 三层索引写回资产库
- **☰ 抽屉导航**：新建对话 / 设置 / 历史 / 存储管理
- **存储管理**：浏览器配额、单对话占用、批量删除、导入导出 JSON
- **令牌桶限速**：浏览器侧全局单例 ≤ 30 次/分钟
- **流式 SSE**：实时渲染 LLM 输出，可中止
- **抗截断切块**：按字符 + 段/句边界切，章节正则嗅探，支持自定义

## 部署

### 本地预览

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

### GitHub Pages 自动化部署（推荐）

1. **创建仓库** `github.com/yuivo9999/playxyz`（Public）
2. 把本目录**全部内容**（含 `.nojekyll`、`404.html`、`.github/workflows/pages.yml`）推送到仓库根：

   ```bash
   cd playxyz
   git init
   git add .
   git commit -m "feat: 初始版本"
   git branch -M main
   git remote add origin https://github.com/yuivo9999/playxyz.git
   git push -u origin main
   ```

3. **设置 Pages**：仓库 → **Settings** → **Pages** → **Build and deployment**
   - Source 选 **GitHub Actions**
4. 等 1~2 分钟，Action 跑完后，地址：  
   **`https://yuivo9999.github.io/playxyz/`**

> 注：仓库根就是这个项目（直接 push 整个 `web_novel_reader/` 里的文件）。如果想放成子路径，URL 就要带 `/playxyz/`。

### 已配好的自动化文件

| 文件 | 作用 |
|---|---|
| `.nojekyll` | 跳过 Jekyll，原样托管（避免下划线开头的资源被忽略） |
| `404.html` | 任意路径自动跳回 `index.html` |
| `.github/workflows/pages.yml` | push 到 main 自动触发官方 Actions 部署 |
| `index.html` | 入口，相对路径引用 css/js，子路径部署也兼容 |

## 目录结构

```
web_novel_reader/
├── index.html        # 单页骨架
├── css/styles.css
├── js/
│   ├── main.js       # 启动
│   ├── ui.js         # UI 渲染 / 事件
│   ├── store.js      # IndexedDB 封装
│   ├── settings.js   # localStorage 多 API
│   ├── api.js        # 令牌桶 + 流式 SSE fetch
│   ├── split.js      # 编码识别 + 章节切分
│   └── indexer.js    # speed / deep 索引 + 金字塔归并
└── README.md
```

## 使用流程

1. ⚙ 设置 → 填 API（base_url / api_key / model）
2. 上传 TXT（拖拽 / 选择文件），可勾选多卷后「合并为同一本书」
3. 切到 VCPBookIndexGen → 选书 → 选模式 → 开始
4. 索引结果以 `index-book / index-chapter / index-chunk` 三种资产回写
5. 切回「仅对话」→ 勾选书 / 章节 → 发问

## 风险与已知限制

- 密钥明文存于 `localStorage`：仅建议本机 / 不公开部署
- CORS：纯客户端直连要求所选模型端点允许浏览器跨域（Ollama 本地、部分供应商支持）
- IndexedDB 容量：多本小说可能占数十 MB，存储面板可查看并清理
- 整本 TXT 在内存处理：≤100MB/文件，超过会被拒
- 索引任务随页面关闭中止，重开可重跑

## 与 VCPBookIndexGen 对应

| 原 Python                | 本项目实现                          |
|--------------------------|-------------------------------------|
| `config.read_file`       | `split.js · readTextFromFile`（含编码识别） |
| `extractor.ChapterExtractor` | `split.js · detectChapters`（正则嗅探） |
| `TextChunker`            | `split.js · chunkByChar`（按字符+句界） |
| `SpeedSummarizer`        | `indexer.js · runSpeedMode`（Semaphore 并发） |
| `DeepSummarizer`         | `indexer.js · runDeepMode`（串行+滚动记忆+自浓缩） |
| `BookSummarizer`         | `indexer.js · pyramidMerge`（金字塔递推归并） |
| `writer`                 | `store.js · putAsset`（落 IndexedDB） |
| 限速（外部）             | `api.js · TokenBucket`（≤30/分钟） |
