// 轻量全局状态与字典缓存
import { api, getUser, setUser } from './api.js';

export const store = {
  user: getUser(),
  dict: { categories: [], departments: [], staff: [], suppliers: [], items: [], devices: [] },
  alerts: { lowStock: [], calibration: null, overdueBorrow: [] },
  listeners: new Set(),

  setUser(u) { this.user = u; setUser(u); },
  isRole(...roles) { return this.user && roles.includes(this.user.role); },
  get canManage() { return this.isRole('admin', 'keeper'); },
  get isAdmin() { return this.isRole('admin'); },

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { this.listeners.forEach((fn) => fn(this)); },
};

// 基础字典缓存（带失效时间）
let dictLoadedAt = 0;
export async function loadDict(force = false) {
  const now = Date.now();
  if (!force && now - dictLoadedAt < 60_000 && store.dict.categories.length) return store.dict;
  const [categories, departments, staff, suppliers] = await Promise.all([
    api.get('/categories'),
    api.get('/departments'),
    api.get('/staff'),
    api.get('/suppliers'),
  ]);
  Object.assign(store.dict, { categories, departments, staff, suppliers });
  dictLoadedAt = now;
  return store.dict;
}

export function invalidateDict() { dictLoadedAt = 0; }

export async function loadItemOptions(force = false) {
  if (!force && store.dict.items.length) return store.dict.items;
  store.dict.items = await api.get('/items/options');
  return store.dict.items;
}

export async function loadDeviceOptions(force = false) {
  if (!force && store.dict.devices.length) return store.dict.devices;
  store.dict.devices = await api.get('/devices/options/all');
  return store.dict.devices;
}

export async function refreshAlerts() {
  try {
    const [lowStock, calibration, overdueBorrow] = await Promise.all([
      api.get('/stock/alerts'),
      api.get('/calibrations/alerts', { within: 30 }),
      api.get('/borrows/overdue'),
    ]);
    store.alerts = { lowStock, calibration, overdueBorrow };
  } catch { /* 忽略 */ }
  return store.alerts;
}

// 字典查找辅助
export function catName(id) {
  const c = store.dict.categories.find((x) => x.id === id);
  return c ? c.name : '-';
}
export function deptName(id) {
  const d = store.dict.departments.find((x) => x.id === id);
  return d ? d.name : '-';
}
export function staffName(id) {
  const s = store.dict.staff.find((x) => x.id === id);
  return s ? s.name : '-';
}
export function itemName(id) {
  const i = store.dict.items.find((x) => x.id === id);
  return i ? `${i.name}${i.spec ? ' / ' + i.spec : ''}` : '-';
}
export function deviceName(id) {
  const d = store.dict.devices.find((x) => x.id === id);
  return d ? `${d.asset_no} ${d.name}` : '-';
}
