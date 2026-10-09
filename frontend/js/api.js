// 统一 fetch 封装：Token 注入、错误处理、加载态
const TOKEN_KEY = 'wms_token';
const USER_KEY = 'wms_user';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
export function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: payload });
  } catch (e) {
    throw new ApiError('网络请求失败，请检查服务是否正常运行', 0);
  }

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('wms:unauthorized'));
    throw new ApiError('登录已失效，请重新登录', 401);
  }

  if (raw) {
    if (!res.ok) throw new ApiError('导出失败（HTTP ' + res.status + '）', res.status);
    return res;
  }

  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  }
  if (!res.ok) {
    let msg = (data && (data.detail || data.message)) || `请求失败（HTTP ${res.status}）`;
    if (Array.isArray(msg)) msg = '参数校验失败';
    throw new ApiError(typeof msg === 'string' ? msg : '请求失败', res.status);
  }
  return data;
}

export const api = {
  get: (p, params) => request(p + qs(params)),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  download: (p, params) => request(p + qs(params), { raw: true }),

  // 认证
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
};

function qs(params) {
  if (!params) return '';
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

// 触发浏览器下载（携带鉴权头）
export async function downloadFile(path, params, filename) {
  const res = await api.download(path, params);
  const blob = await res.blob();
  let name = filename;
  if (!name) {
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    name = m ? decodeURIComponent(m[1]) : 'export.xlsx';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
