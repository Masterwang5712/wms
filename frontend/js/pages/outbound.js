// 出库管理：出库单登记（多明细行，前端校验库存）+ 确认出库 + 撤销
import { api } from '../api.js';
import { loadDict, loadItemOptions, refreshAlerts, store } from '../store.js';
import { escapeHtml } from '../router.js';
import {
  badge, bindRowClick, confirmDialog, field, fmtMoney, openDrawer, openModal,
  orderBadge, options, renderPagination, renderTable, svgIcon, toast, today,
} from '../ui.js';

let state = { page: 1, size: 20, keyword: '', status: '', department_id: '' };

const OUT_TYPES = { consume: '耗材领用', transfer: '部门调拨', scrap: '报废出库', sale: '销售出库' };

export default async function outbound(container) {
  await loadDict();
  container.innerHTML = `
    <div class="toolbar">
      <input class="input-sm input-search" id="f-kw" placeholder="搜索单号 / 领用人 / 用途" value="${escapeHtml(state.keyword)}">
      <select class="select-sm" id="f-status">
        <option value="">全部状态</option>
        <option value="draft">草稿</option>
        <option value="confirmed">已确认</option>
      </select>
      <select class="select-sm" id="f-dept">
        <option value="">全部部门</option>
        ${store.dict.departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}
      </select>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="btn-export">${svgIcon('download', 15)} 导出流水</button>
      <button class="btn btn-sm btn-primary" id="btn-new" ${store.canManage ? '' : 'disabled'}>${svgIcon('plus', 15)} 新建出库单</button>
    </div>
    <div class="card"><div class="card-body tight" id="area"></div></div>`;

  const statusEl = container.querySelector('#f-status');
  const deptEl = container.querySelector('#f-dept');
  statusEl.value = state.status; deptEl.value = state.department_id;

  container.querySelector('#f-kw').addEventListener('input', debounce((e) => {
    state.keyword = e.target.value.trim(); state.page = 1; load();
  }, 320));
  statusEl.addEventListener('change', () => { state.status = statusEl.value; state.page = 1; load(); });
  deptEl.addEventListener('change', () => { state.department_id = deptEl.value; state.page = 1; load(); });
  container.querySelector('#btn-new').addEventListener('click', () => openOrderForm(load));
  container.querySelector('#btn-export').addEventListener('click', async () => {
    const { downloadFile } = await import('../api.js');
    try { await downloadFile('/export/txns.xlsx'); toast('导出成功', 'success'); } catch (e) { toast(e.message, 'error'); }
  });

  const area = container.querySelector('#area');

  async function load() {
    area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
    const res = await api.get('/outbound', {
      page: state.page, size: state.size, keyword: state.keyword,
      status: state.status, department_id: state.department_id,
    });
    if (!res.total) { area.innerHTML = renderTable({ columns: [], rows: [] }); return; }
    const cols = [
      { key: 'order_no', title: '出库单号', render: (r) => `<span class="mono"><b>${escapeHtml(r.order_no)}</b></span>` },
      { key: 'order_date', title: '出库日期', render: (r) => `<span class="mono">${r.order_date}</span>` },
      { key: 'out_type', title: '类型', render: (r) => badge(OUT_TYPES[r.out_type] || r.out_type, 'primary') },
      { key: 'department_name', title: '领用部门', render: (r) => escapeHtml(r.department_name || '-') },
      { key: 'receiver', title: '领用人', render: (r) => escapeHtml(r.receiver || '-') },
      { key: 'line_count', title: '明细', align: 'right', render: (r) => `${r.line_count} 行` },
      { key: 'total_amount', title: '金额', align: 'right', render: (r) => `<b class="mono">${fmtMoney(r.total_amount)}</b>` },
      { key: 'status', title: '状态', render: (r) => orderBadge(r.status) },
      { key: 'act', title: '操作', align: 'right', render: (r) => store.canManage
        ? (r.status === 'draft'
          ? `<button class="btn btn-sm btn-primary" data-act="confirm" data-id="${r.id}">确认出库</button>
             <button class="btn btn-sm" data-act="del" data-id="${r.id}" style="color:var(--danger)">删除</button>`
          : '<span class="text-muted" style="font-size:12px">已出账</span>')
        : '<span class="text-muted">—</span>' },
    ];
    area.innerHTML = renderTable({ columns: cols, rows: res.items, empty: '暂无出库单' });
    area.appendChild(renderPagination(res, (p) => { state.page = p; load(); }));
    bindRowClick(area, res.items, (r) => openOrderDetail(r));

    area.querySelectorAll('[data-act=confirm]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog('确认出库', '确认后将按明细扣减库存，若任一物品库存不足则整单失败。是否继续？', { okText: '确认出库' });
      if (!ok) return;
      try {
        await api.post(`/outbound/${b.dataset.id}/confirm`);
        toast('出库成功，库存已扣减', 'success');
        await loadItemOptions(true); await refreshAlerts();
        window.dispatchEvent(new CustomEvent('wms:refresh-alerts'));
        load();
      } catch (ex) { toast(ex.message, 'error', 4200); }
    }));
    area.querySelectorAll('[data-act=del]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog('删除出库单', '确定删除该草稿出库单吗？', { danger: true, okText: '删除' });
      if (!ok) return;
      try { await api.del('/outbound/' + b.dataset.id); toast('已删除', 'success'); load(); }
      catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  await load();
  return {};
}

