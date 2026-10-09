// 应用入口：登录、菜单、路由注册
import { api, clearToken, getToken, setToken } from './api.js';
import { loadDict, refreshAlerts, store } from './store.js';
import { initRouter, navigate, register, render } from './router.js';
import { svgIcon, toast } from './ui.js';

import dashboard from './pages/dashboard.js';
import items from './pages/items.js';
import stock from './pages/stock.js';
import inbound from './pages/inbound.js';
import outbound from './pages/outbound.js';
import consumables from './pages/consumables.js';
import devices from './pages/devices.js';
import borrows from './pages/borrows.js';
import maintenance from './pages/maintenance.js';
import calibration from './pages/calibration.js';
import reports from './pages/reports.js';
import basedata from './pages/basedata.js';

/* ================= 菜单定义 ================= */
const MENU = [
  { group: '概览', items: [
    { path: '/dashboard', label: '数据看板', icon: 'dashboard', sub: '仓库运营总览' },
  ]},
  { group: '库存管理', items: [
    { path: '/items', label: '物品档案', icon: 'box', sub: '耗材物料基础信息' },
    { path: '/stock', label: '实时库存', icon: 'stock', sub: '库存查询与预警' },
    { path: '/inbound', label: '入库管理', icon: 'inbox', sub: '入库单登记与确认' },
    { path: '/outbound', label: '出库管理', icon: 'outbox', sub: '出库单登记与确认' },
  ]},
  { group: '耗材', items: [
    { path: '/consumables', label: '领用与消耗', icon: 'cart', sub: '领用登记与消耗统计' },
  ]},
  { group: '设备管理', items: [
    { path: '/devices', label: '设备台账', icon: 'monitor', sub: '设备全生命周期' },
    { path: '/borrows', label: '借用归还', icon: 'transfer', sub: '借出归还与逾期' },
    { path: '/maintenance', label: '维保记录', icon: 'wrench', sub: '保养与维修记录' },
    { path: '/calibration', label: '校准提醒', icon: 'clock', sub: '校准计划与预警' },
  ]},
  { group: '报表', items: [
    { path: '/reports', label: '统计报表', icon: 'chart', sub: '月度报表与导出' },
    { path: '/basedata', label: '基础数据', icon: 'settings', sub: '部门/人员/分类/供应商', adminOnly: true },
  ]},
];

const TITLES = {};
MENU.forEach((g) => g.items.forEach((it) => (TITLES[it.path] = it)));

/* ================= 登录 ================= */
async function doLogin(username, password) {
  const res = await api.login(username, password);
  setToken(res.token);
  store.setUser(res.user);
  return res.user;
}

function showLogin() {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  buildNav();
  updateUserChip();
  navigate('/dashboard');
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = MENU.map((g) => {
    const items = g.items.filter((it) => !it.adminOnly || store.isAdmin);
    if (!items.length) return '';
    return `<div class="nav-group">
      <div class="nav-group-title">${g.group}</div>
      ${items.map((it) => `
        <button class="nav-item" data-path="${it.path}">
          ${svgIcon(it.icon)}
          <span class="label">${it.label}</span>
          ${it.path === '/stock' ? '<span class="badge-dot hidden" data-badge="low"></span>' : ''}
          ${it.path === '/calibration' ? '<span class="badge-dot hidden" data-badge="cal"></span>' : ''}
          ${it.path === '/borrows' ? '<span class="badge-dot hidden" data-badge="borrow"></span>' : ''}
        </button>`).join('')}
    </div>`;
  }).join('');

  nav.querySelectorAll('.nav-item').forEach((b) => {
    b.addEventListener('click', () => {
      navigate(b.dataset.path);
      document.getElementById('app').classList.remove('mobile-open');
    });
  });
}

function highlightNav(path) {
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.path === path);
  });
  const t = TITLES[path];
  if (t) {
    document.getElementById('page-title').textContent = t.label;
    document.getElementById('page-subtitle').textContent = t.sub;
  }
}

