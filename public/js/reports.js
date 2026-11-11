/* ================= Sales Report (admin) ================= */
const R = { range: '30d', basis: 'paid', from: '', to: '', data: null, group: 'day' };

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const RANGES = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'],
  ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['custom', 'Custom'],
];

/** Returns [start, endExclusive] as local-time Dates */
function rangeDates() {
  const today = startOfDay(new Date());
  switch (R.range) {
    case 'today': return [today, addDays(today, 1)];
    case 'yesterday': return [addDays(today, -1), today];
    case '7d': return [addDays(today, -6), addDays(today, 1)];
    case 'month': return [new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1)];
    case 'lastmonth': return [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 1)];
    case 'year': return [new Date(today.getFullYear(), 0, 1), addDays(today, 1)];
    case 'custom': {
      const f = R.from ? new Date(`${R.from}T00:00:00`) : addDays(today, -29);
      const t = R.to ? new Date(`${R.to}T00:00:00`) : today;
      return f <= t ? [f, addDays(t, 1)] : [t, addDays(f, 1)];
    }
    default: return [addDays(today, -29), addDays(today, 1)];
  }
}

const counted = (o) => o.status !== 'cancelled' && (R.basis === 'all' || o.paymentStatus === 'paid');
const fmtShortDate = (d) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
const fmtMonth = (d) => d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });

async function viewReports() {
  if (!R.from) { const [f, t] = rangeDates(); R.from = ymd(f); R.to = ymd(addDays(t, -1)); }
  main.innerHTML = `
    <div class="main-head">
      <h1>Sales report</h1><span class="spacer"></span>
      <button class="btn btn-sm" id="exportOrders">Export orders (CSV)</button>
      <button class="btn btn-sm" id="exportProducts">Export products (CSV)</button>
    </div>
    <div class="card report-filters">
      <div class="tabs" id="rangeTabs">${RANGES.map(([k, l]) => `<button class="tab ${R.range === k ? 'active' : ''}" data-range="${k}">${l}</button>`).join('')}</div>
      <div class="row" style="flex-wrap:wrap;gap:10px">
        <div class="row ${R.range === 'custom' ? '' : 'hidden'}" id="customDates" style="gap:6px">
          <input type="date" id="rFrom" value="${R.from}" style="width:auto"> <span class="muted">to</span> <input type="date" id="rTo" value="${R.to}" style="width:auto">
        </div>
        <span class="spacer"></span>
        <label class="muted small" for="rBasis" style="margin:0">Count sales from</label>
        <select id="rBasis" style="width:auto">
          <option value="paid" ${R.basis === 'paid' ? 'selected' : ''}>Paid orders only</option>
          <option value="all" ${R.basis === 'all' ? 'selected' : ''}>All orders (paid + unpaid)</option>
        </select>
      </div>
    </div>
    <div id="reportBody"><p class="muted">Loading…</p></div>`;

  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    R.range = b.dataset.range;
    if (R.range !== 'custom') { const [f, t] = rangeDates(); R.from = ymd(f); R.to = ymd(addDays(t, -1)); }
    viewReports();
  }));
  const onDates = () => { R.from = document.getElementById('rFrom').value; R.to = document.getElementById('rTo').value; loadReport(); };
  document.getElementById('rFrom').addEventListener('change', onDates);
  document.getElementById('rTo').addEventListener('change', onDates);
  document.getElementById('rBasis').addEventListener('change', (e) => { R.basis = e.target.value; renderReport(); });
  document.getElementById('exportOrders').onclick = exportOrdersCsv;
  document.getElementById('exportProducts').onclick = exportProductsCsv;
  loadReport();
}

