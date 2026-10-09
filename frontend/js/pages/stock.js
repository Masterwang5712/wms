// 实时库存：库存查询 + 预警高亮 + 流水查看 + 盘点调整 + 导出
import { api } from '../api.js';
import { loadDict, loadItemOptions, refreshAlerts, store } from '../store.js';
import { escapeHtml, navigate } from '../router.js';
import {
  badge, bindRowClick, field, fmtMoney, fmtNum, openDrawer, openModal,
  options, renderPagination, renderTable, svgIcon, toast, formData, today,
} from '../ui.js';

let state = { page: 1, size: 20, keyword: '', category_id: '', only_low: false, tab: 'stock' };

export default async function stock(container) {
  await loadDict();
  const ov = await api.get('/reports/overview');

  container.innerHTML = `
    <div class="grid grid-kpi" style="margin-bottom:18px">
      <div class="kpi"><div class="kpi-top"><span class="kpi-label">库存总货值</span><span class="kpi-icon">${svgIcon('money', 17)}</span></div>
        <div class="kpi-value">${fmtMoney(ov.stock_value)}</div><div class="kpi-foot">共 ${ov.item_kinds} 种耗材物料</div></div>
      <div class="kpi"><div class="kpi-top"><span class="kpi-label">低库存预警</span><span class="kpi-icon ${ov.low_stock_count ? 'warning' : 'success'}">${svgIcon('warn', 17)}</span></div>
        <div class="kpi-value">${ov.low_stock_count}</div><div class="kpi-foot">低于安全库存的品类数</div></div>
      <div class="kpi"><div class="kpi-top"><span class="kpi-label">缺货品类</span><span class="kpi-icon ${ov.out_of_stock_count ? 'danger' : 'success'}">${svgIcon('box', 17)}</span></div>
        <div class="kpi-value">${ov.out_of_stock_count}</div><div class="kpi-foot">库存为 0，需尽快补货</div></div>
      <div class="kpi"><div class="kpi-top"><span class="kpi-label">本月出库金额</span><span class="kpi-icon info">${svgIcon('outbox', 17)}</span></div>
        <div class="kpi-value">${fmtMoney(ov.month_out_amount)}</div><div class="kpi-foot">本月出库 ${fmtNum(ov.month_out_qty)} 件</div></div>
    </div>

    <div class="tabs">
      <button class="tab ${state.tab === 'stock' ? 'active' : ''}" data-tab="stock">库存台账</button>
      <button class="tab ${state.tab === 'flow' ? 'active' : ''}" data-tab="flow">出入库流水</button>
    </div>

    <div id="tab-content"></div>
  `;

  container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    renderTab();
  }));

  const tabContent = container.querySelector('#tab-content');

  async function renderTab() {
    if (state.tab === 'stock') await renderStock();
    else await renderFlow();
  }

  /* ============ 库存台账 ============ */
  async function renderStock() {
    tabContent.innerHTML = `
      <div class="toolbar">
        <input class="input-sm input-search" id="s-keyword" placeholder="搜索名称 / 编码" value="${escapeHtml(state.keyword)}">
        <select class="select-sm" id="s-cat"><option value="">全部分类</option>
          ${store.dict.categories.map((c) => `<option value="${c.id}"${String(state.category_id) === String(c.id) ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <label class="btn btn-sm"><input type="checkbox" id="s-low" ${state.only_low ? 'checked' : ''}> 仅看预警</label>
        <div class="spacer"></div>
        <button class="btn btn-sm" id="s-adjust" ${store.canManage ? '' : 'disabled'}>${svgIcon('box', 15)} 盘点调整</button>
        <button class="btn btn-sm" id="s-export">${svgIcon('download', 15)} 导出库存表</button>
      </div>
      <div class="card"><div class="card-body tight" id="stock-area"></div></div>`;

    const area = tabContent.querySelector('#stock-area');
    const load = async () => {
      area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
      const res = await api.get('/stock', {
        page: state.page, size: state.size, keyword: state.keyword,
        category_id: state.category_id, only_low: state.only_low ? 'true' : '',
      });
      if (!res.total) { area.innerHTML = renderTable({ columns: [], rows: [] }); return; }

      const cols = [
        { key: 'code', title: '编码', render: (r) => `<span class="mono">${escapeHtml(r.code)}</span>` },
        { key: 'name', title: '名称', render: (r) => `<b>${escapeHtml(r.name)}</b>` },
        { key: 'spec', title: '规格', render: (r) => `<span class="muted">${escapeHtml(r.spec || '-')}</span>` },
        { key: 'category_name', title: '分类', render: (r) => badge(r.category_name || '未分类', 'gray') },
        { key: 'location', title: '库位', render: (r) => `<span class="mono muted">${escapeHtml(r.location || '-')}</span>` },
        { key: 'current_stock', title: '当前库存', align: 'right', render: (r) => `<b class="mono">${fmtNum(r.current_stock)}</b> <span class="muted">${escapeHtml(r.unit || '')}</span>` },
        { key: 'safety_stock', title: '安全库存', align: 'right', render: (r) => `<span class="mono text-muted">${r.safety_stock}</span>` },
        { key: 'bar', title: '水位', render: (r) => waterBar(r) },
        { key: 'unit_price', title: '单价', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.unit_price)}</span>` },
        { key: 'stock_value', title: '货值', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.stock_value)}</span>` },
        { key: 'status', title: '状态', render: (r) => r.is_out ? badge('缺货', 'danger') : r.is_low ? badge('低库存', 'warning') : badge('正常', 'success') },
      ];
      area.innerHTML = renderTable({
        columns: cols, rows: res.items, empty: '没有符合条件的库存记录',
        rowClass: (r) => (r.is_out ? 'row-danger' : r.is_low ? 'row-warning' : ''),
      });
      area.insertAdjacentHTML('afterbegin', `<div style="padding:10px 16px;font-size:12.5px;color:var(--text-2);border-bottom:1px solid var(--border-2);display:flex;gap:18px;flex-wrap:wrap">
        <span>品类 <b>${res.summary.kind_count}</b></span>
        <span>库存货值 <b>${fmtMoney(res.summary.total_value)}</b></span>
        ${res.summary.low_count ? `<span class="text-warning">低库存 <b>${res.summary.low_count}</b></span>` : ''}
        ${res.summary.out_count ? `<span class="text-danger">缺货 <b>${res.summary.out_count}</b></span>` : ''}
      </div>`);
      area.appendChild(renderPagination(res, (p) => { state.page = p; load(); }));
      bindRowClick(area, res.items, (r) => openItemFlow(r));
    };

    tabContent.querySelector('#s-keyword').addEventListener('input', debounce((e) => {
      state.keyword = e.target.value.trim(); state.page = 1; load();
    }, 320));
    tabContent.querySelector('#s-cat').addEventListener('change', (e) => { state.category_id = e.target.value; state.page = 1; load(); });
    tabContent.querySelector('#s-low').addEventListener('change', (e) => { state.only_low = e.target.checked; state.page = 1; load(); });
    tabContent.querySelector('#s-adjust').addEventListener('click', () => openAdjust(load));
    tabContent.querySelector('#s-export').addEventListener('click', async () => {
      const { downloadFile } = await import('../api.js');
      try { await downloadFile('/export/inventory.xlsx'); toast('导出成功', 'success'); } catch (e) { toast(e.message, 'error'); }
    });
    await load();
  }

  /* ============ 流水 ============ */
  async function renderFlow() {
    tabContent.innerHTML = `
      <div class="toolbar">
        <input class="input-sm input-search" id="f-kw" placeholder="搜索物品 / 备注">
        <select class="select-sm" id="f-type"><option value="">全部类型</option>
          <option value="in">入库</option><option value="out">出库</option><option value="adjust">盘点</option></select>
        <select class="select-sm" id="f-dept"><option value="">全部部门</option>
          ${store.dict.departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select>
        <input type="date" class="input-sm" id="f-from">
        <span class="text-muted">至</span>
        <input type="date" class="input-sm" id="f-to">
        <div class="spacer"></div>
        <button class="btn btn-sm" id="f-export">${svgIcon('download', 15)} 导出流水</button>
      </div>
      <div class="card"><div class="card-body tight" id="flow-area"></div></div>`;

    const fstate = { page: 1, size: 20, keyword: '', txn_type: '', department_id: '', date_from: '', date_to: '' };
    const area = tabContent.querySelector('#flow-area');
    const load = async () => {
      area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
      const res = await api.get('/stock/txns', { ...fstate });
      if (!res.total) { area.innerHTML = renderTable({ columns: [], rows: [] }); return; }
      const cols = [
        { key: 'created_at', title: '时间', render: (r) => `<span class="muted nowrap mono" style="font-size:12px">${String(r.created_at).slice(0, 16)}</span>` },
        { key: 'txn_type', title: '类型', render: (r) => txnBadge(r.txn_type) },
        { key: 'item_code', title: '编码', render: (r) => `<span class="mono muted">${escapeHtml(r.item_code)}</span>` },
        { key: 'item_name', title: '物品', render: (r) => `<b>${escapeHtml(r.item_name)}</b>` },
        { key: 'quantity', title: '数量', align: 'right', render: (r) => `<span class="mono ${r.txn_type === 'in' ? 'text-up' : 'text-down'}">${r.txn_type === 'in' ? '+' : r.txn_type === 'out' ? '-' : ''}${fmtNum(r.quantity)}</span> <span class="muted">${escapeHtml(r.unit || '')}</span>` },
        { key: 'amount', title: '金额', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.amount)}</span>` },
        { key: 'after_qty', title: '结存', align: 'right', render: (r) => `<span class="mono">${r.after_qty}</span>` },
        { key: 'department_name', title: '部门', render: (r) => escapeHtml(r.department_name || '-') },
        { key: 'operator_name', title: '操作人', render: (r) => escapeHtml(r.operator_name || '-') },
        { key: 'remark', title: '备注', render: (r) => `<span class="muted">${escapeHtml(r.remark || '-')}</span>` },
      ];
      area.innerHTML = renderTable({ columns: cols, rows: res.items, empty: '暂无流水记录' });
      area.appendChild(renderPagination(res, (p) => { fstate.page = p; load(); }));
    };

    tabContent.querySelector('#f-kw').addEventListener('input', debounce((e) => { fstate.keyword = e.target.value.trim(); fstate.page = 1; load(); }, 320));
    tabContent.querySelector('#f-type').addEventListener('change', (e) => { fstate.txn_type = e.target.value; fstate.page = 1; load(); });
    tabContent.querySelector('#f-dept').addEventListener('change', (e) => { fstate.department_id = e.target.value; fstate.page = 1; load(); });
    tabContent.querySelector('#f-from').addEventListener('change', (e) => { fstate.date_from = e.target.value; fstate.page = 1; load(); });
    tabContent.querySelector('#f-to').addEventListener('change', (e) => { fstate.date_to = e.target.value; fstate.page = 1; load(); });
    tabContent.querySelector('#f-export').addEventListener('click', async () => {
      const { downloadFile } = await import('../api.js');
      try { await downloadFile('/export/txns.xlsx', { date_from: fstate.date_from, date_to: fstate.date_to }); toast('导出成功', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    });
    await load();
  }

  await renderTab();
  return {};
}

