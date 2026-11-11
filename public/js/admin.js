/* ================= Admin Portal ================= */
const main = document.getElementById('main');
const modal = document.getElementById('modal');
const overlay = document.getElementById('overlay');
const A = { settings: null, products: [], orders: [], orderFilter: 'all', orderQ: '', productQ: '', defaultPassword: false };

/* ---------- auth ---------- */
async function adminApi(url, opts) {
  try { return await api(url, opts); } catch (e) {
    if (e.status === 401) showLogin();
    throw e;
  }
}
function showLogin() { location.href = '/login'; }
async function showApp(me) {
  document.getElementById('adminView').classList.remove('hidden');
  document.getElementById('sideUser').textContent = `Signed in as ${me.name || me.username}`;
  A.settings = await adminApi('/api/admin/settings');
  CURRENCY = A.settings.currency || '₱';
  document.getElementById('sideStore').textContent = A.settings.storeName;
  document.title = `Admin · ${A.settings.storeName}`;
  route();
}
document.getElementById('logoutBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/auth/logout', { json: {} }).catch(() => {});
  showLogin();
});

/* ---------- modal ---------- */
function openModal(html, wide = false) {
  modal.innerHTML = `<div class="modal-box ${wide ? 'wide' : ''}">${html}</div>`;
  modal.classList.add('show');
  overlay.classList.add('show');
  modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
}
function closeModal() { modal.classList.remove('show'); overlay.classList.remove('show'); modal.innerHTML = ''; }
modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
overlay.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------- router ---------- */
function route() {
  const view = (location.hash || '#dashboard').slice(1);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
  ({ dashboard: viewDashboard, products: viewProducts, orders: viewOrders, reports: viewReports, settings: viewSettings }[view] || viewDashboard)();
}
window.addEventListener('hashchange', () => { if (!document.getElementById('adminView').classList.contains('hidden')) route(); });

function updatePendingBadge(count) {
  const b = document.getElementById('pendingBadge');
  b.textContent = count;
  b.classList.toggle('hidden', !count);
}