function updateUserChip() {
  const u = store.user || {};
  document.getElementById('user-name').textContent = u.display_name || '—';
  document.getElementById('user-role').textContent = u.role_label || u.role || '—';
  document.getElementById('user-avatar').textContent = (u.display_name || 'U').charAt(0);
}

async function updateAlertBadges() {
  const a = store.alerts;
  const lowN = (a.lowStock || []).length;
  const calN = a.calibration ? (a.calibration.summary.expired_count + a.calibration.summary.expiring_count) : 0;
  const borN = (a.overdueBorrow || []).length;
  const set = (key, n) => {
    const el = document.querySelector(`[data-badge="${key}"]`);
    if (!el) return;
    el.textContent = n;
    el.classList.toggle('hidden', !n);
  };
  set('low', lowN); set('cal', calN); set('borrow', borN);

  const box = document.getElementById('sidebar-alerts');
  const chips = [];
  if (lowN) chips.push(`<div class="alert-chip danger" data-go="/stock"><span>低库存预警</span><b>${lowN}</b></div>`);
  if (calN) chips.push(`<div class="alert-chip warning" data-go="/calibration"><span>校准待处理</span><b>${calN}</b></div>`);
  if (borN) chips.push(`<div class="alert-chip danger" data-go="/borrows"><span>设备逾期未还</span><b>${borN}</b></div>`);
  box.innerHTML = chips.join('');
  box.querySelectorAll('[data-go]').forEach((c) => c.addEventListener('click', () => navigate(c.dataset.go)));
}

/* ================= 全局事件 ================= */
function bindShell() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try { await api.logout(); } catch { /* ignore */ }
    clearToken();
    showLogin();
  });

  document.getElementById('menu-toggle').addEventListener('click', () => {
    const app = document.getElementById('app');
    if (window.innerWidth <= 900) app.classList.toggle('mobile-open');
    else app.classList.toggle('collapsed');
  });

  // 时钟
  const clock = document.getElementById('clock');
  const tick = () => {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    clock.textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 周${wd} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  tick(); setInterval(tick, 1000);

  window.addEventListener('wms:unauthorized', () => { showLogin(); toast('登录已失效，请重新登录', 'warning'); });
  window.addEventListener('wms:navigated', (e) => highlightNav(e.detail.path));
  window.addEventListener('wms:refresh-alerts', updateAlertBadges);
}

/* ================= 启动 ================= */
async function boot() {
  register('/dashboard', dashboard);
  register('/items', items);
  register('/stock', stock);
  register('/inbound', inbound);
  register('/outbound', outbound);
  register('/consumables', consumables);
  register('/devices', devices);
  register('/borrows', borrows);
  register('/maintenance', maintenance);
  register('/calibration', calibration);
  register('/reports', reports);
  register('/basedata', basedata);
  initRouter();

  bindShell();

  // 登录表单
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const err = document.getElementById('login-error');
    err.textContent = '';
    btn.disabled = true; btn.textContent = '登录中…';
    try {
      await doLogin(
        document.getElementById('login-username').value.trim(),
        document.getElementById('login-password').value,
      );
      await afterLogin();
    } catch (ex) {
      err.textContent = ex.message || '登录失败';
    } finally {
      btn.disabled = false; btn.textContent = '登 录';
    }
  });

  document.querySelectorAll('.demo-account').forEach((b) => {
    b.addEventListener('click', () => {
      document.getElementById('login-username').value = b.dataset.user;
      document.getElementById('login-password').value = b.dataset.pass;
      form.dispatchEvent(new Event('submit'));
    });
  });

  // 已有 token 直接进入
  if (getToken()) {
    try {
      const me = await api.me();
      store.setUser(me);
      await afterLogin();
      return;
    } catch { clearToken(); }
  }
  showLogin();
}

async function afterLogin() {
  showApp();
  try {
    await loadDict(true);
    await refreshAlerts();
    updateAlertBadges();
  } catch (e) { /* 非致命 */ }
  render();
}

boot();