function txnBadge(t) {
  const m = { in: ['入库', 'danger'], out: ['出库', 'success'], adjust: ['盘点', 'warning'] }[t] || [t, 'gray'];
  return badge(m[0], m[1]);
}

function waterBar(r) {
  const base = Math.max(r.safety_stock * 2, r.current_stock, 1);
  const pct = Math.min(100, (100 * r.current_stock) / base);
  const safePct = Math.min(100, (100 * r.safety_stock) / base);
  const color = r.is_out ? 'var(--danger)' : r.is_low ? 'var(--warning)' : 'var(--success)';
  return `<div style="position:relative;width:96px">
    <div class="bar"><i style="width:${pct}%;background:${color}"></i></div>
    ${r.safety_stock > 0 ? `<div style="position:absolute;left:${safePct}%;top:-2px;width:2px;height:11px;background:var(--text-3)"></div>` : ''}
  </div>`;
}

/* ============ 单物品流水 ============ */
async function openItemFlow(item) {
  const txns = await api.get(`/items/${item.id}/txns`, { limit: 80 });
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:18px">
      <div class="stat-mini"><span class="l">当前库存</span><span class="v">${item.current_stock}</span></div>
      <div class="stat-mini"><span class="l">安全库存</span><span class="v">${item.safety_stock}</span></div>
      <div class="stat-mini"><span class="l">库存货值</span><span class="v" style="font-size:15px">${fmtMoney(item.current_stock * item.unit_price)}</span></div>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>时间</th><th>类型</th><th style="text-align:right">数量</th><th style="text-align:right">变更前</th><th style="text-align:right">变更后</th><th>部门/备注</th></tr></thead>
      <tbody>${txns.length ? txns.map((t) => `<tr>
        <td class="muted nowrap mono" style="font-size:12px">${String(t.created_at).slice(0, 16)}</td>
        <td>${txnBadge(t.txn_type)}</td>
        <td class="num ${t.txn_type === 'in' ? 'text-up' : 'text-down'}">${t.txn_type === 'in' ? '+' : t.txn_type === 'out' ? '-' : ''}${t.quantity}</td>
        <td class="num muted">${t.before_qty}</td>
        <td class="num"><b>${t.after_qty}</b></td>
        <td class="muted">${escapeHtml(t.department_name || '')}${t.remark ? ' · ' + escapeHtml(t.remark) : ''}</td></tr>`).join('')
        : '<tr class="empty-row"><td colspan="6">暂无流水</td></tr>'}</tbody>
    </table></div>`;
  openDrawer({ title: `${item.name} · 库存流水`, body, width: '640px' });
}

/* ============ 盘点调整 ============ */
async function openAdjust(reload) {
  const items = await loadItemOptions(true);
  const body = document.createElement('div');
  body.innerHTML = `<form class="form-grid" id="adj-form">
    ${field('物品', `<select name="item_id" required>
      <option value="">请选择物品</option>
      ${items.map((i) => `<option value="${i.id}" data-stock="${i.current_stock}">${escapeHtml(i.code)} ${escapeHtml(i.name)}${i.spec ? ' / ' + escapeHtml(i.spec) : ''}（现有 ${i.current_stock} ${escapeHtml(i.unit || '')}）</option>`).join('')}
    </select>`, { span: 2, required: true })}
    ${field('调整为', `<input type="number" min="0" name="new_qty" required placeholder="盘点后的实际数量">`, { required: true })}
    ${field('当前库存', `<input value="" id="adj-cur" disabled>`)}
    ${field('调整原因', `<input name="reason" placeholder="如：月度盘点差异 / 破损报废">`, { span: 2 })}
  </form>`;

  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">确认调整</button>`;

  openModal({
    title: '库存盘点调整', body, footer,
    onMount(el, close) {
      const sel = el.querySelector('[name=item_id]');
      const curEl = el.querySelector('#adj-cur');
      sel.addEventListener('change', () => {
        const opt = sel.selectedOptions[0];
        curEl.value = opt && opt.dataset.stock !== undefined ? opt.dataset.stock : '';
      });
      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=save]').onclick = async () => {
        const form = el.querySelector('#adj-form');
        if (!form.reportValidity()) return;
        const data = formData(form);
        try {
          await api.post('/stock/adjust', data);
          toast('盘点调整完成', 'success');
          invalidateAll(); close(); reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

async function invalidateAll() {
  await loadItemOptions(true);
  await refreshAlerts();
  window.dispatchEvent(new CustomEvent('wms:refresh-alerts'));
}

function debounce(fn, wait) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}