/* ================= Dashboard ================= */
async function viewDashboard() {
  main.innerHTML = '<p class="muted">Loading…</p>';
  const s = await adminApi('/api/admin/stats');
  updatePendingBadge(s.byStatus.pending);
  main.innerHTML = `
    <div class="main-head"><h1>Dashboard</h1></div>
    ${A.defaultPassword ? '<div class="alert alert-warn">You are using the default password. <a href="#settings">Change it in Settings</a> before going live.</div>' : ''}
    <div class="kpis">
      <div class="card kpi"><div class="label">Revenue (paid)</div><div class="value">${money(s.revenue)}</div><div class="sub">Excludes cancelled orders</div></div>
      <div class="card kpi"><div class="label">Awaiting payment</div><div class="value">${money(s.awaitingPayment)}</div><div class="sub">${s.awaitingPaymentCount} unpaid order${s.awaitingPaymentCount === 1 ? '' : 's'}</div></div>
      <div class="card kpi"><div class="label">Orders to process</div><div class="value">${s.byStatus.pending + s.byStatus.processing}</div><div class="sub">${s.byStatus.pending} pending · ${s.byStatus.processing} processing</div></div>
      <div class="card kpi"><div class="label">Products</div><div class="value">${s.activeProducts}<span class="muted" style="font-size:16px"> / ${s.products}</span></div><div class="sub">${s.outOfStock} out of stock</div></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="row" style="margin-bottom:8px"><h2 style="margin:0">Recent orders</h2><span class="spacer"></span><a href="#orders" class="small">View all</a></div>
        ${s.recentOrders.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Payment</th><th class="num">Total</th></tr></thead><tbody>
          ${s.recentOrders.map((o) => `<tr class="clickable" data-order="${o.id}"><td><strong>${esc(o.number)}</strong><div class="muted small">${fmtDate(o.createdAt)}</div></td><td>${esc(o.customer)}</td><td>${pill(o.status)}</td><td>${pill(o.paymentStatus)}</td><td class="num">${money(o.total)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">No orders yet. Share your store link to start selling.</p>'}
      </div>
      <div class="card">
        <div class="row" style="margin-bottom:8px"><h2 style="margin:0">Low stock</h2><span class="spacer"></span><span class="muted small">≤ ${s.lowStockThreshold} left</span></div>
        ${s.lowStock.length ? s.lowStock.map((p) => `
          <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)">
            <span>${esc(p.name)}</span><span class="spacer"></span>
            ${p.stock === 0 ? '<span class="pill pill-red">Out of stock</span>' : `<span class="pill pill-amber">${p.stock} left</span>`}
          </div>`).join('') + '<p style="margin:12px 0 0"><a href="#products" class="small">Update inventory →</a></p>' : '<p class="muted">All products are well stocked.</p>'}
      </div>
    </div>`;
  main.querySelectorAll('[data-order]').forEach((r) => r.addEventListener('click', async () => {
    A.orders = await adminApi('/api/admin/orders');
    openOrder(r.dataset.order, viewDashboard);
  }));
}

/* ================= Products ================= */
async function viewProducts() {
  main.innerHTML = '<p class="muted">Loading…</p>';
  A.products = await adminApi('/api/admin/products');
  main.innerHTML = `
    <div class="main-head">
      <h1>Products &amp; inventory</h1><span class="spacer"></span>
      <input id="pq" type="search" placeholder="Search name, SKU, category…" style="max-width:260px" value="${esc(A.productQ)}">
      <button class="btn btn-primary" id="addProduct">+ Add product</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th><th></th></tr></thead>
      <tbody id="ptbody"></tbody>
    </table></div>
    <p class="muted small" style="margin-top:10px">Tip: change a stock number and press Enter (or click away) to save it. Stock is deducted automatically when customers order and returned when you cancel an order.</p>`;
  document.getElementById('addProduct').onclick = () => openProductForm();
  document.getElementById('pq').addEventListener('input', (e) => { A.productQ = e.target.value; renderProductRows(); });
  renderProductRows();
}

function renderProductRows() {
  const tbody = document.getElementById('ptbody');
  const q = A.productQ.trim().toLowerCase();
  const list = A.products.filter((p) => !q || `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q));
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${A.products.length ? 'No products match your search.' : 'No products yet. Click “Add product” to create your first item.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((p) => `
    <tr>
      <td><div class="row"><div class="tthumb">${productImage(p)}</div><div><strong>${esc(p.name)}</strong>${p.sku ? `<div class="muted small">SKU: ${esc(p.sku)}</div>` : ''}</div></div></td>
      <td>${esc(p.category)}</td>
      <td class="num">${money(p.price)}${p.comparePrice ? `<div class="muted small"><s>${money(p.comparePrice)}</s></div>` : ''}</td>
      <td class="num"><input class="stock-input ${p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : ''}" type="number" min="0" step="1" value="${p.stock}" data-stock="${p.id}" aria-label="Stock for ${esc(p.name)}"></td>
      <td>${p.active ? '<span class="pill pill-green">Visible</span>' : '<span class="pill pill-gray">Hidden</span>'}</td>
      <td class="num"><button class="btn btn-sm" data-edit="${p.id}">Edit</button> <button class="btn btn-sm btn-danger" data-del="${p.id}">Delete</button></td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-stock]').forEach((inp) => {
    const commit = async () => {
      const p = A.products.find((x) => x.id === inp.dataset.stock);
      const val = Number(inp.value);
      if (!p || val === p.stock) return;
      if (!Number.isInteger(val) || val < 0) { toast('Stock must be a whole number (0 or more).', true); inp.value = p.stock; return; }
      try {
        const updated = await adminApi(`/api/admin/products/${p.id}/stock`, { method: 'PATCH', json: { stock: val } });
        Object.assign(p, updated);
        inp.className = `stock-input ${p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : ''}`;
        toast(`Stock for ${p.name} set to ${p.stock}`);
      } catch (err) { toast(err.message, true); inp.value = p.stock; }
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  });
  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openProductForm(A.products.find((p) => p.id === b.dataset.edit))));
  tbody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => confirmDelete(A.products.find((p) => p.id === b.dataset.del))));
}

