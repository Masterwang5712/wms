// 统计报表：月度报表 + 库存总览 + 多 sheet 导出 + 打印
import { api } from '../api.js';
import { loadDict } from '../store.js';
import { escapeHtml } from '../router.js';
import { fmtMoney, fmtNum, renderTable, svgIcon, toast } from '../ui.js';
import { donutChart } from '../charts.js';

export default async function reports(container) {
  await loadDict();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  container.innerHTML = `
    <div class="toolbar no-print">
      <label class="btn btn-sm" style="gap:8px">年份
        <input type="number" id="f-year" value="${y}" min="2020" max="2100" style="width:74px;border:none;background:transparent;font-family:inherit;font-size:13px">
      </label>
      <select class="select-sm" id="f-month">
        ${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${i + 1 === m ? ' selected' : ''}>${i + 1} 月</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-primary" id="btn-load">查询</button>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="btn-print">${svgIcon('print', 15)} 打印</button>
      <button class="btn btn-sm btn-primary" id="btn-export">${svgIcon('download', 15)} 导出月度报表</button>
    </div>
    <div id="report-body"></div>`;

  const body = container.querySelector('#report-body');

  async function load() {
    const year = Number(container.querySelector('#f-year').value);
    const month = Number(container.querySelector('#f-month').value);
    body.innerHTML = '<div class="loading"><div class="spinner"></div>生成报表中…</div>';

    const [data, catShare, devSum] = await Promise.all([
      api.get('/reports/monthly', { year, month }),
      api.get('/reports/category-share'),
      api.get('/reports/device-summary'),
    ]);
    const s = data.summary;

    body.innerHTML = `
      <div class="print-header">
        <h1>仓库月度报表 · ${data.year} 年 ${data.month} 月</h1>
        <p>统计区间：${data.start} 至 ${data.end}　|　生成时间：${new Date().toLocaleString('zh-CN')}</p>
      </div>

      <div class="grid grid-kpi" style="margin-bottom:18px">
        ${kpiMini('入库单数量', s.inbound_count + ' 张', fmtMoney(s.inbound_amount), 'inbox', 'info')}
        ${kpiMini('出库单数量', s.outbound_count + ' 张', fmtMoney(s.outbound_amount), 'outbox', 'warning')}
        ${kpiMini('耗材领用数量', fmtNum(s.issue_qty) + ' 件', '本月领用合计', 'cart', 'primary')}
        ${kpiMini('维保 / 校准费用', fmtMoney(s.maintenance_cost + s.calibration_cost),
                  `维保 ${fmtMoney(s.maintenance_cost)} · 校准 ${fmtMoney(s.calibration_cost)}`, 'wrench', 'danger')}
      </div>

      <div class="grid grid-2" style="margin-bottom:18px">
        <div class="card"><div class="card-head"><h3>${svgIcon('box')}库存货值分类占比</h3></div>
          <div class="card-body"><div id="cat-donut"></div></div></div>
        <div class="card"><div class="card-head"><h3>${svgIcon('monitor')}设备状态分布</h3></div>
          <div class="card-body">
            <div class="grid grid-3" style="gap:14px">${devSum.rows.map((r) => `
              <div class="stat-mini"><span class="l">${r.label}</span>
                <span class="v">${fmtNum(r.cnt)} <span style="font-size:12px;font-weight:400">台</span></span>
                <span class="l">${fmtMoney(r.value)}</span></div>`).join('')}</div>
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-2);display:flex;justify-content:space-between;font-size:13px">
              <span class="text-muted">设备总数 / 总价值</span>
              <span><b>${devSum.total} 台</b> · <b class="mono">${fmtMoney(devSum.total_value)}</b></span>
            </div>
          </div></div>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><h3>${svgIcon('chart')}部门消耗统计</h3><span class="sub">${data.start} ~ ${data.end}</span></div>
        <div class="card-body tight" id="dept-table"></div>
      </div>

      <div class="grid grid-2" style="margin-bottom:18px">
        <div class="card"><div class="card-head"><h3>${svgIcon('inbox')}本期入库单（${data.inbound.length}）</h3></div>
          <div class="card-body tight" id="in-table"></div></div>
        <div class="card"><div class="card-head"><h3>${svgIcon('outbox')}本期出库单（${data.outbound.length}）</h3></div>
          <div class="card-body tight" id="out-table"></div></div>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><h3>${svgIcon('cart')}物品消耗明细（Top 30）</h3></div>
        <div class="card-body tight" id="item-table"></div>
      </div>

      <div class="grid grid-2">
        <div class="card"><div class="card-head"><h3>${svgIcon('wrench')}本期维保记录（${data.maintenance.length}）</h3></div>
          <div class="card-body tight" id="mt-table"></div></div>
        <div class="card"><div class="card-head"><h3>${svgIcon('clock')}本期校准记录（${data.calibration.length}）</h3></div>
          <div class="card-body tight" id="cal-table"></div></div>
      </div>`;

    donutChart(body.querySelector('#cat-donut'), {
      items: catShare.map((c) => ({ name: c.name, value: c.value })), valueFmt: fmtMoney,
    });

    body.querySelector('#dept-table').innerHTML = renderTable({
      columns: [
        { key: 'name', title: '部门', render: (r) => `<b>${escapeHtml(r.name)}</b>` },
        { key: 'cnt', title: '领用次数', align: 'right', render: (r) => fmtNum(r.cnt) },
        { key: 'total_qty', title: '领用数量', align: 'right', render: (r) => fmtNum(r.total_qty) },
        { key: 'total_amount', title: '领用金额', align: 'right', render: (r) => `<b class="mono">${fmtMoney(r.total_amount)}</b>` },
      ], rows: data.by_department, empty: '本期无领用记录',
    });

    body.querySelector('#in-table').innerHTML = renderTable({
      columns: [
        { key: 'order_no', title: '入库单号', render: (r) => `<span class="mono" style="font-size:12px">${escapeHtml(r.order_no)}</span>` },
        { key: 'order_date', title: '日期', render: (r) => `<span class="mono">${r.order_date}</span>` },
        { key: 'supplier_name', title: '供应商', render: (r) => `<span class="muted">${escapeHtml(r.supplier_name || '-')}</span>` },
        { key: 'total_amount', title: '金额', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.total_amount)}</span>` },
      ], rows: data.inbound, empty: '本期无入库单',
    });

    body.querySelector('#out-table').innerHTML = renderTable({
      columns: [
        { key: 'order_no', title: '出库单号', render: (r) => `<span class="mono" style="font-size:12px">${escapeHtml(r.order_no)}</span>` },
        { key: 'order_date', title: '日期', render: (r) => `<span class="mono">${r.order_date}</span>` },
        { key: 'department_name', title: '部门', render: (r) => `<span class="muted">${escapeHtml(r.department_name || '-')}</span>` },
        { key: 'total_amount', title: '金额', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.total_amount)}</span>` },
      ], rows: data.outbound, empty: '本期无出库单',
    });

    body.querySelector('#item-table').innerHTML = renderTable({
      columns: [
        { key: 'name', title: '物品', render: (r) => `<b>${escapeHtml(r.name)}</b>` },
        { key: 'spec', title: '规格', render: (r) => `<span class="muted">${escapeHtml(r.spec || '-')}</span>` },
        { key: 'unit', title: '单位', render: (r) => escapeHtml(r.unit || '-') },
        { key: 'total_qty', title: '领用数量', align: 'right', render: (r) => fmtNum(r.total_qty) },
        { key: 'total_amount', title: '领用金额', align: 'right', render: (r) => `<b class="mono">${fmtMoney(r.total_amount)}</b>` },
      ], rows: data.by_item, empty: '本期无消耗记录',
    });

    body.querySelector('#mt-table').innerHTML = renderTable({
      columns: [
        { key: 'maint_date', title: '日期', render: (r) => `<span class="mono">${r.maint_date}</span>` },
        { key: 'device_name', title: '设备', render: (r) => escapeHtml(r.device_name) },
        { key: 'maint_type', title: '类型', render: (r) => escapeHtml(r.maint_type) },
        { key: 'cost', title: '费用', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.cost)}</span>` },
      ], rows: data.maintenance, empty: '本期无维保记录',
    });

    body.querySelector('#cal-table').innerHTML = renderTable({
      columns: [
        { key: 'calibration_date', title: '日期', render: (r) => `<span class="mono">${r.calibration_date}</span>` },
        { key: 'device_name', title: '设备', render: (r) => escapeHtml(r.device_name) },
        { key: 'result', title: '结论', render: (r) => escapeHtml(r.result) },
        { key: 'cost', title: '费用', align: 'right', render: (r) => `<span class="mono">${fmtMoney(r.cost)}</span>` },
      ], rows: data.calibration, empty: '本期无校准记录',
    });
  }

  container.querySelector('#btn-load').addEventListener('click', load);
  container.querySelector('#btn-export').addEventListener('click', async () => {
    const { downloadFile } = await import('../api.js');
    const year = Number(container.querySelector('#f-year').value);
    const month = Number(container.querySelector('#f-month').value);
    try { await downloadFile('/export/monthly.xlsx', { year, month }, `仓库月度报表_${year}${String(month).padStart(2, '0')}.xlsx`); toast('导出成功', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  });
  container.querySelector('#btn-print').addEventListener('click', () => window.print());

  await load();
  return {};
}

function kpiMini(label, value, foot, icon, tone) {
  return `<div class="kpi"><div class="kpi-top">
      <span class="kpi-label">${label}</span>
      <span class="kpi-icon ${tone === 'primary' ? '' : tone}">${svgIcon(icon, 17)}</span></div>
    <div class="kpi-value sm">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}
