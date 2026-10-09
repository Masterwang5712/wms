// 借用归还：借出登记 + 一键归还 + 逾期提醒
import { api } from '../api.js';
import { loadDict, refreshAlerts, store } from '../store.js';
import { escapeHtml } from '../router.js';
import {
  badge, bindRowClick, borrowBadge, field, fmtDate, openModal, options,
  renderPagination, renderTable, svgIcon, toast, today, formData,
} from '../ui.js';

let state = { tab: 'borrowed', page: 1, size: 20, keyword: '' };

export default async function borrows(container) {
  await loadDict();
  container.innerHTML = `
    <div class="toolbar">
      <div class="tabs" style="margin:0;border:none">
        <button class="tab ${state.tab === 'borrowed' ? 'active' : ''}" data-tab="borrowed">在借设备</button>
        <button class="tab ${state.tab === 'overdue' ? 'active' : ''}" data-tab="overdue">逾期未还 <span id="od-count"></span></button>
        <button class="tab ${state.tab === 'all' ? 'active' : ''}" data-tab="all">全部记录</button>
      </div>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="btn-export">${svgIcon('download', 15)} 导出台账</button>
      <button class="btn btn-sm btn-primary" id="btn-new" ${store.canManage ? '' : 'disabled'}>${svgIcon('plus', 15)} 办理借出</button>
    </div>
    <div id="tab-body"></div>`;

  container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    state.tab = t.dataset.tab; state.page = 1;
    container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    renderTab();
  }));
  container.querySelector('#btn-new').addEventListener('click', () => openBorrowForm(renderTab));
  container.querySelector('#btn-export').addEventListener('click', async () => {
    const { downloadFile } = await import('../api.js');
    try { await downloadFile('/export/borrows.xlsx'); toast('导出成功', 'success'); } catch (e) { toast(e.message, 'error'); }
  });

  const tabBody = container.querySelector('#tab-body');

  async function renderTab() {
    if (state.tab === 'overdue') return renderOverdue();
    return renderList();
  }

  /* ============ 逾期未还 ============ */
  async function renderOverdue() {
    tabBody.innerHTML = '<div class="card"><div class="card-body tight" id="area"></div></div>';
    const area = tabBody.querySelector('#area');
    area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
    const rows = await api.get('/borrows/overdue');
    container.querySelector('#od-count').innerHTML = rows.length ? `<span class="badge-dot" style="margin:0">${rows.length}</span>` : '';

    area.innerHTML = `
      ${rows.length ? `<div style="padding:12px 16px;background:var(--danger-l);color:var(--danger);font-size:13px;border-bottom:1px solid var(--border-2)">
        ${svgIcon('warn', 15)} 共有 <b>${rows.length}</b> 台设备逾期未还，请及时催还</div>` : ''}
      <div id="od-table"></div>`;
    const tableEl = area.querySelector('#od-table');
    if (!rows.length) {
      tableEl.innerHTML = `<div class="empty-state" style="padding:44px 0">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p>暂无逾期未还设备</p></div>`;
      return;
    }
    tableEl.innerHTML = renderTable({
      columns: [
        { key: 'asset_no', title: '资产编号', render: (r) => `<span class="mono"><b>${escapeHtml(r.asset_no)}</b></span>` },
        { key: 'device_name', title: '设备名称', render: (r) => `<b>${escapeHtml(r.device_name)}</b>` },
        { key: 'borrower_name', title: '借用人', render: (r) => escapeHtml(r.borrower_name || '-') },
        { key: 'department_name', title: '部门', render: (r) => escapeHtml(r.department_name || '-') },
        { key: 'borrow_date', title: '借出日期', render: (r) => `<span class="mono">${r.borrow_date}</span>` },
        { key: 'due_date', title: '应还日期', render: (r) => `<span class="mono">${r.due_date || '-'}</span>` },
        { key: 'overdue_days', title: '逾期天数', align: 'right', render: (r) => `<b class="text-danger mono">${r.overdue_days} 天</b>` },
        { key: 'act', title: '操作', align: 'right', render: (r) => store.canManage
          ? `<button class="btn btn-sm btn-primary" data-return="${r.id}">办理归还</button>` : '' },
      ],
      rows, rowClass: () => 'row-danger',
    });
    tableEl.querySelectorAll('[data-return]').forEach((b) => b.addEventListener('click', () => openReturnForm(rows.find((x) => x.id === Number(b.dataset.return)), renderTab)));
  }

  /* ============ 记录列表 ============ */
  async function renderList() {
    tabBody.innerHTML = `
      <div class="toolbar">
        <input class="input-sm input-search" id="f-kw" placeholder="搜索设备 / 资产编号 / 借用人" value="${escapeHtml(state.keyword)}">
      </div>
      <div class="card"><div class="card-body tight" id="area"></div></div>`;

    const area = tabBody.querySelector('#area');
    const load = async () => {
      area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
      const params = { page: state.page, size: state.size, keyword: state.keyword };
      if (state.tab === 'borrowed') params.status = 'borrowed';
      const res = await api.get('/borrows', params);
      if (!res.total) { area.innerHTML = renderTable({ columns: [], rows: [] }); return; }
      const cols = [
        { key: 'asset_no', title: '资产编号', render: (r) => `<span class="mono">${escapeHtml(r.asset_no)}</span>` },
        { key: 'device_name', title: '设备名称', render: (r) => `<b>${escapeHtml(r.device_name)}</b>` },
        { key: 'borrower_name', title: '借用人', render: (r) => escapeHtml(r.borrower_name || '-') },
        { key: 'department_name', title: '部门', render: (r) => escapeHtml(r.department_name || '-') },
        { key: 'borrow_date', title: '借出日期', render: (r) => `<span class="mono">${r.borrow_date}</span>` },
        { key: 'due_date', title: '应还日期', render: (r) => `<span class="mono">${r.due_date || '-'}</span>` },
        { key: 'return_date', title: '归还日期', render: (r) => r.return_date ? `<span class="mono">${r.return_date}</span>` : '<span class="text-muted">未归还</span>' },
        { key: 'status', title: '状态', render: (r) => r.is_overdue ? badge('已逾期 ' + r.overdue_days + '天', 'danger') : borrowBadge(r.status) },
        { key: 'purpose', title: '用途', render: (r) => `<span class="muted">${escapeHtml(r.purpose || '-')}</span>` },
        { key: 'act', title: '操作', align: 'right', render: (r) => (r.status === 'borrowed' && store.canManage)
          ? `<button class="btn btn-sm btn-primary" data-return="${r.id}">办理归还</button>` : '<span class="text-muted">—</span>' },
      ];
      area.innerHTML = renderTable({ columns: cols, rows: res.items, empty: '暂无借用记录', rowClass: (r) => r.is_overdue ? 'row-danger' : '' });
      area.appendChild(renderPagination(res, (p) => { state.page = p; load(); }));
      area.querySelectorAll('[data-return]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        openReturnForm(res.items.find((x) => x.id === Number(b.dataset.return)), load);
      }));
    };
    tabBody.querySelector('#f-kw').addEventListener('input', debounce((e) => { state.keyword = e.target.value.trim(); state.page = 1; load(); }, 320));
    await load();
  }

  await renderTab();
  return {};
}