function openProductForm(p = null) {
  const editing = !!p;
  const v = p || { name: '', sku: '', category: '', price: '', comparePrice: null, stock: 0, description: '', active: true, image: '' };
  const categories = [...new Set(A.products.map((x) => x.category).filter(Boolean))];
  openModal(`
    <form id="pform">
      <div class="modal-head"><h2>${editing ? 'Edit product' : 'Add product'}</h2><button type="button" class="x" data-close>&times;</button></div>
      <div class="modal-body">
        <div id="perr"></div>
        <div class="field">
          <label>Photo</label>
          <div class="img-edit">
            <div class="preview" id="imgPrev">${v.image ? `<img src="${esc(v.image)}" alt="">` : placeholder(v.name || 'New')}</div>
            <div>
              <input type="file" name="image" id="imgInput" accept="image/png,image/jpeg,image/gif,image/webp">
              <div class="muted small" style="margin-top:4px">PNG, JPG, GIF or WEBP · up to 5 MB · square photos look best</div>
              ${v.image ? '<label class="check" style="margin-top:6px"><input type="checkbox" id="removeImage"> Remove current photo</label>' : ''}
            </div>
          </div>
        </div>
        <div class="field"><label>Product name <span class="req">*</span></label><input name="name" required maxlength="120" value="${esc(v.name)}"></div>
        <div class="field-row">
          <div class="field"><label>Category</label><input name="category" list="catList" maxlength="60" value="${esc(v.category)}" placeholder="e.g. Apparel"><datalist id="catList">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
          <div class="field"><label>SKU / code</label><input name="sku" maxlength="60" value="${esc(v.sku)}"></div>
        </div>
        <div class="field-row three">
          <div class="field"><label>Price (${esc(CURRENCY)}) <span class="req">*</span></label><input name="price" type="number" min="0" step="0.01" required value="${v.price}"></div>
          <div class="field"><label>Compare-at price</label><input name="comparePrice" type="number" min="0" step="0.01" value="${v.comparePrice ?? ''}" placeholder="Optional"></div>
          <div class="field"><label>Stock on hand <span class="req">*</span></label><input name="stock" type="number" min="0" step="1" required value="${v.stock}"></div>
        </div>
        <p class="muted small" style="margin:-6px 0 14px">Compare-at price shows as a crossed-out "was" price and a Sale tag when it's higher than the price.</p>
        <div class="field"><label>Description</label><textarea name="description" rows="4" maxlength="3000">${esc(v.description)}</textarea></div>
        <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> Visible in store</label>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" id="psave">${editing ? 'Save changes' : 'Add product'}</button>
      </div>
    </form>`);

  const imgInput = document.getElementById('imgInput');
  imgInput.addEventListener('change', () => {
    const f = imgInput.files[0];
    if (f) document.getElementById('imgPrev').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
  });

  document.getElementById('pform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    fd.set('active', form.active.checked ? 'true' : 'false');
    if (!imgInput.files.length) fd.delete('image');
    const rm = document.getElementById('removeImage');
    if (rm && rm.checked) fd.set('removeImage', 'true');
    const btn = document.getElementById('psave');
    btn.disabled = true;
    try {
      await adminApi(editing ? `/api/admin/products/${p.id}` : '/api/admin/products', { method: editing ? 'PUT' : 'POST', body: fd });
      closeModal();
      toast(editing ? 'Product updated' : 'Product added');
      viewProducts();
    } catch (err) {
      document.getElementById('perr').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  });
}

