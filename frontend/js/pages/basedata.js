// 基础数据：部门 / 人员 / 分类 / 供应商（仅管理员）
import { api } from '../api.js';
import { invalidateDict, loadDict, store } from '../store.js';
import { escapeHtml } from '../router.js';
import {
  confirmDialog, field, openModal, options, renderTable, svgIcon, toast, formData,
} from '../ui.js';

let state = { tab: 'dept' };

export default async function basedata(container) {
  if (!store.isAdmin) {
    container.innerHTML = `<div class="empty-state" style="padding:80px 0">
      <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <p>基础数据管理仅限管理员访问</p></div>`;
    return {};
  }
  await loadDict();

  container.innerHTML = `
    <div class="tabs">
      <button class="tab ${state.tab === 'dept' ? 'active' : ''}" data-tab="dept">部门管理</button>
      <button class="tab ${state.tab === 'staff' ? 'active' : ''}" data-tab="staff">人员管理</button>
      <button class="tab ${state.tab === 'cat' ? 'active' : ''}" data-tab="cat">物品分类</button>
      <button class="tab ${state.tab === 'sup' ? 'active' : ''}" data-tab="sup">供应商</button>
    </div>
    <div id="tab-body"></div>`;

  container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    renderTab();
  }));

  const body = container.querySelector('#tab-body');

  async function renderTab() {
    await loadDict(true);
    if (state.tab === 'dept') await renderDept();
    else if (state.tab === 'staff') await renderStaff();
    else if (state.tab === 'cat') await renderCat();
    else await renderSup();
  }

  /* ============ 部门 ============ */
  async function renderDept() {
    const rows = await api.get('/departments');
    body.innerHTML = `
      <div class="toolbar"><div class="spacer"></div>
        <button class="btn btn-sm btn-primary" id="add">${svgIcon('plus', 15)} 新增部门</button></div>
      <div class="card"><div class="card-body tight" id="t"></div></div>`;
    body.querySelector('#t').innerHTML = renderTable({
      columns: [
        { key: 'id', title: 'ID', width: '64px', render: (r) => `<span class="mono muted">${r.id}</span>` },
        { key: 'name', title: '部门名称', render: (r) => `<b>${escapeHtml(r.name)}</b>` },
        { key: 'manager', title: '负责人', render: (r) => escapeHtml(r.manager || '-') },
        { key: 'staff_count', title: '人数', align: 'right', render: (r) => `${r.staff_count} 人` },
        { key: 'remark', title: '备注', render: (r) => `<span class="muted">${escapeHtml(r.remark || '-')}</span>` },
        { key: 'act', title: '操作', align: 'right', render: (r) => `
          <button class="btn btn-sm" data-edit="${r.id}">编辑</button>
          <button class="btn btn-sm" data-del="${r.id}" data-name="${escapeHtml(r.name)}" style="color:var(--danger)">删除</button>` },
      ], rows, empty: '暂无部门',
    });
    bindDeptActions(rows);
    body.querySelector('#add').onclick = () => deptForm(null, renderTab);
  }

  async function bindDeptActions(rows) {
    body.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => deptForm(rows.find((x) => x.id === Number(b.dataset.edit)), renderTab));
    body.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const ok = await confirmDialog('删除部门', `确定删除「${b.dataset.name}」吗？部门下有人员时无法删除。`, { danger: true, okText: '删除' });
      if (!ok) return;
      try { await api.del('/departments/' + b.dataset.del); toast('已删除', 'success'); invalidateDict(); renderTab(); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  /* ============ 人员 ============ */
  async function renderStaff() {
    const rows = await api.get('/staff');
    const depts = store.dict.departments;
    body.innerHTML = `
      <div class="toolbar">
        <input class="input-sm input-search" id="s-kw" placeholder="搜索姓名 / 工号 / 电话">
        <div class="spacer"></div>
        <button class="btn btn-sm btn-primary" id="add">${svgIcon('plus', 15)} 新增人员</button></div>
      <div class="card"><div class="card-body tight" id="t"></div></div>`;
    const draw = (list) => {
      body.querySelector('#t').innerHTML = renderTable({
        columns: [
          { key: 'name', title: '姓名', render: (r) => `<b>${escapeHtml(r.name)}</b>` },
          { key: 'job_no', title: '工号', render: (r) => `<span class="mono muted">${escapeHtml(r.job_no || '-')}</span>` },
          { key: 'department_name', title: '所属部门', render: (r) => escapeHtml(r.department_name || '-') },
          { key: 'phone', title: '联系电话', render: (r) => `<span class="mono">${escapeHtml(r.phone || '-')}</span>` },
          { key: 'email', title: '邮箱', render: (r) => `<span class="muted">${escapeHtml(r.email || '-')}</span>` },
          { key: 'status', title: '状态', render: (r) => r.status === 'active' ? '<span class="badge success">在职</span>' : '<span class="badge gray">离职</span>' },
          { key: 'act', title: '操作', align: 'right', render: (r) => `
            <button class="btn btn-sm" data-edit="${r.id}">编辑</button>
            <button class="btn btn-sm" data-del="${r.id}" data-name="${escapeHtml(r.name)}" style="color:var(--danger)">删除</button>` },
        ], rows: list, empty: '暂无人员',
      });
      body.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => staffForm(list.find((x) => x.id === Number(b.dataset.edit)), renderTab));
      body.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        const ok = await confirmDialog('删除人员', `确定删除「${b.dataset.name}」吗？`, { danger: true, okText: '删除' });
        if (!ok) return;
        try { await api.del('/staff/' + b.dataset.del); toast('已删除', 'success'); invalidateDict(); renderTab(); }
        catch (e) { toast(e.message, 'error'); }
      });
    };
    draw(rows);
    body.querySelector('#s-kw').oninput = (e) => {
      const k = e.target.value.trim();
      draw(rows.filter((r) => !k || (r.name + (r.job_no || '') + (r.phone || '')).includes(k)));
    };
    body.querySelector('#add').onclick = () => staffForm(null, renderTab);
  }

  /* ============ 分类 ============ */
  async function renderCat() {
    const rows = await api.get('/categories');
    body.innerHTML = `
      <div class="toolbar"><div class="spacer"></div>
        <button class="btn btn-sm btn-primary" id="add">${svgIcon('plus', 15)} 新增分类</button></div>
      <div class="card"><div class="card-body tight" id="t"></div></div>`;
    body.querySelector('#t').innerHTML = renderTable({
      columns: [
        { key: 'id', title: 'ID', width: '64px', render: (r) => `<span class="mono muted">${r.id}</span>` },
        { key: 'name', title: '分类名称', render: (r) => `<b>${escapeHtml(r.name)}</b>` },
        { key: 'sort_order', title: '排序', align: 'right', render: (r) => r.sort_order },
        { key: 'act', title: '操作', align: 'right', render: (r) => `
          <button class="btn btn-sm" data-edit="${r.id}">编辑</button>
          <button class="btn btn-sm" data-del="${r.id}" data-name="${escapeHtml(r.name)}" style="color:var(--danger)">删除</button>` },
      ], rows, empty: '暂无分类',
    });
    body.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => catForm(rows.find((x) => x.id === Number(b.dataset.edit)), renderTab));
    body.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const ok = await confirmDialog('删除分类', `确定删除分类「${b.dataset.name}」吗？该分类下有物品时无法删除。`, { danger: true, okText: '删除' });
      if (!ok) return;
      try { await api.del('/categories/' + b.dataset.del); toast('已删除', 'success'); invalidateDict(); renderTab(); }
      catch (e) { toast(e.message, 'error'); }
    });
    body.querySelector('#add').onclick = () => catForm(null, renderTab);
  }

  /* ============ 供应商 ============ */
  async function renderSup() {
    const rows = await api.get('/suppliers');
    body.innerHTML = `
      <div class="toolbar"><div class="spacer"></div>
        <button class="btn btn-sm btn-primary" id="add">${svgIcon('plus', 15)} 新增供应商</button></div>
      <div class="card"><div class="card-body tight" id="t"></div></div>`;
    body.querySelector('#t').innerHTML = renderTable({
      columns: [
        { key: 'name', title: '供应商名称', render: (r) => `<b>${escapeHtml(r.name)}</b>` },
        { key: 'contact', title: '联系人', render: (r) => escapeHtml(r.contact || '-') },
        { key: 'phone', title: '联系电话', render: (r) => `<span class="mono">${escapeHtml(r.phone || '-')}</span>` },
        { key: 'address', title: '地址', render: (r) => `<span class="muted">${escapeHtml(r.address || '-')}</span>` },
        { key: 'act', title: '操作', align: 'right', render: (r) => `
          <button class="btn btn-sm" data-edit="${r.id}">编辑</button>
          <button class="btn btn-sm" data-del="${r.id}" data-name="${escapeHtml(r.name)}" style="color:var(--danger)">删除</button>` },
      ], rows, empty: '暂无供应商',
    });
    body.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => supForm(rows.find((x) => x.id === Number(b.dataset.edit)), renderTab));
    body.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const ok = await confirmDialog('删除供应商', `确定删除「${b.dataset.name}」吗？`, { danger: true, okText: '删除' });
      if (!ok) return;
      try { await api.del('/suppliers/' + b.dataset.del); toast('已删除', 'success'); invalidateDict(); renderTab(); }
      catch (e) { toast(e.message, 'error'); }
    });
    body.querySelector('#add').onclick = () => supForm(null, renderTab);
  }

  await renderTab();
  return {};
}

