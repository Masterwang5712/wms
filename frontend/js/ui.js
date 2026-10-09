// UI 通用组件：格式化、表格、分页、Modal、Drawer、Toast、Badge
import { escapeHtml } from './router.js';

/* ================= 格式化 ================= */
export function fmtMoney(n, withSymbol = true) {
  const v = Number(n || 0);
  const s = v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withSymbol ? '¥' + s : s;
}
export function fmtNum(n) {
  return Number(n || 0).toLocaleString('zh-CN');
}
export function fmtDate(s) {
  if (!s) return '-';
  return String(s).slice(0, 10);
}
export function fmtDateTime(s) {
  if (!s) return '-';
  return String(s).slice(0, 16);
}
export function today() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function daysFromNow(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
export function fmtDaysLeft(dateStr) {
  const d = daysFromNow(dateStr);
  if (d === null) return '-';
  if (d < 0) return `已过期 ${-d} 天`;
  if (d === 0) return '今天到期';
  return `剩 ${d} 天`;
}

/* ================= 常量映射 ================= */
export const STATUS_MAP = {
  in_use: { label: '在用', cls: 'success' },
  idle: { label: '闲置', cls: 'gray' },
  repairing: { label: '维修中', cls: 'warning' },
  borrowed: { label: '借出', cls: 'info' },
  scrapped: { label: '已报废', cls: 'danger' },
};
export const CAL_MAP = {
  expired: { label: '已过期', cls: 'danger' },
  expiring: { label: '临期', cls: 'warning' },
  ok: { label: '正常', cls: 'success' },
  none: { label: '无需校准', cls: 'gray' },
};
export const ORDER_STATUS = {
  draft: { label: '草稿', cls: 'gray' },
  confirmed: { label: '已确认', cls: 'success' },
};
export const BORROW_STATUS = {
  borrowed: { label: '借用中', cls: 'info' },
  returned: { label: '已归还', cls: 'gray' },
  overdue: { label: '已逾期', cls: 'danger' },
};
export const TXN_TYPE = { in: { label: '入库', cls: 'danger' }, out: { label: '出库', cls: 'success' }, adjust: { label: '盘点', cls: 'warning' } };

export function badge(text, cls = 'gray') {
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}
export function statusBadge(status) {
  const m = STATUS_MAP[status] || { label: status, cls: 'gray' };
  return badge(m.label, m.cls);
}
export function calBadge(status, dateStr) {
  const m = CAL_MAP[status] || { label: '-', cls: 'gray' };
  const suffix = status === 'expired' || status === 'expiring' ? `（${fmtDaysLeft(dateStr)}）` : '';
  return badge(m.label + suffix, m.cls);
}
export function orderBadge(status) {
  const m = ORDER_STATUS[status] || { label: status, cls: 'gray' };
  return badge(m.label, m.cls);
}
export function borrowBadge(status) {
  const m = BORROW_STATUS[status] || { label: status, cls: 'gray' };
  return badge(m.label, m.cls);
}
export function txnBadge(type) {
  const m = TXN_TYPE[type] || { label: type, cls: 'gray' };
  return badge(m.label, m.cls);
}

/* ================= 图标 ================= */
export const ICON = {
  dashboard: '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  inbox: '<path d="M3 12h5l2 3h4l2-3h5M3 12l2-7h14l2 7v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  outbox: '<path d="M3 12h5l2 3h4l2-3h5M3 12l2-7h14l2 7v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  stock: '<path d="M3 7h18M3 12h18M3 17h18"/>',
  cart: '<circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><path d="M2 3h3l2.4 12.4A2 2 0 0 0 9.4 17h8.7a2 2 0 0 0 2-1.6L21 7H6"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  transfer: '<path d="M7 4v13M7 4L3 8M7 4l4 4M17 20V7M17 20l4-4M17 20l-4-4"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-9 9a2.8 2.8 0 0 1-4-4l9-9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 5-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.6H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 3V3a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15.4 4.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 9h.1a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.6 2z"/>',
  warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5" stroke-linecap="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke-linecap="round"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
  money: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1.1-3 2.5S10.3 12 12 12s3 1.1 3 2.5S13.7 17 12 17s-3-1.1-3-2.5"/>',
};

export function svgIcon(name, size = 17) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ''}</svg>`;
}

/* ================= Toast ================= */
export function toast(msg, type = 'info', duration = 2600) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '!' : 'i';
  el.innerHTML = `<span class="badge ${type === 'info' ? 'primary' : type}" style="padding:0;width:18px;height:18px;border-radius:50%;justify-content:center">${icon}</span><span class="msg">${escapeHtml(msg)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 260);
  }, duration);
}

/* ================= 表格 ================= */
/**
 * renderTable({columns, rows, empty, rowClass, onRowClick})
 * columns: [{key, title, align, width, render(row)}]
 */
