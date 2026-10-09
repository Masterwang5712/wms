// 物品档案：CRUD + 搜索 + 类型/分类筛选
import { api } from '../api.js';
import { invalidateDict, loadDict, loadItemOptions, store } from '../store.js';
import { escapeHtml } from '../router.js';
import {
  badge, bindRowClick, confirmDialog, field, fmtMoney, openModal, openDrawer,
  options, renderPagination, renderTable, svgIcon, toast, formData,
} from '../ui.js';

let state = { page: 1, size: 20, keyword: '', item_type: '', category_id: '', low_stock: false };

export default async function items(container) {
  await loadDict();
  container.innerHTML = `
    <div class="toolbar">
      <div class="input-group" style="position:relative">
        <input class="input-sm input-search" id="f-keyword" placeholder="搜索名称 / 编码 / 规格 / 品牌" value="${escapeHtml(state.keyword)}">
      </div>
      <select class="select-sm" id="f-type">
        <option value="">全部类型</option>
        <option value="consumable">耗材</option>
        <option value="device">设备</option>
      </select>
      <select class="select-sm" id="f-cat">
        <option value="">全部分类</option>
        ${store.dict.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <label class="btn btn-sm" style="gap:6px">
        <input type="checkbox" id="f-low" ${state.low_stock ? 'checked' : ''}> 仅看低库存
      </label>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="btn-export">${svgIcon('download', 15)} 导出</button>
      <button class="btn btn-sm btn-primary" id="btn-new" ${store.canManage ? '' : 'disabled'}>${svgIcon('plus', 15)} 新增物品</button>
    </div>
    <div class="card"><div class="card-body tight" id="table-area"></div></div>
  `;

  const typeEl = container.querySelector('#f-type');
  const catEl = container.querySelector('#f-cat');
  typeEl.value = state.item_type;
  catEl.value = state.category_id;

  container.querySelector('#f-keyword').addEventListener('input', debounce((e) => {
    state.keyword = e.target.value.trim(); state.page = 1; load();
  }, 320));
  typeEl.addEventListener('change', () => { state.item_type = typeEl.value; state.page = 1; load(); });
  catEl.addEventListener('change', () => { state.category_id = catEl.value; state.page = 1; load(); });
  container.querySelector('#f-low').addEventListener('change', (e) => {
    state.low_stock = e.target.checked; state.page = 1; load();
  });
  container.querySelector('#btn-new').addEventListener('click', () => openForm(null, load));
  container.querySelector('#btn-export').addEventListener('click', () => exportExcel());

  async function load() {
    const area = container.querySelector('#table-area');
    area.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
    const res = await api.get('/items', {
      page: state.page, size: state.size, keyword: state.keyword,
      item_type: state.item_type, category_id: state.category_id,
      low_stock: state.low_stock ? 'true' : '',
    });
    if (!res.total) {
      area.innerHTML = renderTable({ columns: [], rows: [] });
      return;
    }
    const cols = [
      { key: 'code', title: '编码', width: '110px', render: (r) => `<span class="mono">${escapeHtml(r.code)}</span>` },
      { key: 'name', title: '名称', render: (r) => `<b>${escapeHtml(r.name)}</b>` },
      { key: 'spec', title: '规格', render: (r) => `<span class="muted">${escapeHtml(r.spec || '-')}</span>` },
      { key: 'category_name', title: '分类', render: (r) => badge(r.category_name || '未分类', 'gray') },
      { key: 'item_type', title: '类型', render: (r) => r.item_type === 'consumable' ? badge('耗材', 'primary') : badge('设备', 'info') },
      { key: 'unit', title: '单位', render: (r) => escapeHtml(r.unit || '-') },
      { key: 'current_stock', title: '当前库存', align: 'right', render: (r) => `<b class="mono">${r.current_stock}</b>` },
      { key: 'safety_stock', title: '安全库存', align: 'right', render: (r) => `<span class="mono text-muted">${r.safety_stock}</span>` },
      { key: 'stock_value', title: '库存货值', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.stock_value)}</span>` },
      { key: 'st', title: '状态', render: (r) => r.is_out ? badge('缺货', 'danger') : r.is_low ? badge('低库存', 'warning') : badge('正常', 'success') },
      { key: 'act', title: '操作', align: 'right', render: (r) => store.canManage
        ? `<button class="btn btn-sm" data-act="edit" data-id="${r.id}">编辑</button>
           <button class="btn btn-sm" data-act="del" data-id="${r.id}" data-name="${escapeHtml(r.name)}" style="color:var(--danger)">删除</button>`
        : '<span class="text-muted">—</span>' },
    ];
    area.innerHTML = renderTable({
      columns: cols, rows: res.items, empty: '没有符合条件的物品',
      rowClass: (r) => (r.is_out ? 'row-danger' : r.is_low ? 'row-warning' : ''),
    });
    area.appendChild(renderPagination(res, (p) => { state.page = p; load(); }));

    bindRowClick(area, res.items, (r) => openDetail(r));
    area.querySelectorAll('[data-act=edit]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      openForm(res.items.find((x) => x.id === Number(b.dataset.id)), load);
    }));
    area.querySelectorAll('[data-act=del]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog('删除物品', `确定删除「${b.dataset.name}」吗？删除后不可恢复（有库存或流水的物品无法删除）。`, { danger: true, okText: '删除' });
      if (!ok) return;
      try {
        await api.del('/items/' + b.dataset.id);
        toast('已删除', 'success');
        invalidateDict(); await loadItemOptions(true);
        load();
      } catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  await load();
  return {};
}

/* ============ 新增/编辑 ============ */
async function openForm(item, reload) {
  await loadDict();
  const isEdit = !!item;
  const d = item || { item_type: 'consumable', safety_stock: 0, unit_price: 0, init_stock: 0 };

  const body = document.createElement('div');
  body.innerHTML = `<form class="form-grid" id="item-form">
    ${field('物品编码', `<input name="code" value="${escapeHtml(d.code || '')}" placeholder="留空自动生成（耗材 HC / 设备 SB）">`)}
    ${field('物品名称', `<input name="name" value="${escapeHtml(d.name || '')}" required>`, { required: true })}
    ${field('物品类型', `<select name="item_type">
        <option value="consumable"${d.item_type === 'consumable' ? ' selected' : ''}>耗材</option>
        <option value="device"${d.item_type === 'device' ? ' selected' : ''}>设备</option>
      </select>`, { required: true })}
    ${field('分类', `<select name="category_id">${options(store.dict.categories, { selected: d.category_id, placeholder: '请选择分类' })}</select>`)}
    ${field('规格型号', `<input name="spec" value="${escapeHtml(d.spec || '')}">`)}
    ${field('单位', `<input name="unit" value="${escapeHtml(d.unit || '')}" placeholder="个 / 盒 / 台 / 瓶">`)}
    ${field('品牌', `<input name="brand" value="${escapeHtml(d.brand || '')}">`)}
    ${field('存放位置', `<input name="location" value="${escapeHtml(d.location || '')}" placeholder="如 A-01-01">`)}
    ${field('参考单价（元）', `<input type="number" step="0.01" min="0" name="unit_price" value="${d.unit_price || 0}">`)}
    ${field('安全库存', `<input type="number" min="0" name="safety_stock" value="${d.safety_stock || 0}" ${isEdit ? '' : ''}>`)}
    ${field('供应商', `<select name="supplier_id">${options(store.dict.suppliers, { selected: d.supplier_id, placeholder: '请选择供应商' })}</select>`)}
    ${isEdit ? '' : field('期初库存', `<input type="number" min="0" name="init_stock" value="0">`, { hint: '仅新建时生效，会写入一条期初入库流水' })}
    ${field('备注', `<textarea name="remark" rows="2">${escapeHtml(d.remark || '')}</textarea>`, { span: 2 })}
  </form>`;

  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存</button>`;

  openModal({
    title: isEdit ? '编辑物品' : '新增物品',
    body, footer,
    onMount(el, close) {
      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=save]').onclick = async () => {
        const form = el.querySelector('#item-form');
        if (!form.reportValidity()) return;
        const data = formData(form);
        try {
          if (isEdit) await api.put('/items/' + item.id, data);
          else await api.post('/items', data);
          toast(isEdit ? '已保存' : '新增成功', 'success');
          invalidateDict(); await loadItemOptions(true);
          close(); reload();
        } catch (ex) { toast(ex.message, 'error'); }
      };
    },
  });
}

