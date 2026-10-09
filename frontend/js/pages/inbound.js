// 入库管理：入库单登记（多明细行）+ 确认入库 + 撤销
import { api } from '../api.js';
import { invalidateDict, loadDict, loadItemOptions, refreshAlerts, store } from '../store.js';
import { escapeHtml } from '../router.js';
import {
  badge, bindRowClick, confirmDialog, field, fmtMoney, openDrawer, openModal,
  orderBadge, options, renderPagination, renderTable, svgIcon, toast, today,
} from '../ui.js';

let state = { page: 1, size: 20, keyword: '', status: '' };

export default async function inbound(container) {
  await loadDict();
  container.innerHTML = `
    <div class="toolbar">
      <input class="input-sm input-search" id="f-kw" placeholder="搜索单号 / 供应商" value="${escapeHtml(state.keyword)}">
      <select class="select-sm" id="f-status">
        <option value="">全部状态</option>
        <option value="draft">草稿</option>
        <option value="confirmed">已确认</option>
      </select>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="btn-export">${svgIcon('download', 15)} 导出</button>
      <button class="btn btn-sm btn-primary" id="btn-new" ${store.canManage ? '' : 'disabled'}>${svgIcon('plus', 15)} 新建入库单</button>
    </div>
    <div class="card"><div class="card-body tight" id="area"></div></div>`;

  const statusEl = container.querySelector('#f-status');
  statusEl.value = state.status;

  container.querySelector('#f-kw').addEventListener('input', debounce((e) => {
    state.keyword = e.target.value.trim(); state.page = 1; load();
  }, 320));
  statusEl.addEventListener('change', () => { state.status = statusEl.value; state.page = 1; load(); });
  container.querySelector('#btn-new').addEventListener('click', () => openOrderForm(load));
  container.querySelector('#btn-export').addEventListener('click', async () => {
    const { downloadFile } = await import('../api.js');
    try { await downloadFile('/export/monthly.xlsx'); toast('已导出月度报表', 'success'); } catch (e) { toast(e.message, 'error'); }
  });

  const area = container.querySelector('#area');

  async function load() {
    area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
    const res = await api.get('/inbound', { page: state.page, size: state.size, keyword: state.keyword, status: state.status });
    if (!res.total) { area.innerHTML = renderTable({ columns: [], rows: [] }); return; }
    const cols = [
      { key: 'order_no', title: '入库单号', render: (r) => `<span class="mono"><b>${escapeHtml(r.order_no)}</b></span>` },
      { key: 'order_date', title: '入库日期', render: (r) => `<span class="mono">${r.order_date}</span>` },
      { key: 'supplier_name', title: '供应商', render: (r) => escapeHtml(r.supplier_name || '-') },
      { key: 'handler', title: '经办人', render: (r) => escapeHtml(r.handler || '-') },
      { key: 'line_count', title: '明细', align: 'right', render: (r) => `${r.line_count} 行` },
      { key: 'total_amount', title: '金额', align: 'right', render: (r) => `<b class="mono">${fmtMoney(r.total_amount)}</b>` },
      { key: 'status', title: '状态', render: (r) => orderBadge(r.status) },
      { key: 'operator_name', title: '制单人', render: (r) => `<span class="muted">${escapeHtml(r.operator_name || '-')}</span>` },
      { key: 'act', title: '操作', align: 'right', render: (r) => store.canManage
        ? (r.status === 'draft'
          ? `<button class="btn btn-sm btn-primary" data-act="confirm" data-id="${r.id}">确认入库</button>
             <button class="btn btn-sm" data-act="del" data-id="${r.id}" style="color:var(--danger)">删除</button>`
          : '<span class="text-muted" style="font-size:12px">已入账</span>')
        : '<span class="text-muted">—</span>' },
    ];
    area.innerHTML = renderTable({ columns: cols, rows: res.items, empty: '暂无入库单' });
    area.appendChild(renderPagination(res, (p) => { state.page = p; load(); }));
    bindRowClick(area, res.items, (r) => openOrderDetail(r));

    area.querySelectorAll('[data-act=confirm]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog('确认入库', '确认后该入库单的明细将全部计入库存，且不可再修改。是否继续？', { okText: '确认入库' });
      if (!ok) return;
      try {
        await api.post(`/inbound/${b.dataset.id}/confirm`);
        toast('入库成功，库存已更新', 'success');
        await loadItemOptions(true); await refreshAlerts();
        window.dispatchEvent(new CustomEvent('wms:refresh-alerts'));
        load();
      } catch (ex) { toast(ex.message, 'error'); }
    }));
    area.querySelectorAll('[data-act=del]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog('删除入库单', '确定删除该草稿入库单吗？', { danger: true, okText: '删除' });
      if (!ok) return;
      try { await api.del('/inbound/' + b.dataset.id); toast('已删除', 'success'); load(); }
      catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  await load();
  return {};
}