export function renderTable({ columns, rows, empty = '暂无数据', rowClass, onRowClick }) {
  if (!rows || !rows.length) {
    return `<div class="empty-state">
      <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4"/>
      </svg>
      <p>${escapeHtml(empty)}</p>
    </div>`;
  }
  const head = columns.map((c) => `<th${c.align === 'right' ? ' style="text-align:right"' : ''}${c.width ? ` style="width:${c.width}"` : ''}>${escapeHtml(c.title)}</th>`).join('');
  const body = rows.map((r, i) => {
    const cls = [rowClass ? rowClass(r) : '', onRowClick ? 'clickable' : ''].filter(Boolean).join(' ');
    const tds = columns.map((c) => {
      const v = c.render ? c.render(r) : escapeHtml(r[c.key]);
      const style = c.align === 'right' ? ' class="num"' : '';
      return `<td${style}>${v}</td>`;
    }).join('');
    return `<tr class="${cls}" data-idx="${i}">${tds}</tr>`;
  }).join('');

  const html = `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  return html;
}

export function bindRowClick(container, rows, handler) {
  if (!handler) return;
  container.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      const idx = Number(tr.dataset.idx);
      handler(rows[idx], idx);
    });
  });
}

/* ================= 分页 ================= */
export function renderPagination(p, onPage) {
  const { total, page, size, pages } = p;
  const wrap = document.createElement('div');
  wrap.className = 'pagination';
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);

  let btns = '';
  const push = (n, label, active = false, disabled = false) =>
    (btns += `<button class="page-btn${active ? ' active' : ''}" data-page="${n}"${disabled ? ' disabled' : ''}>${label}</button>`);

  push(page - 1, '‹', false, page <= 1);
  const win = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) win.push(i);
  }
  let prev = 0;
  for (const i of win) {
    if (prev && i - prev > 1) btns += '<span style="padding:0 3px;color:var(--text-3)">…</span>';
    push(i, String(i), i === page);
    prev = i;
  }
  push(page + 1, '›', false, page >= pages);

  wrap.innerHTML = `<span>共 <b>${fmtNum(total)}</b> 条，第 ${from}-${to} 条</span><div class="page-btns">${btns}</div>`;
  wrap.querySelectorAll('.page-btn[data-page]').forEach((b) => {
    b.addEventListener('click', () => {
      const n = Number(b.dataset.page);
      if (n >= 1 && n <= pages && n !== page) onPage(n);
    });
  });
  return wrap;
}

/* ================= Modal ================= */
export function openModal({ title, body, footer, width = '', onMount, className = '' }) {
  const root = document.getElementById('modal-root');
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal ${width} ${className}">
      <div class="modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close" aria-label="关闭">×</button>
      </div>
      <div class="modal-body"></div>
      ${footer !== null ? '<div class="modal-foot"></div>' : ''}
    </div>`;
  const bodyEl = mask.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  if (footer !== null && footer !== undefined) {
    const footEl = mask.querySelector('.modal-foot');
    if (typeof footer === 'string') footEl.innerHTML = footer;
    else if (footer) footEl.appendChild(footer);
  }

  function close() {
    mask.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  mask.querySelector('.modal-close').addEventListener('click', close);
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
  document.addEventListener('keydown', onKey);

  root.appendChild(mask);
  if (onMount) onMount(mask, close);
  const firstInput = mask.querySelector('input:not([type=hidden]), select, textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 60);
  return { el: mask, close };
}

export function confirmDialog(title, message, { danger = false, okText = '确定' } = {}) {
  return new Promise((resolve) => {
    const footer = document.createElement('div');
    footer.className = 'btn-row';
    footer.innerHTML = `<button class="btn" data-act="cancel">取消</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escapeHtml(okText)}</button>`;
    const { close } = openModal({
      title,
      body: `<p style="font-size:13.5px;color:var(--text-2);line-height:1.75">${escapeHtml(message)}</p>`,
      footer,
      className: 'narrow',
      onMount(el, closeFn) {
        footer.querySelector('[data-act=cancel]').onclick = () => { closeFn(); resolve(false); };
        footer.querySelector('[data-act=ok]').onclick = () => { closeFn(); resolve(true); };
      },
    });
    // 点击遮罩关闭视为取消
    resolve.__fallback = close;
  });
}

/* ================= Drawer ================= */
export function openDrawer({ title, body, onMount, width }) {
  const root = document.getElementById('drawer-root');
  const mask = document.createElement('div');
  mask.className = 'drawer-mask';
  const panel = document.createElement('div');
  panel.className = 'drawer';
  if (width) panel.style.width = width;
  panel.innerHTML = `
    <div class="drawer-head">
      <h3>${escapeHtml(title)}</h3>
      <button class="modal-close" aria-label="关闭">×</button>
    </div>
    <div class="drawer-body"></div>`;
  const bodyEl = panel.querySelector('.drawer-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  function close() {
    mask.remove(); panel.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  panel.querySelector('.modal-close').addEventListener('click', close);
  mask.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  root.appendChild(mask); root.appendChild(panel);
  if (onMount) onMount(panel, close);
  return { el: panel, close };
}

/* ================= 表单辅助 ================= */
export function formData(formEl) {
  const out = {};
  formEl.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked ? 1 : 0;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value === '' ? null : el.value;
  });
  return out;
}

export function options(list, { valueKey = 'id', labelKey = 'name', selected, placeholder, labelFn } = {}) {
  let html = '';
  if (placeholder !== undefined) html += `<option value="">${escapeHtml(placeholder)}</option>`;
  for (const it of list || []) {
    const v = it[valueKey];
    const l = labelFn ? labelFn(it) : it[labelKey];
    html += `<option value="${v}"${String(selected) === String(v) ? ' selected' : ''}>${escapeHtml(l)}</option>`;
  }
  return html;
}

export function field(label, inputHtml, { span = 1, required = false, hint } = {}) {
  return `<label class="field${span === 2 ? ' span-2' : ''}">
    <span class="${required ? 'req' : ''}">${escapeHtml(label)}</span>
    ${inputHtml}
    ${hint ? `<span class="form-hint">${escapeHtml(hint)}</span>` : ''}
  </label>`;
}
