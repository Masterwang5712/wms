// 校准提醒：三色统计 + 提醒列表 + 校准记录 + 登记校准
import { api } from '../api.js';
import { loadDict, loadDeviceOptions, store } from '../store.js';
import { escapeHtml, navigate } from '../router.js';
import {
  badge, calBadge, confirmDialog, field, fmtDate, fmtDaysLeft, fmtMoney, openModal,
  renderPagination, renderTable, svgIcon, toast, today, formData,
} from '../ui.js';

let state = { tab: 'alert', page: 1, size: 20, keyword: '' };

export default async function calibration(container) {
  await loadDict();
  container.innerHTML = `
    <div class="toolbar">
      <div class="tabs" style="margin:0;border:none">
        <button class="tab ${state.tab === 'alert' ? 'active' : ''}" data-tab="alert">校准提醒</button>
        <button class="tab ${state.tab === 'records' ? 'active' : ''}" data-tab="records">校准记录</button>
      </div>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="btn-export">${svgIcon('download', 15)} 导出校准台账</button>
      <button class="btn btn-sm btn-primary" id="btn-new" ${store.canManage ? '' : 'disabled'}>${svgIcon('plus', 15)} 登记校准</button>
    </div>
    <div id="tab-body"></div>`;

  container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    state.tab = t.dataset.tab; state.page = 1;
    container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    renderTab();
  }));
  container.querySelector('#btn-new').addEventListener('click', () => openForm(renderTab));
  container.querySelector('#btn-export').addEventListener('click', async () => {
    const { downloadFile } = await import('../api.js');
    try { await downloadFile('/export/calibration.xlsx'); toast('导出成功', 'success'); } catch (e) { toast(e.message, 'error'); }
  });

  const tabBody = container.querySelector('#tab-body');

  async function renderTab() {
    const data = await api.get('/calibrations/alerts', { within: 30 });
    const s = data.summary;

    container.querySelector('.grid-kpi')?.remove();
    tabBody.innerHTML = `
      <div class="grid grid-kpi" style="margin-bottom:18px">
        <div class="kpi"><div class="kpi-top"><span class="kpi-label">已过期</span><span class="kpi-icon ${s.expired_count ? 'danger' : 'success'}">${svgIcon('warn', 17)}</span></div>
          <div class="kpi-value ${s.expired_count ? 'text-danger' : ''}">${s.expired_count}</div>
          <div class="kpi-foot">${s.expired_count ? '需立即安排校准' : '无过期设备'}</div></div>
        <div class="kpi"><div class="kpi-top"><span class="kpi-label">临期（30 天内）</span><span class="kpi-icon warning">${svgIcon('clock', 17)}</span></div>
          <div class="kpi-value ${s.expiring_count ? 'text-warning' : ''}">${s.expiring_count}</div>
          <div class="kpi-foot">建议提前预约校准</div></div>
        <div class="kpi"><div class="kpi-top"><span class="kpi-label">校准正常</span><span class="kpi-icon success">${svgIcon('clock', 17)}</span></div>
          <div class="kpi-value">${s.ok_count}</div><div class="kpi-foot">校准日期充裕</div></div>
        <div class="kpi"><div class="kpi-top"><span class="kpi-label">需校准设备总数</span><span class="kpi-icon info">${svgIcon('monitor', 17)}</span></div>
          <div class="kpi-value">${s.total}</div><div class="kpi-foot">不含无需校准与已报废设备</div></div>
      </div>
      <div id="sub-body"></div>`;

    if (state.tab === 'alert') await renderAlerts(data);
    else await renderRecords();
  }

  /* ============ 提醒列表（按剩余天数排序） ============ */
  async function renderAlerts(data) {
    const sub = tabBody.querySelector('#sub-body');
    const rows = [...data.expired, ...data.expiring, ...(data.ok_count ? await okRows() : [])];

    if (!rows.length) {
      sub.innerHTML = `<div class="card"><div class="empty-state" style="padding:50px 0">
        <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p>暂无需要校准的设备</p></div></div>`;
      return;
    }

    sub.innerHTML = '<div class="card"><div class="card-body tight" id="area"></div></div>';
    const area = sub.querySelector('#area');
    const cols = [
      { key: 'asset_no', title: '资产编号', render: (r) => `<span class="mono"><b>${escapeHtml(r.asset_no)}</b></span>` },
      { key: 'name', title: '设备名称', render: (r) => `<b>${escapeHtml(r.name)}</b>${r.model ? `<div class="muted" style="font-size:11.5px">${escapeHtml(r.model)}</div>` : ''}` },
      { key: 'location', title: '存放位置', render: (r) => `<span class="muted">${escapeHtml(r.location || '-')}</span>` },
      { key: 'department_name', title: '使用部门', render: (r) => escapeHtml(r.department_name || '-') },
      { key: 'custodian_name', title: '责任人', render: (r) => escapeHtml(r.custodian_name || '-') },
      { key: 'calibration_cycle_days', title: '校准周期', align: 'right', render: (r) => `${r.calibration_cycle_days} 天` },
      { key: 'last_calibration_date', title: '上次校准', render: (r) => `<span class="mono muted">${fmtDate(r.last_calibration_date)}</span>` },
      { key: 'next_calibration_date', title: '下次校准', render: (r) => `<span class="mono">${fmtDate(r.next_calibration_date)}</span>` },
      { key: 'days_left', title: '剩余天数', align: 'right', render: (r) => {
          if (r.level === 'expired') return `<b class="text-danger mono">已过期 ${r.overdue_days} 天</b>`;
          if (r.level === 'expiring') return `<b class="text-warning mono">剩 ${r.days_left} 天</b>`;
          return `<span class="text-success mono">剩 ${r.days_left} 天</span>`;
        } },
      { key: 'status', title: '提醒等级', render: (r) => badge(
          r.level === 'expired' ? '紧急' : r.level === 'expiring' ? '临期' : '正常',
          r.level === 'expired' ? 'danger' : r.level === 'expiring' ? 'warning' : 'success') },
      { key: 'act', title: '操作', align: 'right', render: (r) => store.canManage
        ? `<button class="btn btn-sm btn-primary" data-cal="${r.id}" data-name="${escapeHtml(r.name)}">登记校准</button>` : '' },
    ];
    area.innerHTML = renderTable({
      columns: cols, rows, empty: '暂无需要校准的设备',
      rowClass: (r) => (r.level === 'expired' ? 'row-danger' : r.level === 'expiring' ? 'row-warning' : ''),
    });
    area.querySelectorAll('[data-cal]').forEach((b) => b.addEventListener('click', () => {
      openForm(renderTab, { id: Number(b.dataset.cal), name: b.dataset.name });
    }));
  }

  async function okRows() {
    const res = await api.get('/devices', { calibration: '', size: 200 });
    return res.items
      .filter((d) => d.need_calibration && d.status !== 'scrapped' && d.calibration_status === 'ok')
      .map((d) => ({
        id: d.id, asset_no: d.asset_no, name: d.name, model: d.model, location: d.location,
        department_name: d.department_name, custodian_name: d.custodian_name,
        calibration_cycle_days: d.calibration_cycle_days,
        last_calibration_date: d.last_calibration_date,
        next_calibration_date: d.next_calibration_date,
        days_left: d.calibration_days_left, level: 'ok',
      }));
  }

  /* ============ 校准记录 ============ */
  async function renderRecords() {
    const sub = tabBody.querySelector('#sub-body');
    sub.innerHTML = `
      <div class="toolbar">
        <input class="input-sm input-search" id="r-kw" placeholder="搜索设备 / 证书编号 / 机构" value="${escapeHtml(state.keyword)}">
      </div>
      <div class="card"><div class="card-body tight" id="area"></div></div>`;

    const area = sub.querySelector('#area');
    const load = async () => {
      area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
      const res = await api.get('/calibrations', { page: state.page, size: state.size, keyword: state.keyword });
      if (!res.total) { area.innerHTML = renderTable({ columns: [], rows: [] }); return; }
      const cols = [
        { key: 'calibration_date', title: '校准日期', render: (r) => `<span class="mono">${r.calibration_date}</span>` },
        { key: 'asset_no', title: '资产编号', render: (r) => `<span class="mono muted">${escapeHtml(r.asset_no)}</span>` },
        { key: 'device_name', title: '设备名称', render: (r) => `<b>${escapeHtml(r.device_name)}</b>` },
        { key: 'result', title: '结论', render: (r) => badge(r.result, r.result === '合格' ? 'success' : 'danger') },
        { key: 'agency', title: '校准机构', render: (r) => escapeHtml(r.agency || '-') },
        { key: 'certificate_no', title: '证书编号', render: (r) => `<span class="mono muted">${escapeHtml(r.certificate_no || '-')}</span>` },
        { key: 'cycle_days', title: '周期', align: 'right', render: (r) => `${r.cycle_days} 天` },
        { key: 'next_date', title: '下次校准', render: (r) => `<span class="mono">${fmtDate(r.next_date)}</span>` },
        { key: 'cost', title: '费用', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.cost)}</span>` },
        { key: 'act', title: '操作', align: 'right', render: (r) => store.canManage
          ? `<button class="btn btn-sm" data-del="${r.id}" style="color:var(--danger)">删除</button>` : '' },
      ];
      area.innerHTML = renderTable({ columns: cols, rows: res.items, empty: '暂无校准记录' });
      area.appendChild(renderPagination(res, (p) => { state.page = p; load(); }));
      area.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmDialog('删除校准记录', '删除后设备的下次校准日期会回退到上一条记录，确定继续？', { danger: true, okText: '删除' });
        if (!ok) return;
        try { await api.del('/calibrations/' + b.dataset.del); toast('已删除', 'success'); renderTab(); }
        catch (e) { toast(e.message, 'error'); }
      }));
    };
    sub.querySelector('#r-kw').addEventListener('input', debounce((e) => { state.keyword = e.target.value.trim(); state.page = 1; load(); }, 320));
    await load();
  }

  await renderTab();
  return {};
}

/* ============ 登记校准 ============ */
async function openForm(reload, preset) {
  await loadDict();
  const devices = await loadDeviceOptions(true);
  const needCal = devices.filter((d) => d.status !== 'scrapped');

  const body = document.createElement('div');
  body.innerHTML = `<form class="form-grid" id="cal-form">
    ${field('设备', `<select name="device_id" required ${preset ? 'disabled' : ''}>
      <option value="">请选择设备</option>
      ${needCal.map((d) => `<option value="${d.id}"${preset && preset.id === d.id ? ' selected' : ''}>${escapeHtml(d.asset_no)} ${escapeHtml(d.name)}</option>`).join('')}
    </select>`, { span: 2, required: true })}
    ${field('校准日期', `<input type="date" name="calibration_date" value="${today()}" required>`, { required: true })}
    ${field('校准结论', `<select name="result"><option value="合格">合格</option><option value="不合格">不合格</option></select>`)}
    ${field('校准机构', `<input name="agency" placeholder="如：省计量科学研究院">`)}
    ${field('证书编号', `<input name="certificate_no" placeholder="校准证书编号">`)}
    ${field('校准周期（天）', `<input type="number" min="0" name="cycle_days" value="365">`, { hint: '留空或 0 表示沿用设备原有周期' })}
    ${field('费用（元）', `<input type="number" step="0.01" min="0" name="cost" value="0">`)}
    ${field('备注', `<input name="remark" placeholder="选填">`, { span: 2 })}
  </form>
  <p class="form-hint" style="margin-top:10px">保存后系统会自动把「下次校准日期」更新为：校准日期 + 周期。</p>`;

  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存校准记录</button>`;

  openModal({
    title: '登记校准记录', body, footer, width: 'wide',
    onMount(el, close) {
      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=save]').onclick = async () => {
        const form = el.querySelector('#cal-form');
        const sel = el.querySelector('select[name=device_id]');
        if (!sel.value) { toast('请选择设备', 'warning'); return; }
        if (!form.reportValidity()) return;
        const data = formData(form);
        data.device_id = Number(sel.value);
        try {
          const r = await api.post('/calibrations', data);
          toast(`校准已登记，下次校准日期 ${r.next_date || '未设置'}`, 'success', 3400);
          const { invalidateDict } = await import('../store.js');
          invalidateDict();
          close(); reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

function debounce(fn, wait) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}