function confirmDelete(p) {
  openModal(`
    <div class="modal-head"><h2>Delete product?</h2><button class="x" data-close>&times;</button></div>
    <div class="modal-body"><p>“<strong>${esc(p.name)}</strong>” will be removed from your store. Past orders keep their item details.</p>
    <p class="muted small">Tip: to hide it temporarily instead, edit it and untick “Visible in store”.</p></div>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" style="background:var(--danger);border-color:var(--danger)" id="delYes">Delete</button></div>`);
  document.getElementById('delYes').onclick = async () => {
    try {
      await adminApi(`/api/admin/products/${p.id}`, { method: 'DELETE' });
      closeModal(); toast('Product deleted'); viewProducts();
    } catch (err) { toast(err.message, true); }
  };
}

/* ================= Orders ================= */
async function viewOrders() {
  main.innerHTML = '<p class="muted">Loading…</p>';
  A.orders = await adminApi('/api/admin/orders');
  updatePendingBadge(A.orders.filter((o) => o.status === 'pending').length);
  main.innerHTML = `
    <div class="main-head">
      <h1>Orders</h1><span class="spacer"></span>
      <input id="oq" type="search" placeholder="Search order no., name, email, phone…" style="max-width:300px" value="${esc(A.orderQ)}">
    </div>
    <div class="tabs" id="otabs" style="margin-bottom:14px"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Payment</th><th>Status</th><th class="num">Total</th></tr></thead>
      <tbody id="otbody"></tbody>
    </table></div>`;
  document.getElementById('oq').addEventListener('input', (e) => { A.orderQ = e.target.value; renderOrderRows(); });
  renderOrderRows();
}