/* ============ 新建出库单 ============ */
async function openOrderForm(reload) {
  await loadDict();
  const items = await loadItemOptions(true);

  const body = document.createElement('div');
  body.innerHTML = `
    <form id="out-form">
      <div class="form-grid" style="margin-bottom:18px">
        ${field('出库日期', `<input type="date" name="order_date" value="${today()}" required>`, { required: true })}
        ${field('出库类型', `<select name="out_type">
          ${Object.entries(OUT_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>`)}
        ${field('领用部门', `<select name="department_id" id="f-dept-sel">${options(store.dict.departments, { placeholder: '请选择部门' })}</select>`)}
        ${field('领用人', `<select name="staff_id" id="f-staff-sel"><option value="">请选择领用人</option>
          ${store.dict.staff.map((s) => `<option value="${s.id}" data-dept="${s.department_id || ''}">${escapeHtml(s.name)}（${escapeHtml(s.department_name || '')}）</option>`).join('')}
        </select>`)}
        ${field('用途 / 事由', `<input name="purpose" placeholder="如：日常办公领用 / 实验耗材补充">`, { span: 2 })}
      </div>

      <div class="section-title" style="font-size:13.5px;display:flex;justify-content:space-between">
        <span>出库明细</span>
        <button type="button" class="btn btn-sm" id="add-line">${svgIcon('plus', 14)} 添加明细行</button>
      </div>
      <div class="table-wrap">
        <table class="line-table">
          <thead><tr>
            <th style="width:40%">物品</th><th style="width:14%">数量</th><th style="width:16%">单价(元)</th>
            <th style="width:16%">金额</th><th style="width:40px"></th>
          </tr></thead>
          <tbody id="lines"></tbody>
          <tfoot><tr>
            <td colspan="3" style="text-align:right;padding-right:12px"><b>合计</b></td>
            <td class="num-cell" id="total" style="font-weight:700">¥0.00</td><td></td>
          </tr></tfoot>
        </table>
      </div>
      <p class="form-hint" style="margin-top:8px">提示：数量不得超过当前库存，前端会即时校验，后端确认时会再次校验。</p>
    </form>`;

  const linesEl = body.querySelector('#lines');
  const deptSel = body.querySelector('#f-dept-sel');
  const staffSel = body.querySelector('#f-staff-sel');

  // 领用人随部门联动过滤
  function filterStaff() {
    const d = deptSel.value;
    staffSel.querySelectorAll('option[data-dept]').forEach((o) => {
      const show = !d || o.dataset.dept === d;
      o.hidden = !show;
      if (!show && o.selected) staffSel.value = '';
    });
  }
  deptSel.addEventListener('change', filterStaff);

  const itemOpts = items.map((i) => `<option value="${i.id}" data-price="${i.unit_price}" data-stock="${i.current_stock}" data-unit="${escapeHtml(i.unit || '')}">${escapeHtml(i.code)} ${escapeHtml(i.name)}${i.spec ? ' / ' + escapeHtml(i.spec) : ''}（库存 ${i.current_stock}）</option>`).join('');

  function addLine() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select class="l-item"><option value="">请选择物品</option>${itemOpts}</select></td>
      <td><input type="number" class="l-qty" min="1" step="1" value="1">
          <div class="form-hint l-stock-hint"></div></td>
      <td><input type="number" class="l-price" min="0" step="0.01" value="0"></td>
      <td class="num-cell l-amount">¥0.00</td>
      <td><button type="button" class="btn btn-sm btn-ghost l-del" style="color:var(--danger)">×</button></td>`;
    linesEl.appendChild(tr);

    const sel = tr.querySelector('.l-item');
    const qty = tr.querySelector('.l-qty');
    const price = tr.querySelector('.l-price');
    const hint = tr.querySelector('.l-stock-hint');

    const recalc = () => {
      const a = (Number(qty.value) || 0) * (Number(price.value) || 0);
      tr.querySelector('.l-amount').textContent = fmtMoney(a, false);
      recalcTotal();
    };
    const checkStock = () => {
      const o = sel.selectedOptions[0];
      if (!o || !o.value) { hint.textContent = ''; return; }
      const stock = Number(o.dataset.stock) || 0;
      const q = Number(qty.value) || 0;
      if (q > stock) {
        hint.textContent = `超出库存！当前仅 ${stock} ${o.dataset.unit || ''}`;
        hint.style.color = 'var(--danger)';
        qty.style.borderColor = 'var(--danger)';
      } else {
        hint.textContent = `可用库存 ${stock} ${o.dataset.unit || ''}`;
        hint.style.color = '';
        qty.style.borderColor = '';
      }
    };
    sel.addEventListener('change', () => {
      const o = sel.selectedOptions[0];
      if (o && o.dataset.price) price.value = Number(o.dataset.price).toFixed(2);
      checkStock(); recalc();
    });
    qty.addEventListener('input', () => { checkStock(); recalc(); });
    price.addEventListener('input', recalc);
    tr.querySelector('.l-del').addEventListener('click', () => { tr.remove(); recalcTotal(); });
  }

  function recalcTotal() {
    let sum = 0;
    linesEl.querySelectorAll('tr').forEach((tr) => {
      sum += (Number(tr.querySelector('.l-qty').value) || 0) * (Number(tr.querySelector('.l-price').value) || 0);
    });
    body.querySelector('#total').textContent = fmtMoney(sum);
  }

  addLine();
  body.querySelector('#add-line').addEventListener('click', addLine);

  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button>
    <button class="btn" data-act="draft">保存为草稿</button>
    <button class="btn btn-primary" data-act="save">保存并确认出库</button>`;

  openModal({
    title: '新建出库单', body, footer, width: 'wide',
    onMount(el, close) {
      const collect = () => {
        const form = el.querySelector('#out-form');
        const fd = new FormData(form);
        const lines = [];
        let err = null;
        linesEl.querySelectorAll('tr').forEach((tr) => {
          const o = tr.querySelector('.l-item').selectedOptions[0];
          const itemId = tr.querySelector('.l-item').value;
          const q = Number(tr.querySelector('.l-qty').value) || 0;
          if (!itemId || q <= 0) return;
          const stock = Number(o.dataset.stock) || 0;
          if (q > stock) err = `${o.textContent.split('（')[0]} 库存不足：可用 ${stock}，需要 ${q}`;
          lines.push({
            item_id: Number(itemId), quantity: q,
            unit_price: Number(tr.querySelector('.l-price').value) || 0,
          });
        });
        if (err) { toast(err, 'error', 4200); return null; }
        if (!lines.length) { toast('请至少添加一条有效明细', 'warning'); return null; }
        return {
          order_date: fd.get('order_date'),
          out_type: fd.get('out_type'),
          department_id: fd.get('department_id') ? Number(fd.get('department_id')) : null,
          staff_id: fd.get('staff_id') ? Number(fd.get('staff_id')) : null,
          receiver: staffSel.selectedOptions[0] && staffSel.value ? staffSel.selectedOptions[0].textContent.split('（')[0] : null,
          purpose: fd.get('purpose') || null,
          items: lines,
          auto_confirm: true,
        };
      };

      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=draft]').onclick = async () => {
        const data = collect(); if (!data) return;
        data.auto_confirm = false;
        try { await api.post('/outbound', data); toast('已保存为草稿', 'success'); close(); reload(); }
        catch (e) { toast(e.message, 'error'); }
      };
      footer.querySelector('[data-act=save]').onclick = async () => {
        const data = collect(); if (!data) return;
        try {
          await api.post('/outbound', data);
          toast('出库成功，库存已扣减', 'success');
          await loadItemOptions(true); await refreshAlerts();
          window.dispatchEvent(new CustomEvent('wms:refresh-alerts'));
          close(); reload();
        } catch (e) { toast(e.message, 'error', 4200); }
      };
    },
  });
}