/* ============ 表单 ============ */
function deptForm(d, reload) {
  simpleForm({
    title: d ? '编辑部门' : '新增部门', d, reload,
    fields: [
      ['name', '部门名称', `<input name="name" value="${escapeHtml(d?.name || '')}" required>`, true],
      ['manager', '负责人', `<input name="manager" value="${escapeHtml(d?.manager || '')}">`],
      ['remark', '备注', `<input name="remark" value="${escapeHtml(d?.remark || '')}">`],
    ],
    api: '/departments', id: d?.id,
  });
}

function staffForm(s, reload) {
  const depts = store.dict.departments;
  simpleForm({
    title: s ? '编辑人员' : '新增人员', d: s, reload,
    fields: [
      ['name', '姓名', `<input name="name" value="${escapeHtml(s?.name || '')}" required>`, true],
      ['department_id', '所属部门', `<select name="department_id">${options(depts, { selected: s?.department_id, placeholder: '请选择部门' })}</select>`],
      ['job_no', '工号', `<input name="job_no" value="${escapeHtml(s?.job_no || '')}">`],
      ['phone', '联系电话', `<input name="phone" value="${escapeHtml(s?.phone || '')}">`],
      ['email', '邮箱', `<input name="email" value="${escapeHtml(s?.email || '')}">`],
      ['status', '状态', `<select name="status"><option value="active"${s?.status !== 'inactive' ? ' selected' : ''}>在职</option><option value="inactive"${s?.status === 'inactive' ? ' selected' : ''}>离职</option></select>`],
    ],
    api: '/staff', id: s?.id,
  });
}

