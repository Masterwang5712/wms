// 数据看板：KPI 卡 + 出入库趋势 + 分类占比 + 消耗排行 + 提醒面板
import { api } from '../api.js';
import { refreshAlerts, store } from '../store.js';
import { navigate } from '../router.js';
import { fmtMoney, fmtNum, fmtDaysLeft, svgIcon, badge } from '../ui.js';
import { barList, donutChart, lineChart } from '../charts.js';

export default async function dashboard(container) {
  const [ov, trend, catShare, top] = await Promise.all([
    api.get('/reports/overview'),
    api.get('/reports/trend', { days: 30 }),
    api.get('/reports/category-share'),
    api.get('/reports/consumption-top', { limit: 6 }),
  ]);
  await refreshAlerts();
  const al = store.alerts;

  const upColor = getComputedStyle(document.body).getPropertyValue('--up').trim() || '#e53935';
  const downColor = getComputedStyle(document.body).getPropertyValue('--down').trim() || '#43a047';

  container.innerHTML = `
    <div class="print-header">
      <h1>仓库数据看板</h1>
      <p>生成时间：${ov.today}</p>
    </div>

    <div class="grid grid-kpi" style="margin-bottom:18px">
      ${kpi('库存总货值', fmtMoney(ov.stock_value), 'money', 'primary',
            `共 ${fmtNum(ov.item_kinds)} 种耗材物料`)}
      ${kpi('本月入库金额', fmtMoney(ov.month_in_amount), 'inbox', 'info',
            `本月出库 ${fmtMoney(ov.month_out_amount)}`)}
      ${kpi('设备总数', fmtNum(ov.device_total), 'monitor', 'primary',
            `在用/借出 ${ov.device_in_use} 台 · 借出中 ${ov.device_borrowed} 台`)}
      ${kpi('低库存预警', fmtNum(ov.low_stock_count), 'warn',
            ov.low_stock_count ? 'danger' : 'success',
            ov.out_of_stock_count ? `其中缺货 ${ov.out_of_stock_count} 种` : '库存水位正常')}
      ${kpi('校准待处理', fmtNum(ov.calibration_expired + ov.calibration_expiring), 'clock',
            (ov.calibration_expired) ? 'danger' : 'warning',
            `已过期 ${ov.calibration_expired} · 临期 ${ov.calibration_expiring}`)}
      ${kpi('设备逾期未还', fmtNum(ov.overdue_borrow_count), 'transfer',
            ov.overdue_borrow_count ? 'danger' : 'success',
            ov.overdue_borrow_count ? '需及时催还' : '无逾期记录')}
    </div>

    <div class="grid grid-2-1" style="margin-bottom:18px">
      <div class="card">
        <div class="card-head">
          <h3>${svgIcon('chart')}近 30 天出入库趋势</h3>
          <div class="chart-legend">
            <span class="lg-item"><span class="lg-swatch" style="background:${upColor}"></span>入库数量</span>
            <span class="lg-item"><span class="lg-swatch" style="background:${downColor}"></span>出库数量</span>
          </div>
        </div>
        <div class="card-body"><div class="chart-box" id="trend-chart"></div></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${svgIcon('warn')}待处理提醒</h3>
          <button class="btn btn-sm btn-ghost" id="refresh-alerts">刷新</button></div>
        <div class="card-body" id="alert-panel" style="max-height:330px;overflow-y:auto"></div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h3>${svgIcon('box')}库存货值分类占比</h3></div>
        <div class="card-body"><div id="donut"></div></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${svgIcon('cart')}耗材消耗排行（累计）</h3>
          <button class="btn btn-sm btn-ghost" data-go="/consumables">查看详情</button></div>
        <div class="card-body"><div id="top-list"></div></div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><h3>${svgIcon('monitor')}设备状态分布</h3>
        <button class="btn btn-sm btn-ghost" data-go="/devices">设备台账</button></div>
      <div class="card-body" id="device-dist"></div>
    </div>
  `;

  // 趋势图
  const trendEl = container.querySelector('#trend-chart');
  const draw = () => lineChart(trendEl, {
    labels: trend.map((x) => x.date),
    series: [
      { name: '入库数量', color: upColor, data: trend.map((x) => x.in_qty) },
      { name: '出库数量', color: downColor, data: trend.map((x) => x.out_qty) },
    ],
    height: 250,
  });
  draw();
  const onResize = () => draw();
  window.addEventListener('resize', onResize);

  // 分类占比
  donutChart(container.querySelector('#donut'), {
    items: catShare.map((c) => ({ name: c.name, value: c.value })),
    valueFmt: fmtMoney,
  });

  // 消耗排行
  barList(container.querySelector('#top-list'), {
    items: top.map((t) => ({ name: t.name, value: t.total_qty })),
    valueFmt: (v) => fmtNum(v) + ' 件',
  });

  // 提醒面板
  container.querySelector('#alert-panel').innerHTML = renderAlerts(al);
  container.querySelector('#refresh-alerts').addEventListener('click', async () => {
    const btn = container.querySelector('#refresh-alerts');
    btn.disabled = true; btn.textContent = '刷新中…';
    await refreshAlerts();
    container.querySelector('#alert-panel').innerHTML = renderAlerts(store.alerts);
    window.dispatchEvent(new CustomEvent('wms:refresh-alerts'));
    btn.disabled = false; btn.textContent = '刷新';
  });

  // 设备分布
  const ds = await api.get('/reports/device-summary');
  const total = ds.total || 1;
  container.querySelector('#device-dist').innerHTML = `<div class="grid grid-4">${
    ds.rows.map((r) => `<div class="stat-mini">
      <span class="l">${r.label}</span>
      <span class="v">${fmtNum(r.cnt)} <span style="font-size:12px;font-weight:400;color:var(--text-3)">台</span></span>
      <div class="bar"><i style="width:${(100 * r.cnt) / total}%;background:var(--primary)"></i></div>
      <span class="l">${fmtMoney(r.value)}</span>
    </div>`).join('')
  }</div>`;

  const goBtns = container.querySelectorAll('[data-go]');
  goBtns.forEach((b) => b.addEventListener('click', () => navigate(b.dataset.go)));

  window.dispatchEvent(new CustomEvent('wms:refresh-alerts'));

  return { cleanup: () => window.removeEventListener('resize', onResize) };
}

