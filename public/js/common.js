/* Shared helpers for storefront and admin */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let CURRENCY = '₱';
const money = (n) => CURRENCY + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso) => new Date(iso).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function api(url, opts = {}) {
  const init = { credentials: 'same-origin', ...opts };
  if (opts.json !== undefined) {
    init.method = opts.method || 'POST';
    init.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    init.body = JSON.stringify(opts.json);
  }
  const res = await fetch(url, init);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

/* Colored initials tile used when a product has no photo */
function placeholder(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const initials = String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return `<div class="placeholder-img" style="background:linear-gradient(135deg,hsl(${hue} 35% 52%),hsl(${(hue + 40) % 360} 40% 38%))">${esc(initials)}</div>`;
}
const productImage = (p) => (p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : placeholder(p.name));

const STATUS_PILL = {
  pending: ['Pending', 'pill-amber'], processing: ['Processing', 'pill-blue'], shipped: ['Shipped', 'pill-blue'],
  completed: ['Completed', 'pill-green'], cancelled: ['Cancelled', 'pill-gray'],
  unpaid: ['Unpaid', 'pill-red'], paid: ['Paid', 'pill-green'], refunded: ['Refunded', 'pill-gray'],
};
const pill = (key) => { const [t, c] = STATUS_PILL[key] || [key, 'pill-gray']; return `<span class="pill ${c}">${esc(t)}</span>`; };