/* ============ 借出登记 ============ */
async function openBorrowForm(reload) {
  await loadDict();
  const avail = await api.get('/devices/options/borrowable');

  if (!avail.length) { toast('当前没有可借出的设备（闲置或在用的设备才可借出）', 'warning'); return; }

  const body = document.createElement('div');
  body.innerHTML = `<form class="form-grid" id="bw-form">
    ${field('借出设备', `<select name="device_id" required>
      <option value="">请选择可借设备</option>
      ${avail.map((d) => `<option value="${d.id}">${escapeHtml(d.asset_no)} ${escapeHtml(d.name)}${d.model ? ' / ' + escapeHtml(d.model) : ''}（${escapeHtml(d.location || '无位置')}）</option>`).join('')}
    </select>`, { span: 2, required: true })}
    ${field('借用人', `<select name="borrower_id" id="bw-staff" required>
      <option value="">请选择借用人</option>
      ${store.dict.staff.map((s) => `<option value="${s.id}" data-dept="${s.department_id || ''}">${escapeHtml(s.name)}（${escapeHtml(s.department_name || '')}）</option>`).join('')}
    </select>`, { required: true })}
    ${field('借用部门', `<select name="borrower_dept_id" id="bw-dept">${options(store.dict.departments, { placeholder: '请选择部门' })}</select>`)}
    ${field('借出日期', `<input type="date" name="borrow_date" value="${today()}" required>`, { required: true })}
    ${field('应归还日期', `<input type="date" name="due_date" required>`, { required: true, hint: '超过此日期将标记为逾期' })}
    ${field('借用用途', `<input name="purpose" placeholder="如：外送样品检测 / 车间测量">`, { span: 2 })}
  </form>`;

  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">确认借出</button>`;

  openModal({
    title: '办理设备借出', body, footer,
    onMount(el, close) {
      const staffSel = el.querySelector('#bw-staff');
      const deptSel = el.querySelector('#bw-dept');
      // 选择借用人后自动带出部门
      staffSel.addEventListener('change', () => {
        const o = staffSel.selectedOptions[0];
        if (o && o.dataset.dept) deptSel.value = o.dataset.dept;
      });
      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=save]').onclick = async () => {
        const form = el.querySelector('#bw-form');
        if (!form.reportValidity()) return;
        const data = formData(form);
        data.device_id = Number(data.device_id);
        data.borrower_id = data.borrower_id ? Number(data.borrower_id) : null;
        data.borrower_dept_id = data.borrower_dept_id ? Number(data.borrower_dept_id) : null;
        if (data.due_date && data.borrow_date && data.due_date < data.borrow_date) {
          toast('应归还日期不能早于借出日期', 'error'); return;
        }
        try {
          await api.post('/borrows', data);
          toast('借出成功', 'success');
          await refreshAlerts();
          window.dispatchEvent(new CustomEvent('wms:refresh-alerts'));
          close(); reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

/* ============ 归还 ============ */
async function openReturnForm(rec, reload) {
  const overdue = rec.is_overdue || (rec.due_date && rec.due_date < today());
  const body = document.createElement('div');
  body.innerHTML = `
    ${overdue ? `<div class="alert-chip danger" style="margin-bottom:16px">${svgIcon('warn', 15)} 该设备已逾期，逾期 ${rec.overdue_days || 0} 天</div>` : ''}
    <div class="desc-list" style="margin-bottom:18px">
      <div class="desc-item"><div class="desc-label">设备</div><div class="desc-value"><b>${escapeHtml(rec.device_name)}</b> <span class="mono muted">${escapeHtml(rec.asset_no)}</span></div></div>
      <div class="desc-item"><div class="desc-label">借用人</div><div class="desc-value">${escapeHtml(rec.borrower_name || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">借出日期</div><div class="desc-value mono">${rec.borrow_date}</div></div>
      <div class="desc-item"><div class="desc-label">应还日期</div><div class="desc-value mono ${overdue ? 'text-danger' : ''}">${rec.due_date || '-'}</div></div>
    </div>
    <form class="form-grid" id="rt-form">
      ${field('实际归还日期', `<input type="date" name="return_date" value="${today()}" required>`, { required: true })}
      ${field('归还备注', `<input name="return_remark" placeholder="如：设备完好 / 有轻微磨损">`)}
    </form>`;

  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">确认归还</button>`;

  openModal({
    title: '办理设备归还', body, footer,
    onMount(el, close) {
      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=save]').onclick = async () => {
        const form = el.querySelector('#rt-form');
        if (!form.reportValidity()) return;
        const data = formData(form);
        try {
          await api.post(`/borrows/${rec.id}/return`, data);
          toast('归还成功', 'success');
          await refreshAlerts();
          window.dispatchEvent(new CustomEvent('wms:refresh-alerts'));
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