function kpi(label, value, icon, tone, foot) {
  return `<div class="kpi">
    <div class="kpi-top">
      <span class="kpi-label">${label}</span>
      <span class="kpi-icon ${tone === 'primary' ? '' : tone}">${svgIcon(icon, 17)}</span>
    </div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-foot">${foot}</div>
  </div>`;
}

function renderAlerts(al) {
  const blocks = [];
  const low = al.lowStock || [];
  const cal = al.calibration;
  const bor = al.overdueBorrow || [];

  if (!low.length && (!cal || (!cal.expired.length && !cal.expiring.length)) && !bor.length) {
    return `<div class="empty-state" style="padding:34px 0">
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <p>暂无待处理事项，一切正常</p></div>`;
  }

  if (low.length) {
    blocks.push(`<div style="margin-bottom:14px">
      <div class="section-title" style="font-size:13px;margin-bottom:9px">低库存 / 缺货（${low.length}）</div>
      ${low.slice(0, 5).map((x) => `<div class="alert-chip ${x.level === 'danger' ? 'danger' : 'warning'}" style="margin-bottom:5px;cursor:pointer" data-go="/stock">
        <span>${esc(x.name)}${x.spec ? ' · ' + esc(x.spec) : ''}</span>
        <b class="mono">${x.current_stock} / ${x.safety_stock}</b></div>`).join('')}
      ${low.length > 5 ? `<p class="text-muted" style="font-size:11.5px;padding-left:4px">还有 ${low.length - 5} 项…</p>` : ''}
    </div>`);
  }

  if (cal && (cal.expired.length || cal.expiring.length)) {
    const rows = [...cal.expired.map((x) => ({ ...x, tone: 'danger' })), ...cal.expiring.map((x) => ({ ...x, tone: 'warning' }))];
    blocks.push(`<div style="margin-bottom:14px">
      <div class="section-title" style="font-size:13px;margin-bottom:9px">设备校准待处理（${rows.length}）</div>
      ${rows.slice(0, 5).map((x) => `<div class="alert-chip ${x.tone}" style="margin-bottom:5px;cursor:pointer" data-go="/calibration">
        <span>${esc(x.asset_no)} ${esc(x.name)}</span>
        <b>${fmtDaysLeft(x.next_calibration_date)}</b></div>`).join('')}
      ${rows.length > 5 ? `<p class="text-muted" style="font-size:11.5px;padding-left:4px">还有 ${rows.length - 5} 项…</p>` : ''}
    </div>`);
  }

  if (bor.length) {
    blocks.push(`<div>
      <div class="section-title" style="font-size:13px;margin-bottom:9px">设备逾期未还（${bor.length}）</div>
      ${bor.slice(0, 5).map((x) => `<div class="alert-chip danger" style="margin-bottom:5px;cursor:pointer" data-go="/borrows">
        <span>${esc(x.asset_no)} ${esc(x.device_name)} · ${esc(x.borrower_name || '')}</span>
        <b>逾期 ${x.overdue_days} 天</b></div>`).join('')}
      ${bor.length > 5 ? `<p class="text-muted" style="font-size:11.5px;padding-left:4px">还有 ${bor.length - 5} 项…</p>` : ''}
    </div>`);
  }

  return blocks.join('');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