function renderOrderRows() {
  const counts = { all: A.orders.length, unpaid: A.orders.filter((o) => o.paymentStatus === 'unpaid' && o.status !== 'cancelled').length };
  for (const s of ['pending', 'processing', 'shipped', 'completed', 'cancelled']) counts[s] = A.orders.filter((o) => o.status === s).length;
  const labels = { all: 'All', unpaid: 'Awaiting payment', pending: 'Pending', processing: 'Processing', shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled' };
  const tabs = document.getElementById('otabs');
  tabs.innerHTML = Object.keys(labels).map((k) => `<button class="tab ${A.orderFilter === k ? 'active' : ''}" data-f="${k}">${labels[k]}<span class="n">${counts[k]}</span></button>`).join('');
  tabs.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { A.orderFilter = b.dataset.f; renderOrderRows(); }));

  const q = A.orderQ.trim().toLowerCase();
  const list = A.orders.filter((o) => {
    if (A.orderFilter === 'unpaid' && !(o.paymentStatus === 'unpaid' && o.status !== 'cancelled')) return false;
    if (!['all', 'unpaid'].includes(A.orderFilter) && o.status !== A.orderFilter) return false;
    return !q || `${o.number} ${o.customer.name} ${o.customer.email} ${o.customer.phone} ${o.paymentReference}`.toLowerCase().includes(q);
  });
  const tbody = document.getElementById('otbody');
  if (!list.length) { tbody.innerHTML = `<tr><td colspan="6" class="empty">${A.orders.length ? 'No orders match.' : 'No orders yet.'}</td></tr>`; return; }
  tbody.innerHTML = list.map((o) => `
    <tr class="clickable" data-order="${o.id}">
      <td><strong>${esc(o.number)}</strong><div class="muted small">${fmtDate(o.createdAt)}</div></td>
      <td>${esc(o.customer.name)}<div class="muted small">${esc(o.customer.phone)}</div></td>
      <td>${o.items.reduce((s, i) => s + i.qty, 0)}</td>
      <td>${pill(o.paymentStatus)}<div class="muted small">${esc(o.paymentMethod.name)}${o.paymentReference ? ' · ref ✓' : ''}</div></td>
      <td>${pill(o.status)}</td>
      <td class="num"><strong>${money(o.total)}</strong></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-order]').forEach((r) => r.addEventListener('click', () => openOrder(r.dataset.order, viewOrders)));
}

function openOrder(id, onSaved) {
  const o = A.orders.find((x) => x.id === id);
  if (!o) return;
  const c = o.customer;
  const opt = (list, cur) => list.map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`).join('');
  openModal(`
    <div class="modal-head"><h2>${esc(o.number)} <span class="muted small" style="font-weight:500">· ${fmtDate(o.createdAt)}</span></h2><button class="x" data-close>&times;</button></div>
    <div class="modal-body">
      <div id="oerr"></div>
      <div class="two-col" style="grid-template-columns:1fr 1fr">
        <div>
          <div class="section-title" style="margin-top:0">Customer</div>
          <div><strong>${esc(c.name)}</strong></div>
          <div><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>
          <div><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>
          <div class="section-title">Ship to</div>
          <div>${esc(c.address)}</div>
          <div>${esc([c.city, c.province, c.postalCode].filter(Boolean).join(', '))}</div>
          ${o.notes ? `<div class="section-title">Customer notes</div><div style="white-space:pre-line">${esc(o.notes)}</div>` : ''}
        </div>
        <div>
          <div class="section-title" style="margin-top:0">Payment</div>
          <div>${esc(o.paymentMethod.name)} · ${pill(o.paymentStatus)}</div>
          <div style="margin-top:4px">Reference no.: ${o.paymentReference ? `<strong>${esc(o.paymentReference)}</strong>` : '<span class="muted">none submitted</span>'}</div>
          <div class="section-title">Update order</div>
          <div class="field-row">
            <div class="field"><label>Order status</label><select id="oStatus">${opt([['pending', 'Pending'], ['processing', 'Processing'], ['shipped', 'Shipped'], ['completed', 'Completed'], ['cancelled', 'Cancelled']], o.status)}</select></div>
            <div class="field"><label>Payment status</label><select id="oPay">${opt([['unpaid', 'Unpaid'], ['paid', 'Paid'], ['refunded', 'Refunded']], o.paymentStatus)}</select></div>
          </div>
          <div class="field"><label>Internal note (customers can't see this)</label><textarea id="oNote" rows="2">${esc(o.adminNote || '')}</textarea></div>
          <p class="muted small" style="margin-top:-6px">Cancelling returns the items to inventory automatically.</p>
        </div>
      </div>
      <div class="section-title">Items</div>
      <div class="table-wrap"><table class="items-table">
        <thead><tr><th>Item</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Total</th></tr></thead>
        <tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}${i.sku ? ` <span class="muted small">(${esc(i.sku)})</span>` : ''}</td><td class="num">${money(i.price)}</td><td class="num">${i.qty}</td><td class="num">${money(i.lineTotal)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="totals" style="max-width:280px;margin:12px 0 0 auto">
        <div><span class="muted">Subtotal</span><span>${money(o.subtotal)}</span></div>
        <div><span class="muted">Shipping</span><span>${money(o.shippingFee)}</span></div>
        <div class="grand"><span>Total</span><span>${money(o.total)}</span></div>
      </div>
      <div class="section-title">History</div>
      <ul class="timeline">${[...o.history].reverse().map((h) => `<li>${esc(h.text)}<time>${fmtDate(h.at)}</time></li>`).join('')}</ul>
    </div>
    <div class="modal-foot"><button class="btn" data-close>Close</button><button class="btn btn-primary" id="oSave">Save changes</button></div>`, true);

  document.getElementById('oSave').onclick = async () => {
    try {
      const updated = await adminApi(`/api/admin/orders/${o.id}`, {
        method: 'PATCH',
        json: { status: document.getElementById('oStatus').value, paymentStatus: document.getElementById('oPay').value, adminNote: document.getElementById('oNote').value },
      });
      Object.assign(o, updated);
      closeModal(); toast(`${o.number} updated`);
      onSaved && onSaved();
    } catch (err) {
      document.getElementById('oerr').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  };
}