/* ============ 新建入库单 ============ */
async function openOrderForm(reload) {
  await loadDict();
  const items = await loadItemOptions(true);

  const body = document.createElement('div');
  body.innerHTML = `
    <form id="in-form">
      <div class="form-grid" style="margin-bottom:18px">
        ${field('入库日期', `<input type="date" name="order_date" value="${today()}" required>`, { required: true })}
        ${field('供应商', `<select name="supplier_id">${options(store.dict.suppliers, { placeholder: '请选择供应商' })}</select>`)}
        ${field('供应商名称（自定义）', `<input name="supplier_name" placeholder="列表中没有时可手填">`)}
        ${field('经办人', `<input name="handler" value="${escapeHtml(store.user.display_name || '')}">`)}
        ${field('备注', `<input name="remark" placeholder="选填">`, { span: 2 })}
      </div>

      <div class="section-title" style="font-size:13.5px;display:flex;justify-content:space-between">
        <span>入库明细</span>
        <button type="button" class="btn btn-sm" id="add-line">${svgIcon('plus', 14)} 添加明细行</button>
      </div>
      <div class="table-wrap">
        <table class="line-table">
          <thead><tr>
            <th style="width:34%">物品</th><th style="width:12%">数量</th><th style="width:14%">单价(元)</th>
            <th style="width:14%">批次号</th><th style="width:15%">有效期</th><th style="width:11%">金额</th><th style="width:40px"></th>
          </tr></thead>
          <tbody id="lines"></tbody>
          <tfoot><tr>
            <td colspan="5" style="text-align:right;padding-right:12px"><b>合计</b></td>
            <td class="num-cell" id="total" style="font-weight:700">¥0.00</td><td></td>
          </tr></tfoot>
        </table>
      </div>
      <p class="form-hint" style="margin-top:8px">提示：选择物品后会自动带出参考单价；确认入库后库存才会正式增加。</p>
    </form>`;

  const linesEl = body.querySelector('#lines');
  const itemOpts = items.map((i) => `<option value="${i.id}" data-price="${i.unit_price}" data-unit="${escapeHtml(i.unit || '')}">${escapeHtml(i.code)} ${escapeHtml(i.name)}${i.spec ? ' / ' + escapeHtml(i.spec) : ''}</option>`).join('');

  function addLine() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select class="l-item"><option value="">请选择物品</option>${itemOpts}</select></td>
      <td><input type="number" class="l-qty" min="1" step="1" value="1"></td>
      <td><input type="number" class="l-price" min="0" step="0.01" value="0"></td>
      <td><input class="l-batch" placeholder="选填"></td>
      <td><input type="date" class="l-expire"></td>
      <td class="num-cell l-amount">¥0.00</td>
      <td><button type="button" class="btn btn-sm btn-ghost l-del" style="color:var(--danger)">×</button></td>`;
    linesEl.appendChild(tr);

    const sel = tr.querySelector('.l-item');
    const qty = tr.querySelector('.l-qty');
    const price = tr.querySelector('.l-price');
    const recalc = () => {
      const a = (Number(qty.value) || 0) * (Number(price.value) || 0);
      tr.querySelector('.l-amount').textContent = fmtMoney(a, false);
      recalcTotal();
    };
    sel.addEventListener('change', () => {
      const o = sel.selectedOptions[0];
      if (o && o.dataset.price) price.value = Number(o.dataset.price).toFixed(2);
      recalc();
    });
    qty.addEventListener('input', recalc);
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
    <button class="btn btn-primary" data-act="save">保存并确认入库</button>`;

  openModal({
    title: '新建入库单', body, footer, width: 'wide',
    onMount(el, close) {
      const collect = () => {
        const form = el.querySelector('#in-form');
        const fd = new FormData(form);
        const lines = [];
        linesEl.querySelectorAll('tr').forEach((tr) => {
          const itemId = tr.querySelector('.l-item').value;
          const q = Number(tr.querySelector('.l-qty').value) || 0;
          if (!itemId || q <= 0) return;
          lines.push({
            item_id: Number(itemId), quantity: q,
            unit_price: Number(tr.querySelector('.l-price').value) || 0,
            batch_no: tr.querySelector('.l-batch').value || null,
            expire_date: tr.querySelector('.l-expire').value || null,
          });
        });
        if (!lines.length) { toast('请至少添加一条有效明细（选择物品且数量大于 0）', 'warning'); return null; }
        return {
          order_date: fd.get('order_date'),
          supplier_id: fd.get('supplier_id') ? Number(fd.get('supplier_id')) : null,
          supplier_name: fd.get('supplier_name') || null,
          handler: fd.get('handler') || null,
          remark: fd.get('remark') || null,
          items: lines,
          auto_confirm: true,
        };
      };

      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=draft]').onclick = async () => {
        const data = collect(); if (!data) return;
        data.auto_confirm = false;
        try { await api.post('/inbound', data); toast('已保存为草稿', 'success'); close(); reload(); }
        catch (e) { toast(e.message, 'error'); }
      };
      footer.querySelector('[data-act=save]').onclick = async () => {
        const data = collect(); if (!data) return;
        try {
          await api.post('/inbound', data);
          toast('入库成功，库存已增加', 'success');
          await loadItemOptions(true); await refreshAlerts();
          window.dispatchEvent(new CustomEvent('wms:refresh-alerts'));
          close(); reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

/* ============ 单据详情 ============ */
async function openOrderDetail(row) {
  const order = await api.get('/inbound/' + row.id);
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="desc-list" style="margin-bottom:18px">
      <div class="desc-item"><div class="desc-label">入库单号</div><div class="desc-value mono"><b>${escapeHtml(order.order_no)}</b></div></div>
      <div class="desc-item"><div class="desc-label">状态</div><div class="desc-value">${orderBadge(order.status)}</div></div>
      <div class="desc-item"><div class="desc-label">入库日期</div><div class="desc-value mono">${order.order_date}</div></div>
      <div class="desc-item"><div class="desc-label">供应商</div><div class="desc-value">${escapeHtml(order.supplier_name || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">经办人</div><div class="desc-value">${escapeHtml(order.handler || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">合计金额</div><div class="desc-value mono"><b>${fmtMoney(order.total_amount)}</b></div></div>
      <div class="desc-item full"><div class="desc-label">备注</div><div class="desc-value">${escapeHtml(order.remark || '-')}</div></div>
    </div>
    <div class="section-title" style="font-size:13.5px">入库明细</div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>物品</th><th>规格</th><th style="text-align:right">数量</th><th style="text-align:right">单价</th><th style="text-align:right">金额</th><th>批次/效期</th></tr></thead>
      <tbody>${order.items.map((it) => `<tr>
        <td><b>${escapeHtml(it.item_name)}</b> <span class="muted mono" style="font-size:11.5px">${escapeHtml(it.item_code)}</span></td>
        <td class="muted">${escapeHtml(it.spec || '-')}</td>
        <td class="num">${it.quantity} ${escapeHtml(it.unit || '')}</td>
        <td class="num">${fmtMoney(it.unit_price)}</td>
        <td class="num"><b>${fmtMoney(it.amount)}</b></td>
        <td class="muted" style="font-size:12px">${escapeHtml(it.batch_no || '-')}${it.expire_date ? ' / ' + it.expire_date : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  openDrawer({ title: '入库单详情', body, width: '680px' });
}

function debounce(fn, wait) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}
