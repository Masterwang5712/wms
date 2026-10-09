// 维保记录：列表 + 新增 + 删除
import { api } from '../api.js';
import { loadDict, loadDeviceOptions, store } from '../store.js';
import { escapeHtml } from '../router.js';
import {
  badge, confirmDialog, field, fmtMoney, openModal, renderPagination,
  renderTable, svgIcon, toast, today, formData,
} from '../ui.js';

let state = { page: 1, size: 20, keyword: '', maint_type: '' };
const TYPES = ['保养', '维修', '故障'];

export default async function maintenance(container) {
  await loadDict();
  const all = await api.get('/maintenance', { page: 1, size: 500 });
  const totalCost = all.items.reduce((s, x) => s + (x.cost || 0), 0);
  const byType = {};
  all.items.forEach((x) => { byType[x.maint_type] = (byType[x.maint_type] || 0) + 1; });

  container.innerHTML = `
    <div class="grid grid-kpi" style="margin-bottom:18px">
      <div class="kpi"><div class="kpi-top"><span class="kpi-label">维保记录总数</span><span class="kpi-icon info">${svgIcon('wrench', 17)}</span></div>
        <div class="kpi-value">${all.total}</div><div class="kpi-foot">含保养、维修、故障处理</div></div>
      <div class="kpi"><div class="kpi-top"><span class="kpi-label">累计维保费用</span><span class="kpi-icon warning">${svgIcon('money', 17)}</span></div>
        <div class="kpi-value sm">${fmtMoney(totalCost)}</div><div class="kpi-foot">全部记录费用合计</div></div>
      ${TYPES.map((t) => `<div class="kpi"><div class="kpi-top"><span class="kpi-label">${t}次数</span><span class="kpi-icon">${svgIcon('monitor', 17)}</span></div>
        <div class="kpi-value">${byType[t] || 0}</div><div class="kpi-foot">${t}类维保记录</div></div>`).join('')}
    </div>

    <div class="toolbar">
      <input class="input-sm input-search" id="f-kw" placeholder="搜索设备 / 内容 / 服务商" value="${escapeHtml(state.keyword)}">
      <select class="select-sm" id="f-type"><option value="">全部类型</option>
        ${TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
      <div class="spacer"></div>
      <button class="btn btn-sm btn-primary" id="btn-new" ${store.canManage ? '' : 'disabled'}>${svgIcon('plus', 15)} 新增维保记录</button>
    </div>
    <div class="card"><div class="card-body tight" id="area"></div></div>`;

  const kwEl = container.querySelector('#f-kw');
  const typeEl = container.querySelector('#f-type');
  typeEl.value = state.maint_type;

  kwEl.addEventListener('input', debounce((e) => { state.keyword = e.target.value.trim(); state.page = 1; load(); }, 320));
  typeEl.addEventListener('change', () => { state.maint_type = typeEl.value; state.page = 1; load(); });
  container.querySelector('#btn-new').addEventListener('click', () => openForm(load));

  const area = container.querySelector('#area');
  const typeCls = { 保养: 'info', 维修: 'warning', 故障: 'danger' };

  async function load() {
    area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
    const res = await api.get('/maintenance', {
      page: state.page, size: state.size, keyword: state.keyword, maint_type: state.maint_type,
    });
    if (!res.total) { area.innerHTML = renderTable({ columns: [], rows: [] }); return; }
    const cols = [
      { key: 'maint_date', title: '维保日期', render: (r) => `<span class="mono">${r.maint_date}</span>` },
      { key: 'asset_no', title: '资产编号', render: (r) => `<span class="mono muted">${escapeHtml(r.asset_no)}</span>` },
      { key: 'device_name', title: '设备名称', render: (r) => `<b>${escapeHtml(r.device_name)}</b>` },
      { key: 'maint_type', title: '类型', render: (r) => badge(r.maint_type, typeCls[r.maint_type] || 'gray') },
      { key: 'content', title: '维保内容', render: (r) => `<span style="color:var(--text-2)">${escapeHtml(r.content || '-')}</span>` },
      { key: 'vendor', title: '服务商', render: (r) => escapeHtml(r.vendor || '-') },
      { key: 'cost', title: '费用', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.cost)}</span>` },
      { key: 'next_date', title: '下次维保', render: (r) => r.next_date ? `<span class="mono">${r.next_date}</span>` : '<span class="text-muted">-</span>' },
      { key: 'operator_name', title: '登记人', render: (r) => `<span class="muted">${escapeHtml(r.operator_name || '-')}</span>` },
      { key: 'act', title: '操作', align: 'right', render: (r) => store.canManage
        ? `<button class="btn btn-sm" data-del="${r.id}" style="color:var(--danger)">删除</button>` : '' },
    ];
    area.innerHTML = renderTable({ columns: cols, rows: res.items, empty: '暂无维保记录' });
    area.appendChild(renderPagination(res, (p) => { state.page = p; load(); }));
    area.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('删除维保记录', '确定删除该条维保记录吗？', { danger: true, okText: '删除' });
      if (!ok) return;
      try { await api.del('/maintenance/' + b.dataset.del); toast('已删除', 'success'); load(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }

  await load();
  return {};
}

async function openForm(reload) {
  await loadDict();
  const devices = await loadDeviceOptions(true);
  const body = document.createElement('div');
  body.innerHTML = `<form class="form-grid" id="mt-form">
    ${field('设备', `<select name="device_id" required>
      <option value="">请选择设备</option>
      ${devices.map((d) => `<option value="${d.id}">${escapeHtml(d.asset_no)} ${escapeHtml(d.name)}</option>`).join('')}
    </select>`, { span: 2, required: true })}
    ${field('维保类型', `<select name="maint_type">${TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>`)}
    ${field('维保日期', `<input type="date" name="maint_date" value="${today()}" required>`, { required: true })}
    ${field('服务商 / 维修单位', `<input name="vendor" placeholder="如：安捷伦售后">`)}
    ${field('费用（元）', `<input type="number" step="0.01" min="0" name="cost" value="0">`)}
    ${field('维保内容', `<textarea name="content" rows="2" placeholder="故障现象、处理措施、更换配件等"></textarea>`, { span: 2 })}
    ${field('下次维保日期', `<input type="date" name="next_date">`, { hint: '选填，便于后续提醒' })}
  </form>
  <p class="form-hint" style="margin-top:10px">提示：登记「维修」或「故障」记录后，设备状态会自动变为「维修中」，完成维修后请在设备台账中改回「在用」。</p>`;

  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存</button>`;

  openModal({
    title: '新增维保记录', body, footer, width: 'wide',
    onMount(el, close) {
      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=save]').onclick = async () => {
        const form = el.querySelector('#mt-form');
        if (!form.reportValidity()) return;
        const data = formData(form);
        data.device_id = Number(data.device_id);
        try {
          await api.post('/maintenance', data);
          toast('维保记录已保存', 'success');
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
