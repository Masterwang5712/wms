// 耗材领用与消耗统计：快速领用 + 领用记录 + 多维消耗统计（图表）
import { api } from '../api.js';
import { loadDict, loadItemOptions, refreshAlerts, store } from '../store.js';
import { escapeHtml } from '../router.js';
import {
  badge, field, fmtMoney, fmtNum, openModal, options, renderPagination,
  renderTable, svgIcon, toast, today,
} from '../ui.js';
import { barList, donutChart, lineChart } from '../charts.js';

let state = { tab: 'stats', dim: 'department', page: 1, size: 20 };

const DIM_LABEL = { department: '按部门', staff: '按人员', item: '按物品', month: '按月份' };

export default async function consumables(container) {
  await loadDict();
  container.innerHTML = `
    <div class="toolbar">
      <div class="tabs" style="margin:0;border:none">
        <button class="tab ${state.tab === 'stats' ? 'active' : ''}" data-tab="stats">消耗统计</button>
        <button class="tab ${state.tab === 'issues' ? 'active' : ''}" data-tab="issues">领用记录</button>
      </div>
      <div class="spacer"></div>
      <button class="btn btn-sm btn-primary" id="btn-issue" ${store.canManage ? '' : 'disabled'}>${svgIcon('plus', 15)} 快速领用登记</button>
    </div>
    <div id="tab-body"></div>`;

  container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    renderTab();
  }));
  container.querySelector('#btn-issue').addEventListener('click', () => openIssueForm(renderTab));

  const tabBody = container.querySelector('#tab-body');

  async function renderTab() {
    if (state.tab === 'stats') await renderStats();
    else await renderIssues();
  }

  /* ============ 消耗统计 ============ */
  async function renderStats() {
    tabBody.innerHTML = `
      <div class="toolbar">
        <div class="btn-row" id="dim-btns">
          ${Object.entries(DIM_LABEL).map(([k, v]) => `<button class="btn btn-sm ${state.dim === k ? 'btn-primary' : ''}" data-dim="${k}">${v}</button>`).join('')}
        </div>
        <div class="spacer"></div>
        <input type="date" class="input-sm" id="st-from">
        <span class="text-muted">至</span>
        <input type="date" class="input-sm" id="st-to">
        <button class="btn btn-sm" id="st-export">${svgIcon('download', 15)} 导出统计</button>
      </div>
      <div class="grid grid-2-1" style="margin-bottom:16px">
        <div class="card"><div class="card-head"><h3>${svgIcon('chart')}消耗分布（${DIM_LABEL[state.dim]}）</h3></div>
          <div class="card-body"><div id="stat-chart"></div></div></div>
        <div class="card"><div class="card-head"><h3>汇总</h3></div>
          <div class="card-body" id="stat-sum"></div></div>
      </div>
      <div class="card"><div class="card-head"><h3>明细数据</h3></div>
        <div class="card-body tight" id="stat-table"></div></div>`;

    const filters = { date_from: '', date_to: '' };
    const load = async () => {
      const chartEl = tabBody.querySelector('#stat-chart');
      const tableEl = tabBody.querySelector('#stat-table');
      const sumEl = tabBody.querySelector('#stat-sum');
      chartEl.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
      const res = await api.get('/consumables/stats', { dim: state.dim, limit: 50, ...filters });

      if (state.dim === 'month') {
        lineChart(chartEl, {
          labels: res.rows.map((r) => r.name),
          series: [{ name: '领用金额', color: getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#2f6fed', data: res.rows.map((r) => r.total_amount) }],
          height: 230, valueFmt: fmtMoney,
        });
      } else if (state.dim === 'item') {
        barList(chartEl, { items: res.rows.map((r) => ({ name: r.name, value: r.total_amount })), valueFmt: fmtMoney, maxItems: 8 });
      } else {
        donutChart(chartEl, { items: res.rows.map((r) => ({ name: r.name, value: r.total_amount })), valueFmt: fmtMoney });
      }

      sumEl.innerHTML = `
        <div class="stat-mini" style="margin-bottom:16px"><span class="l">领用总金额</span><span class="v" style="font-size:22px">${fmtMoney(res.total_amount)}</span></div>
        <div class="stat-mini" style="margin-bottom:16px"><span class="l">领用总数量</span><span class="v">${fmtNum(res.total_qty)} <span style="font-size:12px;font-weight:400">件</span></span></div>
        <div class="stat-mini"><span class="l">统计分组数</span><span class="v">${res.rows.length} <span style="font-size:12px;font-weight:400">组</span></span></div>`;

      const label = { department: '部门', staff: '人员', item: '物品', month: '月份' }[state.dim];
      const maxAmt = Math.max(...res.rows.map((r) => r.total_amount), 1);
      tableEl.innerHTML = renderTable({
        columns: [
          { key: 'name', title: label, render: (r) => `<b>${escapeHtml(r.name)}</b>` },
          { key: 'total_qty', title: '领用数量', align: 'right', render: (r) => fmtNum(r.total_qty) },
          { key: 'cnt', title: '领用次数', align: 'right', render: (r) => fmtNum(r.cnt) },
          { key: 'total_amount', title: '领用金额', align: 'right', render: (r) => `<b class="mono">${fmtMoney(r.total_amount)}</b>` },
          { key: 'pct', title: '占比', render: (r) => `<div style="display:flex;align-items:center;gap:8px">
            <div class="bar" style="width:80px"><i style="width:${(100 * r.total_amount) / maxAmt}%;background:var(--primary)"></i></div>
            <span class="mono" style="font-size:11.5px">${((100 * r.total_amount) / (res.total_amount || 1)).toFixed(1)}%</span></div>` },
        ],
        rows: res.rows, empty: '该区间暂无领用记录',
      });
    };

    tabBody.querySelectorAll('[data-dim]').forEach((b) => b.addEventListener('click', () => {
      state.dim = b.dataset.dim;
      tabBody.querySelectorAll('[data-dim]').forEach((x) => x.classList.toggle('btn-primary', x === b));
      load();
    }));
    tabBody.querySelector('#st-from').addEventListener('change', (e) => { filters.date_from = e.target.value; load(); });
    tabBody.querySelector('#st-to').addEventListener('change', (e) => { filters.date_to = e.target.value; load(); });
    tabBody.querySelector('#st-export').addEventListener('click', async () => {
      const { downloadFile } = await import('../api.js');
      try { await downloadFile('/export/consumption.xlsx', { dim: state.dim, ...filters }); toast('导出成功', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    });
    await load();
  }

  /* ============ 领用记录 ============ */
  async function renderIssues() {
    tabBody.innerHTML = `
      <div class="toolbar">
        <input class="input-sm input-search" id="i-kw" placeholder="搜索物品 / 单号 / 用途 / 领用人">
        <select class="select-sm" id="i-dept"><option value="">全部部门</option>
          ${store.dict.departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select>
        <input type="date" class="input-sm" id="i-from">
        <span class="text-muted">至</span>
        <input type="date" class="input-sm" id="i-to">
      </div>
      <div class="card"><div class="card-body tight" id="issue-area"></div></div>`;

    const f = { page: 1, size: 20, keyword: '', department_id: '', date_from: '', date_to: '' };
    const area = tabBody.querySelector('#issue-area');
    const load = async () => {
      area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
      const res = await api.get('/consumables/issues', { ...f });
      if (!res.total) { area.innerHTML = renderTable({ columns: [], rows: [] }); return; }
      const cols = [
        { key: 'issued_at', title: '领用日期', render: (r) => `<span class="mono">${r.issued_at}</span>` },
        { key: 'order_no', title: '单号', render: (r) => `<span class="mono muted">${escapeHtml(r.order_no)}</span>` },
        { key: 'item_name', title: '物品', render: (r) => `<b>${escapeHtml(r.item_name)}</b><div class="muted" style="font-size:11.5px">${escapeHtml(r.spec || '')}</div>` },
        { key: 'quantity', title: '数量', align: 'right', render: (r) => `<span class="mono">${r.quantity}</span> <span class="muted">${escapeHtml(r.unit || '')}</span>` },
        { key: 'amount', title: '金额', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.amount)}</span>` },
        { key: 'department_name', title: '领用部门', render: (r) => badge(r.department_name || '未指定', 'gray') },
        { key: 'staff_name', title: '领用人', render: (r) => escapeHtml(r.staff_name || '-') },
        { key: 'purpose', title: '用途', render: (r) => `<span class="muted">${escapeHtml(r.purpose || '-')}</span>` },
      ];
      area.innerHTML = renderTable({ columns: cols, rows: res.items, empty: '暂无领用记录' });
      area.insertAdjacentHTML('afterbegin', `<div style="padding:10px 16px;font-size:12.5px;color:var(--text-2);border-bottom:1px solid var(--border-2)">
        共 <b>${res.summary.count}</b> 条 · 领用数量 <b>${fmtNum(res.summary.total_qty)}</b> · 领用金额 <b>${fmtMoney(res.summary.total_amount)}</b></div>`);
      area.appendChild(renderPagination(res, (p) => { f.page = p; load(); }));
    };

    tabBody.querySelector('#i-kw').addEventListener('input', debounce((e) => { f.keyword = e.target.value.trim(); f.page = 1; load(); }, 320));
    tabBody.querySelector('#i-dept').addEventListener('change', (e) => { f.department_id = e.target.value; f.page = 1; load(); });
    tabBody.querySelector('#i-from').addEventListener('change', (e) => { f.date_from = e.target.value; f.page = 1; load(); });
    tabBody.querySelector('#i-to').addEventListener('change', (e) => { f.date_to = e.target.value; f.page = 1; load(); });
    await load();
  }

  await renderTab();
  return {};
}

/* ============ 快速领用 ============ */
async function openIssueForm(reload) {
  await loadDict();
  const items = (await loadItemOptions(true)).filter((i) => i.current_stock >= 0);
  const consumable = await api.get('/items/options', { item_type: 'consumable' });

  const body = document.createElement('div');
  body.innerHTML = `<form class="form-grid" id="issue-form">
    ${field('领用物品', `<select name="item_id" id="is-item" required>
      <option value="">请选择耗材</option>
      ${consumable.map((i) => `<option value="${i.id}" data-price="${i.unit_price}" data-stock="${i.current_stock}" data-unit="${escapeHtml(i.unit || '')}">${escapeHtml(i.code)} ${escapeHtml(i.name)}${i.spec ? ' / ' + escapeHtml(i.spec) : ''}（库存 ${i.current_stock}）</option>`).join('')}
    </select>`, { span: 2, required: true })}
    ${field('领用数量', `<input type="number" min="1" name="quantity" id="is-qty" value="1" required>
      <div class="form-hint" id="is-hint"></div>`, { required: true })}
    ${field('领用日期', `<input type="date" name="issued_at" value="${today()}" required>`, { required: true })}
    ${field('领用部门', `<select name="department_id" id="is-dept">${options(store.dict.departments, { placeholder: '请选择部门' })}</select>`)}
    ${field('领用人', `<select name="staff_id" id="is-staff"><option value="">请选择领用人</option>
      ${store.dict.staff.map((s) => `<option value="${s.id}" data-dept="${s.department_id || ''}">${escapeHtml(s.name)}（${escapeHtml(s.department_name || '')}）</option>`).join('')}
    </select>`)}
    ${field('用途', `<input name="purpose" placeholder="如：实验耗材补充 / 日常办公">`, { span: 2 })}
    ${field('备注', `<input name="remark" placeholder="选填">`, { span: 2 })}
  </form>`;

  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">确认领用</button>`;

  openModal({
    title: '耗材快速领用登记', body, footer,
    onMount(el, close) {
      const itemSel = el.querySelector('#is-item');
      const qtyEl = el.querySelector('#is-qty');
      const hint = el.querySelector('#is-hint');
      const deptSel = el.querySelector('#is-dept');
      const staffSel = el.querySelector('#is-staff');

      const check = () => {
        const o = itemSel.selectedOptions[0];
        if (!o || !o.value) { hint.textContent = ''; return; }
        const stock = Number(o.dataset.stock) || 0;
        const q = Number(qtyEl.value) || 0;
        if (q > stock) { hint.textContent = `超出库存！当前仅 ${stock} ${o.dataset.unit || ''}`; hint.style.color = 'var(--danger)'; }
        else { hint.textContent = `可用库存 ${stock} ${o.dataset.unit || ''}`; hint.style.color = ''; }
      };
      itemSel.addEventListener('change', check);
      qtyEl.addEventListener('input', check);

      deptSel.addEventListener('change', () => {
        const d = deptSel.value;
        staffSel.querySelectorAll('option[data-dept]').forEach((o) => {
          const show = !d || o.dataset.dept === d;
          o.hidden = !show;
          if (!show && o.selected) staffSel.value = '';
        });
      });

      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=save]').onclick = async () => {
        const form = el.querySelector('#issue-form');
        if (!form.reportValidity()) return;
        const o = itemSel.selectedOptions[0];
        if (Number(qtyEl.value) > Number(o.dataset.stock || 0)) { toast('领用数量超出当前库存', 'error'); return; }
        const fd = new FormData(form);
        const payload = {
          item_id: Number(fd.get('item_id')),
          quantity: Number(fd.get('quantity')),
          department_id: fd.get('department_id') ? Number(fd.get('department_id')) : null,
          staff_id: fd.get('staff_id') ? Number(fd.get('staff_id')) : null,
          purpose: fd.get('purpose') || null,
          issued_at: fd.get('issued_at') || null,
          remark: fd.get('remark') || null,
        };
        try {
          const r = await api.post('/consumables/issue', payload);
          toast(`领用成功，单号 ${r.order_no}`, 'success');
          await loadItemOptions(true); await refreshAlerts();
          window.dispatchEvent(new CustomEvent('wms:refresh-alerts'));
          close(); reload();
        } catch (e) { toast(e.message, 'error', 4200); }
      };
    },
  });
}

function debounce(fn, wait) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}
