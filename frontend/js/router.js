// hash 路由：页面注册与切换
const routes = new Map();
let current = null;
let cleanupFn = null;

export function register(path, handler) { routes.set(path, handler); }

export function navigate(path, replace = false) {
  const hash = '#' + path;
  if (location.hash === hash) { render(); return; }
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
}

export function currentPath() {
  const h = location.hash.replace(/^#/, '');
  return h || '/dashboard';
}

export async function render() {
  const path = currentPath();
  const query = {};
  const [pure, qs] = path.split('?');
  if (qs) new URLSearchParams(qs).forEach((v, k) => (query[k] = v));

  const handler = routes.get(pure) || routes.get('/dashboard');
  if (!handler) return;

  if (typeof cleanupFn === 'function') {
    try { cleanupFn(); } catch { /* ignore */ }
    cleanupFn = null;
  }

  const container = document.getElementById('content');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>正在加载…</div>';

  current = pure;
  try {
    const result = await handler(container, query);
    if (result && typeof result.cleanup === 'function') cleanupFn = result.cleanup;
  } catch (e) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6">
        <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/>
      </svg>
      <p>页面加载失败：${escapeHtml(e.message || e)}</p>
      <button class="btn btn-sm" onclick="location.reload()" style="margin-top:12px">重新加载</button>
    </div>`;
  }
  window.dispatchEvent(new CustomEvent('wms:navigated', { detail: { path: pure } }));
}

export function initRouter() {
  window.addEventListener('hashchange', render);
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