/* ================= Settings ================= */
async function viewSettings() {
  main.innerHTML = '<p class="muted">Loading…</p>';
  const s = A.settings = await adminApi('/api/admin/settings');
  const me = await adminApi('/api/admin/me');
  A.defaultPassword = me.defaultPassword;
  let methods = s.paymentMethods.map((m) => ({ ...m }));
  main.innerHTML = `
    <div class="main-head"><h1>Settings</h1></div>
    <div class="two-col">
      <form class="card" id="sform">
        <h2>Store details</h2>
        <div id="serr"></div>
        <div class="field"><label>Store name <span class="req">*</span></label><input name="storeName" required maxlength="80" value="${esc(s.storeName)}"></div>
        <div class="field"><label>Tagline (shown on the landing page)</label><input name="tagline" maxlength="200" value="${esc(s.tagline)}"></div>
        <div class="field-row">
          <div class="field"><label>Currency symbol</label><input name="currency" maxlength="5" value="${esc(s.currency)}"></div>
          <div class="field"><label>Shipping fee (flat, 0 = free)</label><input name="shippingFee" type="number" min="0" step="0.01" value="${s.shippingFee}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Contact email</label><input name="contactEmail" type="email" value="${esc(s.contactEmail)}"></div>
          <div class="field"><label>Contact phone</label><input name="contactPhone" value="${esc(s.contactPhone)}"></div>
        </div>
        <h2 style="margin-top:12px">Homepage slider</h2>
        <p class="muted small" style="margin-top:-4px">Big slides at the top of the store. Each slide shows photos of the products it links to.</p>
        <div id="slideList"></div>
        <button type="button" class="btn btn-sm" id="addSlide" style="margin-bottom:18px">+ Add slide</button>
        <h2 style="margin-top:12px">Manual payment methods</h2>
        <p class="muted small" style="margin-top:-4px">Customers pick one at checkout and see its instructions after ordering. Put your account names and numbers here.</p>
        <div id="pmList"></div>
        <button type="button" class="btn btn-sm" id="addPm">+ Add payment method</button>
        <div style="margin-top:20px"><button class="btn btn-primary" type="submit">Save settings</button></div>
      </form>
      <form class="card" id="pwform" style="align-self:start">
        <h2>Admin login</h2>
        ${A.defaultPassword ? '<div class="alert alert-warn">You are still using the demo password. Change it before going live.</div>' : ''}
        <div id="pwmsg"></div>
        <div class="field"><label>Username</label><input name="username" value="${esc(me.username)}" autocomplete="username"></div>
        <div class="field"><label>Current password</label><input name="currentPassword" type="password" required autocomplete="current-password"></div>
        <div class="field"><label>New password (min. 8 characters)</label><input name="newPassword" type="password" required minlength="8" autocomplete="new-password"></div>
        <button class="btn btn-primary" type="submit">Update login</button>
      </form>
    </div>`;

  let slides = (s.heroSlides || []).map((x) => ({ ...x }));
  const cats = [...new Set(A.products.length ? A.products.map((p) => p.category) : (await adminApi('/api/admin/products')).map((p) => p.category))].filter(Boolean).sort();
  const targets = [['sale', 'Sale items'], ['new', 'New arrivals'], ['', 'All products'], ...cats.map((c) => [c, `Category: ${c}`])];
  const slideList = document.getElementById('slideList');
  const syncSlides = () => {
    slideList.querySelectorAll('.pm-row').forEach((row, i) => {
      for (const k of ['eyebrow', 'title', 'subtitle', 'buttonText', 'target']) slides[i][k] = row.querySelector(`[data-s=${k}]`).value;
    });
  };
  const drawSlides = () => {
    slideList.innerHTML = slides.map((sl, i) => `
      <div class="pm-row">
        <div class="row" style="margin-bottom:8px"><strong style="font-size:14px">Slide ${i + 1}</strong><span class="spacer"></span>
          <button type="button" class="btn btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn btn-sm btn-danger" data-rms="${i}">Remove</button></div>
        <div class="field-row">
          <div class="field"><label>Small label</label><input data-s="eyebrow" maxlength="40" value="${esc(sl.eyebrow || '')}" placeholder="e.g. Season Sale"></div>
          <div class="field"><label>Links to</label><select data-s="target">${targets.map(([v, l]) => `<option value="${esc(v)}" ${v === (sl.target || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Headline</label><input data-s="title" maxlength="80" value="${esc(sl.title || '')}"></div>
        <div class="field-row">
          <div class="field"><label>Text</label><input data-s="subtitle" maxlength="200" value="${esc(sl.subtitle || '')}"></div>
          <div class="field"><label>Button text</label><input data-s="buttonText" maxlength="30" value="${esc(sl.buttonText || '')}" placeholder="Shop now"></div>
        </div>
      </div>`).join('') || '<p class="muted small">No slides. The store will show a simple welcome slide.</p>';
    slideList.querySelectorAll('[data-rms]').forEach((b) => b.addEventListener('click', () => { syncSlides(); slides.splice(Number(b.dataset.rms), 1); drawSlides(); }));
    slideList.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
      syncSlides(); const i = Number(b.dataset.up); [slides[i - 1], slides[i]] = [slides[i], slides[i - 1]]; drawSlides();
    }));
  };
  drawSlides();
  document.getElementById('addSlide').onclick = () => {
    syncSlides();
    if (slides.length >= 6) return toast('Up to 6 slides.', true);
    slides.push({ eyebrow: '', title: '', subtitle: '', buttonText: 'Shop now', target: 'sale' }); drawSlides();
  };
  const pmList = document.getElementById('pmList');
  const syncMethods = () => {
    pmList.querySelectorAll('.pm-row').forEach((row, i) => {
      methods[i].name = row.querySelector('[data-k=name]').value;
      methods[i].instructions = row.querySelector('[data-k=instructions]').value;
    });
  };
  const drawMethods = () => {
    pmList.innerHTML = methods.map((m, i) => `
      <div class="pm-row">
        <div class="row" style="margin-bottom:8px"><input data-k="name" placeholder="Method name, e.g. GCash" value="${esc(m.name)}" style="font-weight:600">
          <button type="button" class="btn btn-sm btn-danger" data-rm="${i}" ${methods.length === 1 ? 'disabled' : ''}>Remove</button></div>
        <textarea data-k="instructions" rows="3" placeholder="Payment instructions shown to the customer">${esc(m.instructions)}</textarea>
      </div>`).join('');
    pmList.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { syncMethods(); methods.splice(Number(b.dataset.rm), 1); drawMethods(); }));
  };
  drawMethods();
  document.getElementById('addPm').onclick = () => { syncMethods(); methods.push({ id: '', name: '', instructions: '' }); drawMethods(); };

  document.getElementById('sform').addEventListener('submit', async (e) => {
    e.preventDefault();
    syncMethods();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(['storeName', 'tagline', 'currency', 'shippingFee', 'contactEmail', 'contactPhone'].map((k) => [k, fd.get(k)]));
    body.paymentMethods = methods;
    syncSlides();
    body.heroSlides = slides;
    try {
      A.settings = await adminApi('/api/admin/settings', { method: 'PUT', json: body });
      CURRENCY = A.settings.currency;
      document.getElementById('sideStore').textContent = A.settings.storeName;
      document.getElementById('serr').innerHTML = '';
      toast('Settings saved');
      viewSettings();
    } catch (err) {
      document.getElementById('serr').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  });

  document.getElementById('pwform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await adminApi('/api/admin/password', { json: Object.fromEntries(fd) });
      A.defaultPassword = false;
      toast('Login updated');
      document.getElementById('sideUser').textContent = `Signed in as ${fd.get('username')}`;
      viewSettings();
    } catch (err) {
      document.getElementById('pwmsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  });
}

/* ---------- start ---------- */
api('/api/admin/me')
  .then((me) => { A.defaultPassword = me.defaultPassword; showApp(me); })
  .catch(() => showLogin());
