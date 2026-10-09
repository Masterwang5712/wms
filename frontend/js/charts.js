// 手写 SVG 图表：折线（双序列）、柱状、环形、进度条。零依赖。
import { escapeHtml } from './router.js';
import { fmtNum, fmtMoney } from './ui.js';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

/* ================= 折线图（双序列） ================= */
/**
 * lineChart(el, {labels, series:[{name,color,data}], height, yLabel})
 */
export function lineChart(el, { labels, series, height = 240, valueFmt = fmtNum }) {
  const W = el.clientWidth || 720;
  const H = height;
  const pad = { t: 18, r: 18, b: 30, l: 46 };
  const iw = Math.max(10, W - pad.l - pad.r);
  const ih = H - pad.t - pad.b;

  const maxRaw = Math.max(1, ...series.flatMap((s) => s.data.map((v) => Number(v) || 0)));
  const max = niceMax(maxRaw);
  const n = labels.length;

  const xAt = (i) => pad.l + (n <= 1 ? iw / 2 : (iw * i) / (n - 1));
  const yAt = (v) => pad.t + ih - (ih * (Number(v) || 0)) / max;

  const gridColor = cssVar('--border-2', '#eef1f7');
  const textColor = cssVar('--text-3', '#8b95ab');

  let g = '';
  // 横向网格 + Y 轴刻度
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (max * i) / ticks;
    const y = yAt(v);
    g += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="${gridColor}" stroke-width="1"/>`;
    g += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="${textColor}">${fmtShort(v)}</text>`;
  }

  // X 轴标签（抽样显示，避免拥挤）
  const step = Math.max(1, Math.ceil(n / 8));
  labels.forEach((lb, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    g += `<text x="${xAt(i)}" y="${H - 9}" text-anchor="middle" font-size="10.5" fill="${textColor}">${escapeHtml(shortDate(lb))}</text>`;
  });

  // 序列：面积 + 折线 + 数据点
  let paths = '';
  series.forEach((s) => {
    const pts = s.data.map((v, i) => [xAt(i), yAt(v)]);
    if (!pts.length) return;
    const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const area = d + ` L${pts[pts.length - 1][0].toFixed(1)},${pad.t + ih} L${pts[0][0].toFixed(1)},${pad.t + ih} Z`;
    paths += `<path d="${area}" fill="${s.color}" opacity="0.09"/>`;
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    // 只标记少量点
    pts.forEach((p, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      paths += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="${cssVar('--surface', '#fff')}" stroke="${s.color}" stroke-width="2"/>`;
    });
  });

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet"
      style="display:block">
      ${g}${paths}
      <g class="hover-layer"></g>
    </svg>`;

  el.innerHTML = svg;
  // 悬停提示
  attachHover(el, { labels, series, xAt, yAt, W, H, pad, valueFmt });
}

function attachHover(el, ctx) {
  const svg = el.querySelector('svg');
  if (!svg) return;
  const tip = document.createElement('div');
  tip.style.cssText = 'position:absolute;pointer-events:none;background:var(--surface);border:1px solid var(--border);' +
    'border-radius:6px;padding:7px 10px;font-size:12px;box-shadow:var(--shadow-lg);opacity:0;transition:opacity .12s;z-index:5;white-space:nowrap';
  el.style.position = 'relative';
  el.appendChild(tip);
  const vline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  vline.setAttribute('stroke', cssVar('--primary', '#2f6fed'));
  vline.setAttribute('stroke-dasharray', '3 3');
  vline.setAttribute('y1', ctx.pad.t);
  vline.setAttribute('y2', ctx.H - ctx.pad.b);
  vline.style.opacity = '0';
  svg.appendChild(vline);

  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const scale = ctx.W / rect.width;
    const mx = (e.clientX - rect.left) * scale;
    const n = ctx.labels.length;
    if (n === 0) return;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(ctx.xAt(i) - mx);
      if (d < bestD) { bestD = d; best = i; }
    }
    const x = ctx.xAt(best);
    vline.setAttribute('x1', x); vline.setAttribute('x2', x);
    vline.style.opacity = '1';
    const rows = ctx.series.map((s) =>
      `<div style="display:flex;gap:8px;align-items:center"><span style="width:8px;height:8px;border-radius:2px;background:${s.color}"></span><span style="color:var(--text-2)">${escapeHtml(s.name)}</span><b style="margin-left:auto;font-family:var(--mono)">${ctx.valueFmt(s.data[best])}</b></div>`).join('');
    tip.innerHTML = `<div style="font-weight:600;margin-bottom:5px;font-size:11.5px">${escapeHtml(ctx.labels[best])}</div>${rows}`;
    tip.style.opacity = '1';
    const left = (x / scale);
    tip.style.left = Math.min(Math.max(left + 12, 4), rect.width - tip.offsetWidth - 4) + 'px';
    tip.style.top = '8px';
  });
  svg.addEventListener('mouseleave', () => { tip.style.opacity = '0'; vline.style.opacity = '0'; });
}