/* ============ 详情抽屉 ============ */
async function openDetail(item) {
  const txns = await api.get(`/items/${item.id}/txns`, { limit: 60 });
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="desc-list" style="margin-bottom:20px">
      <div class="desc-item"><div class="desc-label">物品编码</div><div class="desc-value mono">${escapeHtml(item.code)}</div></div>
      <div class="desc-item"><div class="desc-label">物品名称</div><div class="desc-value"><b>${escapeHtml(item.name)}</b></div></div>
      <div class="desc-item"><div class="desc-label">分类</div><div class="desc-value">${escapeHtml(item.category_name || '未分类')}</div></div>
      <div class="desc-item"><div class="desc-label">规格</div><div class="desc-value">${escapeHtml(item.spec || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">品牌 / 单位</div><div class="desc-value">${escapeHtml(item.brand || '-')} / ${escapeHtml(item.unit || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">存放位置</div><div class="desc-value">${escapeHtml(item.location || '-')}</div></div>
      <div class="desc-item"><div class="desc-label">当前库存</div><div class="desc-value mono"><b style="font-size:17px">${item.current_stock}</b> ${escapeHtml(item.unit || '')}</div></div>
      <div class="desc-item"><div class="desc-label">安全库存</div><div class="desc-value mono">${item.safety_stock}</div></div>
      <div class="desc-item"><div class="desc-label">参考单价</div><div class="desc-value mono">${fmtMoney(item.unit_price)}</div></div>
      <div class="desc-item"><div class="desc-label">库存货值</div><div class="desc-value mono">${fmtMoney(item.current_stock * item.unit_price)}</div></div>
      <div class="desc-item full"><div class="desc-label">备注</div><div class="desc-value">${escapeHtml(item.remark || '-')}</div></div>
    </div>
    <div class="section-title" style="font-size:13.5px">出入库流水（最近 ${txns.length} 条）</div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>时间</th><th>类型</th><th style="text-align:right">数量</th><th style="text-align:right">结存</th><th>操作人</th></tr></thead>
      <tbody>${txns.length ? txns.map((t) => `<tr>
        <td class="muted nowrap">${String(t.created_at).slice(0, 16)}</td>
        <td>${t.txn_type === 'in' ? badge('入库', 'danger') : t.txn_type === 'out' ? badge('出库', 'success') : badge('盘点', 'warning')}</td>
        <td class="num">${t.txn_type === 'in' ? '+' : t.txn_type === 'out' ? '-' : ''}${t.quantity}</td>
        <td class="num">${t.after_qty}</td>
        <td class="muted">${escapeHtml(t.operator_name || '-')}</td></tr>`).join('')
        : '<tr class="empty-row"><td colspan="5">暂无流水记录</td></tr>'}</tbody>
    </table></div>`;
  openDrawer({ title: '物品详情', body, width: '600px' });
}

async function exportExcel() {
  const { downloadFile } = await import('../api.js');
  try { await downloadFile('/export/items.xlsx'); toast('导出成功', 'success'); }
  catch (e) { toast(e.message, 'error'); }
}

function debounce(fn, wait) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}