async function loadReport() {
  const [f, t] = rangeDates();
  try {
    R.data = await adminApi(`/api/admin/reports/sales?from=${encodeURIComponent(f.toISOString())}&to=${encodeURIComponent(t.toISOString())}`);
    R.start = f; R.end = t;
    renderReport();
  } catch (err) {
    document.getElementById('reportBody').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

/* ---------- aggregation ---------- */
function aggregate() {
  const orders = R.data.orders;
  const sales = orders.filter(counted);
  const sum = (list, k) => list.reduce((s, o) => s + o[k], 0);
  const items = sales.flatMap((o) => o.items);
  const unpaid = orders.filter((o) => o.status !== 'cancelled' && o.paymentStatus === 'unpaid');
  const cancelled = orders.filter((o) => o.status === 'cancelled');

  // time buckets (by local date; by month when the range is long)
  const days = Math.round((R.end - R.start) / 86400000);
  R.group = days > 92 ? 'month' : 'day';
  const buckets = [];
  const keyOf = (d) => (R.group === 'month' ? `${d.getFullYear()}-${d.getMonth()}` : ymd(d));
  for (let d = new Date(R.start); d < R.end; d = R.group === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : addDays(d, 1)) {
    buckets.push({ key: keyOf(d), date: new Date(d), value: 0, orders: 0 });
  }
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const o of sales) {
    const b = byKey[keyOf(new Date(o.createdAt))];
    if (b) { b.value += o.total; b.orders += 1; }
  }

  const group = (list, keyFn) => {
    const m = new Map();
    for (const x of list) {
      const k = keyFn(x);
      const g = m.get(k) || { name: k, qty: 0, sales: 0, orders: 0 };
      g.qty += x.qty || 0; g.sales += x.lineTotal ?? x.total; g.orders += 1;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.sales - a.sales);
  };
  const products = (() => {
    const m = new Map();
    for (const i of items) {
      const k = i.productId || i.name;
      const g = m.get(k) || { name: i.name, sku: i.sku, category: i.category, qty: 0, sales: 0 };
      g.qty += i.qty; g.sales += i.lineTotal;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.sales - a.sales || b.qty - a.qty);
  })();

  return {
    orders, sales, buckets, products,
    total: sum(sales, 'total'), net: sum(sales, 'subtotal'), shipping: sum(sales, 'shippingFee'),
    count: sales.length, itemsSold: items.reduce((s, i) => s + i.qty, 0),
    unpaid: { count: unpaid.length, amount: sum(unpaid, 'total') },
    cancelled: { count: cancelled.length, amount: sum(cancelled, 'total') },
    categories: group(items, (i) => i.category || 'Other'),
    methods: group(sales, (o) => o.paymentMethod),
    statuses: ['pending', 'processing', 'shipped', 'completed', 'cancelled'].map((s) => ({ s, n: orders.filter((o) => o.status === s).length })),
  };
}

/* ---------- render ---------- */
function renderReport() {
  const a = aggregate();
  R.agg = a;
  const label = R.basis === 'paid' ? 'paid orders' : 'paid + unpaid orders';
  const rangeLabel = `${R.start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })} – ${addDays(R.end, -1).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const share = (v, total) => (total ? Math.max(2, Math.round((v / total) * 100)) : 0);
  const barList = (rows, total, fmt = money) => rows.length ? rows.map((r) => `
      <div class="bar-row" title="${esc(r.name)}: ${fmt(r.sales)}">
        <div class="bar-label"><span>${esc(r.name)}</span><strong>${fmt(r.sales)}</strong></div>
        <div class="bar-track"><div class="bar-fill" style="width:${share(r.sales, total)}%"></div></div>
      </div>`).join('') : '<p class="muted small">No sales in this period.</p>';

  document.getElementById('reportBody').innerHTML = `
    <p class="muted small" style="margin:0 0 12px">${esc(rangeLabel)} · counting ${label}, cancelled orders excluded</p>
    <div class="kpis">
      <div class="card kpi"><div class="label">Total sales</div><div class="value">${money(a.total)}</div><div class="sub">${money(a.net)} products + ${money(a.shipping)} shipping</div></div>
      <div class="card kpi"><div class="label">Orders</div><div class="value">${a.count}</div><div class="sub">${a.itemsSold} item${a.itemsSold === 1 ? '' : 's'} sold</div></div>
      <div class="card kpi"><div class="label">Average order</div><div class="value">${money(a.count ? a.total / a.count : 0)}</div><div class="sub">Total sales ÷ orders</div></div>
      <div class="card kpi"><div class="label">Awaiting payment</div><div class="value">${money(a.unpaid.amount)}</div><div class="sub">${a.unpaid.count} unpaid · ${a.cancelled.count} cancelled</div></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:6px"><h2 style="margin:0">Sales by ${R.group === 'month' ? 'month' : 'day'}</h2><span class="spacer"></span>
        <button class="btn btn-sm btn-ghost" id="toggleTable">Show as table</button></div>
      <div id="chartWrap" class="chart-wrap"></div>
      <div id="chartTable" class="hidden" style="overflow-x:auto"></div>
    </div>

    <div class="two-col" style="margin-bottom:16px">
      <div class="card">
        <h2>Top products</h2>
        ${a.products.length ? `<div style="overflow-x:auto"><table>
          <thead><tr><th>#</th><th>Product</th><th class="num">Qty sold</th><th class="num">Sales</th><th class="num">Share</th></tr></thead>
          <tbody>${a.products.slice(0, 10).map((p, i) => `<tr><td class="muted">${i + 1}</td><td><strong>${esc(p.name)}</strong><div class="muted small">${esc(p.category)}${p.sku ? ` · ${esc(p.sku)}` : ''}</div></td><td class="num">${p.qty}</td><td class="num">${money(p.sales)}</td><td class="num muted">${a.net ? Math.round((p.sales / a.net) * 100) : 0}%</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted small">No products sold in this period.</p>'}
      </div>
      <div style="display:grid;gap:16px;align-content:start">
        <div class="card"><h2>By category</h2>${barList(a.categories, a.net)}</div>
        <div class="card"><h2>By payment method</h2>${barList(a.methods, a.total)}</div>
      </div>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:8px"><h2 style="margin:0">Orders in this period</h2><span class="spacer"></span>
        <span class="muted small">${a.statuses.filter((x) => x.n).map((x) => `${pill(x.s)} ${x.n}`).join(' &nbsp; ') || 'No orders'}</span></div>
      ${a.orders.length ? `<div style="overflow-x:auto;max-height:420px;overflow-y:auto"><table>
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Payment</th><th>Status</th><th class="num">Total</th></tr></thead>
        <tbody>${[...a.orders].reverse().map((o) => `<tr class="${counted(o) ? '' : 'muted-row'}"><td><strong>${esc(o.number)}</strong></td><td>${fmtDate(o.createdAt)}</td><td>${esc(o.customer)}</td><td>${pill(o.paymentStatus)} <span class="muted small">${esc(o.paymentMethod)}</span></td><td>${pill(o.status)}</td><td class="num">${money(o.total)}</td></tr>`).join('')}</tbody>
      </table></div><p class="muted small" style="margin:8px 0 0">Faded rows are not counted in the totals above.</p>` : '<p class="muted">No orders in this period.</p>'}
    </div>`;

  drawChart(a.buckets);
  document.getElementById('chartTable').innerHTML = `<table><thead><tr><th>${R.group === 'month' ? 'Month' : 'Date'}</th><th class="num">Orders</th><th class="num">Sales</th></tr></thead><tbody>
    ${a.buckets.map((b) => `<tr><td>${R.group === 'month' ? fmtMonth(b.date) : b.date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}</td><td class="num">${b.orders}</td><td class="num">${money(b.value)}</td></tr>`).join('')}</tbody></table>`;
  document.getElementById('toggleTable').onclick = (e) => {
    const t = document.getElementById('chartTable');
    const showTable = t.classList.contains('hidden');
    t.classList.toggle('hidden', !showTable);
    document.getElementById('chartWrap').classList.toggle('hidden', showTable);
    e.target.textContent = showTable ? 'Show as chart' : 'Show as table';
  };
}

/* ---------- bar chart (single series, SVG) ---------- */
function niceMax(v) {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n % 1e3 ? 1 : 0)}k` : String(Math.round(n)));

function drawChart(buckets) {
  const wrap = document.getElementById('chartWrap');
  if (!wrap) return;
  const W = Math.max(320, wrap.clientWidth);
  const H = 280; const padL = 56; const padR = 8; const padT = 14; const padB = 30;
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const max = niceMax(Math.max(0, ...buckets.map((b) => b.value)));
  const n = buckets.length;
  const slot = plotW / n;
  const bw = Math.max(2, Math.min(28, slot * 0.62));
  const y = (v) => padT + plotH - (v / max) * plotH;
  const every = Math.ceil(n / Math.max(2, Math.floor(plotW / 64)));
  const r = Math.min(4, bw / 2);
  const bar = (x, top, w, h) => (h <= 0 ? '' : h < r
    ? `<rect x="${x}" y="${top}" width="${w}" height="${h}" />`
    : `<path d="M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${top + h} Z" />`);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const total = buckets.reduce((s, b) => s + b.value, 0);

  wrap.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales by ${R.group}, total ${money(total)}">
      <g class="grid">${ticks.map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${CURRENCY}${compact(t)}</text>`).join('')}</g>
      <g class="bars">${buckets.map((b, i) => { const x = padL + i * slot + (slot - bw) / 2; return bar(x, y(b.value), bw, padT + plotH - y(b.value)); }).join('')}</g>
      <g class="xlabels">${buckets.map((b, i) => (i % every === 0 ? `<text x="${padL + i * slot + slot / 2}" y="${H - 8}" text-anchor="middle">${R.group === 'month' ? b.date.toLocaleDateString('en-PH', { month: 'short' }) : fmtShortDate(b.date)}</text>` : '')).join('')}</g>
      <g class="hits">${buckets.map((b, i) => `<rect data-i="${i}" x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}" />`).join('')}</g>
      <line class="hover-line hidden" id="hoverLine" y1="${padT}" y2="${padT + plotH}"/>
    </svg>
    <div class="chart-tip hidden" id="chartTip"></div>`;

  const tip = document.getElementById('chartTip');
  const line = document.getElementById('hoverLine');
  wrap.querySelectorAll('.hits rect').forEach((rect) => {
    rect.addEventListener('mouseenter', () => {
      const b = buckets[Number(rect.dataset.i)];
      const cx = Number(rect.getAttribute('x')) + slot / 2;
      line.setAttribute('x1', cx); line.setAttribute('x2', cx); line.classList.remove('hidden');
      tip.innerHTML = `<div class="muted small">${R.group === 'month' ? fmtMonth(b.date) : b.date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
        <strong>${money(b.value)}</strong><div class="small">${b.orders} order${b.orders === 1 ? '' : 's'}</div>`;
      tip.classList.remove('hidden');
      const tx = Math.min(Math.max(cx - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
      tip.style.left = `${tx}px`;
      tip.style.top = `${Math.max(0, y(b.value) - tip.offsetHeight - 10)}px`;
    });
    rect.addEventListener('mouseleave', () => { tip.classList.add('hidden'); line.classList.add('hidden'); });
  });
}
let chartResize;
window.addEventListener('resize', () => {
  clearTimeout(chartResize);
  chartResize = setTimeout(() => { if (R.agg && document.getElementById('chartWrap')) drawChart(R.agg.buckets); }, 150);
});

/* ---------- CSV export ---------- */
function downloadCsv(name, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileRange = () => `${R.from || ymd(R.start)}_to_${R.to || ymd(addDays(R.end, -1))}`;
function exportOrdersCsv() {
  if (!R.data) return;
  const rows = [['Order', 'Date', 'Customer', 'Email', 'Phone', 'City', 'Items', 'Subtotal', 'Shipping', 'Total', 'Payment method', 'Payment status', 'Reference no.', 'Order status', 'Counted in sales']];
  for (const o of R.data.orders) {
    rows.push([o.number, new Date(o.createdAt).toLocaleString('en-PH'), o.customer, o.email, o.phone, o.city,
      o.items.map((i) => `${i.name} x${i.qty}`).join('; '), o.subtotal.toFixed(2), o.shippingFee.toFixed(2), o.total.toFixed(2),
      o.paymentMethod, o.paymentStatus, o.paymentReference, o.status, counted(o) ? 'yes' : 'no']);
  }
  downloadCsv(`sales-orders_${fileRange()}.csv`, rows);
}
function exportProductsCsv() {
  if (!R.agg) return;
  const rows = [['Product', 'SKU', 'Category', 'Qty sold', 'Sales']];
  for (const p of R.agg.products) rows.push([p.name, p.sku, p.category, p.qty, p.sales.toFixed(2)]);
  downloadCsv(`sales-products_${fileRange()}.csv`, rows);
}