/* ================= 柱状图（横向排名） ================= */
export function barList(el, { items, valueFmt = fmtNum, color, maxItems = 8 }) {
  if (!items || !items.length) {
    el.innerHTML = '<div class="chart-empty">暂无数据</div>';
    return;
  }
  const c = color || cssVar('--primary', '#2f6fed');
  const list = items.slice(0, maxItems);
  const max = Math.max(...list.map((x) => Number(x.value) || 0), 1);
  el.innerHTML = `<div class="rank-list">${list.map((x, i) => `
    <div class="rank-item">
      <span class="badge ${i < 3 ? 'primary' : 'gray'}" style="min-width:20px;justify-content:center">${i + 1}</span>
      <span class="rank-name" title="${escapeHtml(x.name)}">${escapeHtml(x.name)}</span>
      <span class="rank-bar"><i style="width:${Math.max(2, (100 * (Number(x.value) || 0)) / max)}%;background:${c}"></i></span>
      <span class="rank-val">${valueFmt(x.value)}</span>
    </div>`).join('')}</div>`;
}

/* ================= 环形图（占比） ================= */
export function donutChart(el, { items, size = 190, valueFmt = fmtMoney }) {
  if (!items || !items.length) {
    el.innerHTML = '<div class="chart-empty">暂无数据</div>';
    return;
  }
  const total = items.reduce((s, x) => s + (Number(x.value) || 0), 0) || 1;
  const palette = ['#2f6fed', '#16a34a', '#ef8f2f', '#8b5cf6', '#0ea5e9', '#e53935', '#14b8a6', '#f59e0b', '#6366f1', '#ec4899'];
  const R = size / 2, r = R * 0.62, cx = R, cy = R;
  let a0 = -Math.PI / 2, segs = '';

  items.forEach((it, i) => {
    const frac = (Number(it.value) || 0) / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const xi1 = cx + r * Math.cos(a1), yi1 = cy + r * Math.sin(a1);
    const xi0 = cx + r * Math.cos(a0), yi0 = cy + r * Math.sin(a0);
    const c = palette[i % palette.length];
    if (frac > 0.9999) {
      segs += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${c}" stroke-width="${R - r}"/>`;
    } else if (frac > 0.0001) {
      segs += `<path d="M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} L${xi1.toFixed(1)},${yi1.toFixed(1)} A${r},${r} 0 ${large} 0 ${xi0.toFixed(1)},${yi0.toFixed(1)} Z" fill="${c}"/>`;
    }
    a0 = a1;
  });

  const legend = items.map((it, i) =>
    `<div class="lg-item"><span class="lg-swatch" style="background:${palette[i % palette.length]}"></span>${escapeHtml(it.name)}
     <b style="font-family:var(--mono);margin-left:4px">${valueFmt(it.value)}</b>
     <span class="text-muted">(${((100 * (Number(it.value) || 0)) / total).toFixed(1)}%)</span></div>`).join('');

  el.innerHTML = `<div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="flex-shrink:0">${segs}
      <text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="11" fill="${cssVar('--text-3', '#8b95ab')}">合计</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="14" font-weight="700" font-family="var(--mono)" fill="${cssVar('--text', '#1c2431')}">${valueFmt(total)}</text>
    </svg>
    <div class="chart-legend" style="flex-direction:column;gap:8px;margin:0;flex:1;min-width:180px">${legend}</div>
  </div>`;
}

/* ================= 工具 ================= */
function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const m = v / base;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * base;
}
function fmtShort(v) {
  const n = Number(v) || 0;
  if (n >= 10000) return (n / 10000).toFixed(n % 10000 === 0 ? 0 : 1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k';
  return String(Math.round(n));
}
function shortDate(s) {
  const t = String(s || '');
  return t.length >= 10 ? t.slice(5) : t;
}

/* 迷你趋势条（用于 KPI 卡） */
export function sparkline(values, color, width = 88, height = 26) {
  const vs = (values || []).map((v) => Number(v) || 0);
  if (vs.length < 2) return '';
  const max = Math.max(...vs, 1), min = Math.min(...vs, 0);
  const span = max - min || 1;
  const pts = vs.map((v, i) => [
    (width * i) / (vs.length - 1),
    height - ((height - 4) * (v - min)) / span - 2,
  ]);
  const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const c = color || cssVar('--primary', '#2f6fed');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block">
    <path d="${d}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