/* ============ 单据详情 ============ */
async function openOrderDetail(row) {
  const order = await api.get('/outbound/' + row.id);
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="desc-list" style="margin-bottom:18px">
      <div class="desc-item"><div class="desc-label">出库单号</div><div class="desc-value mono"><b>${escapeHtml(order.order_no)}</b></div></div>
      <div class="desc-item"><div class="desc-label">状态</div><div class="desc-value">${orderBadge(order.status)}</div></div>
      <div class="desc-item"><div class="desc-label">出库日期</div><div class="desc-value mono">${order.order_date}</div></div>
      <div class="desc-item"><div class="desc-label">出库类型</div><div class="desc-value">${escapeHtml(OUT_TYPES[order.out_type] || order.out_type)}</div></div>
      <div class="desc-item"><div class="desc-label">领用部门</div><div class="desc-value">${escapeHtml(order.department_name || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">领用人</div><div class="desc-value">${escapeHtml(order.receiver || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">用途</div><div class="desc-value">${escapeHtml(order.purpose || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">合计金额</div><div class="desc-value mono"><b>${fmtMoney(order.total_amount)}</b></div></div>
    </div>
    <div class="section-title" style="font-size:13.5px">出库明细</div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>物品</th><th>规格</th><th style="text-align:right">数量</th><th style="text-align:right">单价</th><th style="text-align:right">金额</th></tr></thead>
      <tbody>${order.items.map((it) => `<tr>
        <td><b>${escapeHtml(it.item_name)}</b> <span class="muted mono" style="font-size:11.5px">${escapeHtml(it.item_code)}</span></td>
        <td class="muted">${escapeHtml(it.spec || '-')}</td>
        <td class="num">${it.quantity} ${escapeHtml(it.unit || '')}</td>
        <td class="num">${fmtMoney(it.unit_price)}</td>
        <td class="num"><b>${fmtMoney(it.amount)}</b></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  openDrawer({ title: '出库单详情', body, width: '660px' });
}

function debounce(fn, wait) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}
