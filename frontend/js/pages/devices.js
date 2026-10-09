// 设备台账：CRUD + 状态流转 + 详情时间线 + 校准倒计时
import { api } from '../api.js';
import { loadDict, store } from '../store.js';
import { escapeHtml, navigate } from '../router.js';
import {
  badge, bindRowClick, calBadge, confirmDialog, field, fmtDate, fmtDaysLeft, fmtMoney,
  openDrawer, openModal, options, renderPagination, renderTable, statusBadge,
  svgIcon, toast, formData,
} from '../ui.js';

let state = { page: 1, size: 20, keyword: '', status: '', department_id: '', calibration: '' };

const STATUSES = [['in_use', '在用'], ['idle', '闲置'], ['repairing', '维修中'], ['borrowed', '借出'], ['scrapped', '已报废']];

export default async function devices(container) {
  await loadDict();
  container.innerHTML = `
    <div class="toolbar">
      <input class="input-sm input-search" id="f-kw" placeholder="搜索资产编号 / 名称 / 型号 / 序列号" value="${escapeHtml(state.keyword)}">
      <select class="select-sm" id="f-status"><option value="">全部状态</option>
        ${STATUSES.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select class="select-sm" id="f-dept"><option value="">全部部门</option>
        ${store.dict.departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select>
      <select class="select-sm" id="f-cal"><option value="">校准状态不限</option>
        <option value="expired">已过期</option><option value="expiring">临期 30 天内</option></select>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="btn-export">${svgIcon('download', 15)} 导出</button>
      <button class="btn btn-sm btn-primary" id="btn-new" ${store.canManage ? '' : 'disabled'}>${svgIcon('plus', 15)} 新增设备</button>
    </div>
    <div class="card"><div class="card-body tight" id="area"></div></div>`;

  const kwEl = container.querySelector('#f-kw');
  const stEl = container.querySelector('#f-status');
  const deptEl = container.querySelector('#f-dept');
  const calEl = container.querySelector('#f-cal');
  stEl.value = state.status; deptEl.value = state.department_id; calEl.value = state.calibration;

  kwEl.addEventListener('input', debounce((e) => { state.keyword = e.target.value.trim(); state.page = 1; load(); }, 320));
  stEl.addEventListener('change', () => { state.status = stEl.value; state.page = 1; load(); });
  deptEl.addEventListener('change', () => { state.department_id = deptEl.value; state.page = 1; load(); });
  calEl.addEventListener('change', () => { state.calibration = calEl.value; state.page = 1; load(); });
  container.querySelector('#btn-new').addEventListener('click', () => openForm(null, load));
  container.querySelector('#btn-export').addEventListener('click', async () => {
    const { downloadFile } = await import('../api.js');
    try { await downloadFile('/export/devices.xlsx'); toast('导出成功', 'success'); } catch (e) { toast(e.message, 'error'); }
  });

  const area = container.querySelector('#area');

  async function load() {
    area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
    const res = await api.get('/devices', {
      page: state.page, size: state.size, keyword: state.keyword,
      status: state.status, department_id: state.department_id, calibration: state.calibration,
    });
    if (!res.total) { area.innerHTML = renderTable({ columns: [], rows: [] }); return; }
    const cols = [
      { key: 'asset_no', title: '资产编号', render: (r) => `<span class="mono"><b>${escapeHtml(r.asset_no)}</b></span>` },
      { key: 'name', title: '设备名称', render: (r) => `<b>${escapeHtml(r.name)}</b>${r.model ? `<div class="muted" style="font-size:11.5px">${escapeHtml(r.brand || '')} ${escapeHtml(r.model)}</div>` : ''}` },
      { key: 'category_name', title: '分类', render: (r) => badge(r.category_name || '未分类', 'gray') },
      { key: 'location', title: '存放位置', render: (r) => `<span class="muted">${escapeHtml(r.location || '-')}</span>` },
      { key: 'custodian_name', title: '责任人', render: (r) => escapeHtml(r.custodian_name || '-') },
      { key: 'department_name', title: '使用部门', render: (r) => escapeHtml(r.department_name || '-') },
      { key: 'status', title: '状态', render: (r) => statusBadge(r.status) },
      { key: 'cal', title: '校准', render: (r) => r.calibration_status === 'none'
          ? '<span class="text-muted" style="font-size:12px">—</span>'
          : `<div>${calBadge(r.calibration_status, r.next_calibration_date)}</div>
             <div class="muted" style="font-size:11px;margin-top:2px">${r.next_calibration_date ? fmtDate(r.next_calibration_date) : ''}</div>` },
      { key: 'price', title: '购置金额', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.price)}</span>` },
      { key: 'act', title: '操作', align: 'right', render: (r) => store.canManage
        ? `<button class="btn btn-sm" data-act="edit" data-id="${r.id}">编辑</button>`
        : '<span class="text-muted">—</span>' },
    ];
    area.innerHTML = renderTable({
      columns: cols, rows: res.items, empty: '没有符合条件的设备',
      rowClass: (r) => (r.calibration_status === 'expired' ? 'row-danger' : r.calibration_status === 'expiring' ? 'row-warning' : ''),
    });
    area.appendChild(renderPagination(res, (p) => { state.page = p; load(); }));

    bindRowClick(area, res.items, (r) => openDetail(r, load));
    area.querySelectorAll('[data-act=edit]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      openForm(res.items.find((x) => x.id === Number(b.dataset.id)), load);
    }));
  }

  await load();
  return {};
}

/* ============ 新增/编辑设备 ============ */
async function openForm(dev, reload) {
  await loadDict();
  const isEdit = !!dev;
  const d = dev || { status: 'in_use', need_calibration: 0, calibration_cycle_days: 365, price: 0 };

  const body = document.createElement('div');
  body.innerHTML = `<form class="form-grid" id="dev-form">
    ${field('资产编号', `<input name="asset_no" value="${escapeHtml(d.asset_no || '')}" placeholder="留空自动生成">`)}
    ${field('设备名称', `<input name="name" value="${escapeHtml(d.name || '')}" required>`, { required: true })}
    ${field('设备分类', `<select name="category_id">${options(store.dict.categories, { selected: d.category_id, placeholder: '请选择分类' })}</select>`)}
    ${field('品牌', `<input name="brand" value="${escapeHtml(d.brand || '')}">`)}
    ${field('型号', `<input name="model" value="${escapeHtml(d.model || '')}">`)}
    ${field('序列号', `<input name="serial_no" value="${escapeHtml(d.serial_no || '')}">`)}
    ${field('购置日期', `<input type="date" name="purchase_date" value="${d.purchase_date || ''}">`)}
    ${field('购置金额（元）', `<input type="number" step="0.01" min="0" name="price" value="${d.price || 0}">`)}
    ${field('存放位置', `<input name="location" value="${escapeHtml(d.location || '')}">`)}
    ${field('责任人', `<select name="custodian_id">${options(store.dict.staff, { selected: d.custodian_id, placeholder: '请选择责任人', labelFn: (s) => `${s.name}（${s.department_name || ''}）` })}</select>`)}
    ${field('使用部门', `<select name="department_id">${options(store.dict.departments, { selected: d.department_id, placeholder: '请选择部门' })}</select>`)}
    ${field('设备状态', `<select name="status">${STATUSES.map(([k, v]) => `<option value="${k}"${d.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select>`)}
    ${field('是否需要校准', `<select name="need_calibration" id="d-needcal">
        <option value="0"${!d.need_calibration ? ' selected' : ''}>不需要</option>
        <option value="1"${d.need_calibration ? ' selected' : ''}>需要校准</option></select>`)}
    ${field('校准周期（天）', `<input type="number" min="0" name="calibration_cycle_days" value="${d.calibration_cycle_days || 0}" placeholder="如 365">`)}
    ${field('上次校准日期', `<input type="date" name="last_calibration_date" value="${d.last_calibration_date || ''}">`, { hint: '填写后自动推算下次校准日期' })}
    ${field('保修到期', `<input type="date" name="warranty_until" value="${d.warranty_until || ''}">`)}
    ${field('备注', `<textarea name="remark" rows="2">${escapeHtml(d.remark || '')}</textarea>`, { span: 2 })}
  </form>`;

  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存</button>`;

  openModal({
    title: isEdit ? '编辑设备' : '新增设备', body, footer, width: 'wide',
    onMount(el, close) {
      // 状态字段在编辑时由专门的流转接口处理，这里禁用避免绕过校验
      if (isEdit) el.querySelector('#dev-form select[name=status]').disabled = true;
      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=save]').onclick = async () => {
        const form = el.querySelector('#dev-form');
        if (!form.reportValidity()) return;
        const data = formData(form);
        if (isEdit) data.status = dev.status; // 保持原状态
        data.need_calibration = Number(data.need_calibration) || 0;
        try {
          if (isEdit) { await api.put('/devices/' + dev.id, data); }
          else { await api.post('/devices', data); }
          toast(isEdit ? '已保存' : '新增成功', 'success');
          const { invalidateDict } = await import('../store.js');
          invalidateDict();
          close(); reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

/* ============ 设备详情（含时间线、状态流转、快捷登记） ============ */
async function openDetail(dev, reload) {
  const [detail, timeline] = await Promise.all([
    api.get('/devices/' + dev.id),
    api.get('/devices/' + dev.id + '/timeline'),
  ]);

  const body = document.createElement('div');
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      ${statusBadge(detail.status)}
      ${detail.calibration_status !== 'none' ? calBadge(detail.calibration_status, detail.next_calibration_date) : ''}
      <span class="muted" style="font-size:12px">资产编号 ${escapeHtml(detail.asset_no)}</span>
    </div>

    <div class="desc-list" style="margin-bottom:20px">
      <div class="desc-item"><div class="desc-label">设备名称</div><div class="desc-value"><b>${escapeHtml(detail.name)}</b></div></div>
      <div class="desc-item"><div class="desc-label">分类</div><div class="desc-value">${escapeHtml(detail.category_name || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">品牌 / 型号</div><div class="desc-value">${escapeHtml(detail.brand || '-')} / ${escapeHtml(detail.model || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">序列号</div><div class="desc-value mono">${escapeHtml(detail.serial_no || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">存放位置</div><div class="desc-value">${escapeHtml(detail.location || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">责任人</div><div class="desc-value">${escapeHtml(detail.custodian_name || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">使用部门</div><div class="desc-value">${escapeHtml(detail.department_name || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">购置日期</div><div class="desc-value mono">${fmtDate(detail.purchase_date)}</div></div>
      <div class="desc-item"><div class="desc-label">购置金额</div><div class="desc-value mono">${fmtMoney(detail.price)}</div></div>
      <div class="desc-item"><div class="desc-label">保修到期</div><div class="desc-value mono">${fmtDate(detail.warranty_until)}</div></div>
      <div class="desc-item"><div class="desc-label">校准周期</div><div class="desc-value">${detail.need_calibration ? detail.calibration_cycle_days + ' 天' : '无需校准'}</div></div>
      <div class="desc-item"><div class="desc-label">下次校准</div><div class="desc-value mono ${detail.calibration_status === 'expired' ? 'text-danger' : detail.calibration_status === 'expiring' ? 'text-warning' : ''}">${detail.next_calibration_date ? `${fmtDate(detail.next_calibration_date)}（${fmtDaysLeft(detail.next_calibration_date)}）` : '-'}</div></div>
      <div class="desc-item full"><div class="desc-label">备注</div><div class="desc-value">${escapeHtml(detail.remark || '-')}</div></div>
    </div>

    ${store.canManage ? `<div class="btn-row" style="margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid var(--border-2)">
      <button class="btn btn-sm" data-act="borrow">办理借用</button>
      <button class="btn btn-sm" data-act="return">办理归还</button>
      <button class="btn btn-sm" data-act="calib">登记校准</button>
      <button class="btn btn-sm" data-act="maint">登记维保</button>
      <button class="btn btn-sm" data-act="status">变更状态</button>
    </div>` : ''}

    <div class="section-title" style="font-size:13.5px">设备履历 / 时间线</div>
    ${timeline.length ? `<div class="timeline">${timeline.map((t) => `
      <div class="tl-item ${t.type}">
        <div class="tl-head"><span class="tl-title">${escapeHtml(t.title)}</span><span class="tl-date">${t.date || ''}</span></div>
        <div class="tl-detail">${escapeHtml(t.detail)}</div>
      </div>`).join('')}</div>`
      : '<div class="chart-empty">暂无履历记录</div>'}`;

  const drawer = openDrawer({ title: '设备详情', body, width: '660px' });

  const refresh = () => { drawer.close(); reload(); };

  if (store.canManage) {
    const on = (act, fn) => { const b = body.querySelector(`[data-act=${act}]`); if (b) b.onclick = fn; };
    on('borrow', () => navigate('/borrows'));
    on('return', () => navigate('/borrows'));
    on('calib', () => { drawer.close(); navigate('/calibration'); });
    on('maint', () => { drawer.close(); navigate('/maintenance'); });
    on('status', () => openStatusChange(detail, refresh));
  }
}

/* ============ 状态流转 ============ */
export async function openStatusChange(dev, reload) {
  const legal = {
    in_use: ['idle', 'repairing', 'scrapped'],
    idle: ['in_use', 'repairing', 'scrapped'],
    repairing: ['in_use', 'idle', 'scrapped'],
    borrowed: ['scrapped'],
    scrapped: [],
  }[dev.status] || [];

  if (!legal.length) {
    toast('该设备当前状态已不允许再变更', 'warning');
    return;
  }

  const body = document.createElement('div');
  body.innerHTML = `<form class="form-grid" id="st-form">
    ${field('当前状态', `<input value="${(STATUSES.find(([k]) => k === dev.status) || [])[1] || dev.status}" disabled>`)}
    ${field('变更为', `<select name="to_status" required>
      ${legal.map((k) => `<option value="${k}">${(STATUSES.find(([x]) => x[0] === k) || [])[1]}</option>`).join('')}
    </select>`, { required: true })}
    ${field('变更原因 / 说明', `<input name="reason" placeholder="选填，如：送厂维修 / 达到报废年限">`, { span: 2 })}
  </form>`;
  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">确认变更</button>`;

  openModal({
    title: '设备状态变更', body, footer,
    onMount(el, close) {
      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=save]').onclick = async () => {
        const form = el.querySelector('#st-form');
        if (!form.reportValidity()) return;
        const data = formData(form);
        try {
          await api.post(`/devices/${dev.id}/status`, data);
          toast('状态已变更', 'success');
          close(); reload && reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

function debounce(fn, wait) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}