function catForm(c, reload) {
  simpleForm({
    title: c ? '编辑分类' : '新增分类', d: c, reload,
    fields: [
      ['name', '分类名称', `<input name="name" value="${escapeHtml(c?.name || '')}" required>`, true],
      ['sort_order', '排序值', `<input type="number" name="sort_order" value="${c?.sort_order || 0}">`],
    ],
    api: '/categories', id: c?.id,
  });
}

function supForm(s, reload) {
  simpleForm({
    title: s ? '编辑供应商' : '新增供应商', d: s, reload,
    fields: [
      ['name', '供应商名称', `<input name="name" value="${escapeHtml(s?.name || '')}" required>`, true],
      ['contact', '联系人', `<input name="contact" value="${escapeHtml(s?.contact || '')}">`],
      ['phone', '联系电话', `<input name="phone" value="${escapeHtml(s?.phone || '')}">`],
      ['address', '地址', `<input name="address" value="${escapeHtml(s?.address || '')}">`],
    ],
    api: '/suppliers', id: s?.id,
  });
}

function simpleForm({ title, fields, api: endpoint, id, reload }) {
  const body = document.createElement('div');
  body.innerHTML = `<form class="form-grid" id="bd-form">${
    fields.map(([name, label, input, req]) => field(label, input, { required: !!req, span: 2 })).join('')
  }</form>`;
  const footer = document.createElement('div');
  footer.className = 'btn-row';
  footer.innerHTML = `<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存</button>`;

  openModal({
    title, body, footer,
    onMount(el, close) {
      footer.querySelector('[data-act=cancel]').onclick = close;
      footer.querySelector('[data-act=save]').onclick = async () => {
        const form = el.querySelector('#bd-form');
        if (!form.reportValidity()) return;
        const data = formData(form);
        try {
          if (id) await api.put(`${endpoint}/${id}`, data);
          else await api.post(endpoint, data);
          toast('已保存', 'success');
          invalidateDict();
          close(); reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}
