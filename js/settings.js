// settings.js
// localStorage 多 API 配置 CRUD

const KEY_APIS = "wnr_apis";
const KEY_DEFAULTS = "wnr_defaults";

function safeParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

export function listApis() {
  return safeParse(localStorage.getItem(KEY_APIS), []);
}

export function getApi(alias) {
  return listApis().find(a => a.alias === alias) || null;
}

export function saveApi(api) {
  const list = listApis();
  const i = list.findIndex(a => a.alias === api.alias);
  if (i >= 0) list[i] = api; else list.push(api);
  localStorage.setItem(KEY_APIS, JSON.stringify(list));
}

export function deleteApi(alias) {
  const list = listApis().filter(a => a.alias !== alias);
  localStorage.setItem(KEY_APIS, JSON.stringify(list));
}

export function getDefaults() {
  return safeParse(localStorage.getItem(KEY_DEFAULTS), {
    defaultApiAlias: null,
    chunkSize: 1500,
    maxConcurrency: 3,
    splitPattern: null, // 自定义章节正则
  });
}

export function saveDefaults(d) {
  const cur = getDefaults();
  localStorage.setItem(KEY_DEFAULTS, JSON.stringify({ ...cur, ...d }));
}

export function ensureAtLeastOneApi() {
  if (listApis().length === 0) {
    // 不主动写入任何真实 key；只放一个示例占位，让 UI 引导用户填
    return false;
  }
  return true;
}
