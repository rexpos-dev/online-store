/* ================= Storefront ================= */
const state = { settings: null, products: [], q: '', sort: 'featured', homeTab: 'new', slide: 0 };
const app = document.getElementById('app');

/* ---------- icons ---------- */
const ICON = {
  arrow: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  bag: '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
  truck: '<svg viewBox="0 0 48 48"><path d="M4 12h24v20H4zM28 20h9l7 7v5H28z"/><circle cx="12" cy="35" r="4"/><circle cx="36" cy="35" r="4"/></svg>',
  shield: '<svg viewBox="0 0 48 48"><path d="M24 5 8 11v11c0 10 7 18 16 21 9-3 16-11 16-21V11z"/><path d="m17 24 5 5 9-10"/></svg>',
  wallet: '<svg viewBox="0 0 48 48"><rect x="5" y="12" width="38" height="26" rx="4"/><path d="M5 18h38M32 28h5"/></svg>',
  box: '<svg viewBox="0 0 48 48"><path d="M6 15 24 6l18 9v18l-18 9-18-9z"/><path d="m6 15 18 9 18-9M24 24v18"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
};

/* ---------- product helpers ---------- */
const productById = (id) => state.products.find((p) => p.id === id);
const discount = (p) => (p.comparePrice ? Math.round((1 - p.price / p.comparePrice) * 100) : 0);
const withImageFirst = (list) => [...list].sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0));
const saleProducts = () => state.products.filter((p) => p.comparePrice).sort((a, b) => discount(b) - discount(a));
const newProducts = () => [...state.products].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
const bestProducts = () => [...state.products].sort((a, b) => (b.sold - a.sold) || (discount(b) - discount(a)) || (b.price - a.price));
const catLink = (c) => `#/shop/c/${encodeURIComponent(c)}`;

function categoryStats() {
  const map = new Map();
  for (const p of state.products) {
    const c = p.category || 'General';
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(p);
  }
  return [...map].map(([name, list]) => ({
    name, products: list, count: list.length,
    maxDisc: Math.max(0, ...list.map(discount)),
    minPrice: Math.min(...list.map((p) => p.price)),
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* slide/target → products + link */
function resolveTarget(target) {
  if (target === 'sale') return { list: saleProducts(), link: '#/shop/sale' };
  if (target === 'new') return { list: newProducts(), link: '#/shop/new' };
  if (target) {
    const list = state.products.filter((p) => p.category === target);
    if (list.length) return { list: withImageFirst(list).sort((a, b) => b.price - a.price), link: catLink(target) };
  }
  return { list: withImageFirst(bestProducts()), link: '#/shop' };
}

/* ---------- cart (saved in the browser) ---------- */
const cart = {
  items: (() => { try { return JSON.parse(localStorage.getItem('cart') || '[]'); } catch { return []; } })(),
  save() { try { localStorage.setItem('cart', JSON.stringify(this.items)); } catch { /* storage unavailable */ } updateCartCount(); },
  get(id) { return this.items.find((i) => i.productId === id); },
  add(id, qty = 1) {
    const p = productById(id);
    if (!p) return;
    const line = this.get(id);
    const current = line ? line.qty : 0;
    const next = Math.min(current + qty, p.stock);
    if (next <= current) { toast(p.stock === 0 ? 'Sorry, this item is sold out.' : `Only ${p.stock} available.`, true); return; }
    if (line) line.qty = next; else this.items.push({ productId: id, qty: next });
    this.save();
    toast(`Added ${p.name} to cart`);
  },
  setQty(id, qty) {
    const p = productById(id);
    const line = this.get(id);
    if (!line) return;
    if (qty <= 0) this.items = this.items.filter((i) => i.productId !== id);
    else line.qty = Math.min(qty, p ? p.stock : qty);
    this.save();
  },
  clear() { this.items = []; this.save(); },
  reconcile() {
    let changed = false;
    this.items = this.items.filter((i) => {
      const p = productById(i.productId);
      if (!p || p.stock === 0) { changed = true; return false; }
      if (i.qty > p.stock) { i.qty = p.stock; changed = true; }
      return true;
    });
    if (changed) this.save();
    return changed;
  },
  lines() { return this.items.map((i) => ({ ...i, product: productById(i.productId) })).filter((l) => l.product); },
  count() { return this.items.reduce((s, i) => s + i.qty, 0); },
  subtotal() { return this.lines().reduce((s, l) => s + l.product.price * l.qty, 0); },
};
function updateCartCount() { document.getElementById('cartCount').textContent = cart.count(); }

/* ---------- loading ---------- */
async function loadStore() {
  const [settings, products] = await Promise.all([api('/api/store'), api('/api/products')]);
  state.settings = settings;
  state.products = products;
  CURRENCY = settings.currency || '₱';
  document.title = settings.tagline ? `${settings.storeName} — ${settings.tagline}` : settings.storeName;
  renderChrome();
  cart.reconcile();
  updateCartCount();
}
async function refreshProducts() {
  state.products = await api('/api/products');
  return cart.reconcile();
}

/* header, top strip, footer */
function renderChrome() {
  const s = state.settings;
  const name = s.storeName || 'Store';
  document.getElementById('logo').innerHTML = `${esc(name)}<span>.</span>`;
  document.getElementById('stripEmail').innerHTML = s.contactEmail ? `${ICON.mail}${esc(s.contactEmail)}` : '';
  document.getElementById('stripPhone').innerHTML = s.contactPhone ? `${ICON.phone}${esc(s.contactPhone)}` : '';
  const cats = categoryStats();
  document.getElementById('catMenu').innerHTML = `<a href="#/shop">All products <span>${state.products.length}</span></a>`
    + cats.map((c) => `<a href="${catLink(c.name)}">${esc(c.name)} <span>${c.count}</span></a>`).join('');
  const ship = Number(s.shippingFee || 0);
  document.getElementById('footer').innerHTML = `
    <div class="wrap foot-grid">
      <div>
        <a href="#/" class="logo">${esc(name)}<span>.</span></a>
        <p style="margin:0;max-width:320px">${esc(s.tagline || '')}</p>
        <div class="foot-contact">
          ${s.contactEmail ? `<span>${ICON.mail}<a href="mailto:${esc(s.contactEmail)}">${esc(s.contactEmail)}</a></span>` : ''}
          ${s.contactPhone ? `<span>${ICON.phone}${esc(s.contactPhone)}</span>` : ''}
        </div>
      </div>
      <div>
        <h4>Shop</h4>
        <ul>${cats.slice(0, 6).map((c) => `<li><a href="${catLink(c.name)}">${esc(c.name)}</a></li>`).join('')}</ul>
      </div>
      <div>
        <h4>Customer care</h4>
        <ul>
          <li><a href="#/track">Track your order</a></li>
          <li><a href="#/shop/sale">Deals &amp; sale items</a></li>
          <li><a href="#/shop/new">New arrivals</a></li>
          <li><span>${ship ? `Flat ${money(ship)} shipping per order` : 'Free shipping on all orders'}</span></li>
        </ul>
      </div>
      <div>
        <h4>Ways to pay</h4>
        <div class="pay-pills">${s.paymentMethods.map((m) => `<span>${esc(m.name)}</span>`).join('')}</div>
        <p style="margin:14px 0 0">Place your order, then pay using the instructions shown after checkout.</p>
      </div>
    </div>
    <div class="wrap foot-bottom"><span>© ${new Date().getFullYear()} ${esc(name)}. All rights reserved.</span><span class="spacer"></span><a href="/login">Admin</a></div>`;
}

/* ---------- product card ---------- */
function stockText(p) {
  if (p.stock === 0) return '<span class="stock" style="color:var(--danger)">Sold out</span>';
  if (p.stock <= 5) return `<span class="stock" style="color:var(--warn)">Only ${p.stock} left</span>`;
  return '<span class="stock muted">In stock</span>';
}
function priceHtml(p) {
  return `<div class="price">${money(p.price)}${p.comparePrice ? `<s>${money(p.comparePrice)}</s>` : ''}</div>`;
}
function cardHtml(p, opts = {}) {
  const d = discount(p);
  const badges = [
    d ? `<span class="b-sale">${d}% off</span>` : '',
    opts.best && p.sold > 0 ? '<span class="b-best">Bestseller</span>' : '',
    p.stock === 0 ? '<span class="b-out">Sold out</span>' : (p.stock <= 5 ? `<span class="b-low">Only ${p.stock} left</span>` : ''),
  ].join('');
  return `
    <article class="pcard">
      <div class="pimg" data-view="${p.id}">
        ${productImage(p)}
        <div class="pbadges">${badges}</div>
        <button class="padd" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>${ICON.bag}${p.stock === 0 ? 'Sold out' : 'Add to cart'}</button>
      </div>
      <div class="pinfo">
        <div class="pcat">${esc(p.category)}</div>
        <div class="pname" data-view="${p.id}" title="${esc(p.name)}">${esc(p.name)}</div>
        <div class="pprice">${money(p.price)}${p.comparePrice ? `<s>${money(p.comparePrice)}</s>` : ''}</div>
      </div>
    </article>`;
}
function bindCards(root) {
  root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); cart.add(b.dataset.add); }));
  root.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => openProduct(el.dataset.view)));
}
const img = (p) => (p ? productImage(p) : '');

/* ================= HOME ================= */
let slideTimer;
function renderHome() {
  const s = state.settings;
  if (!state.products.length) {
    app.innerHTML = `<div class="wrap page"><div class="card empty"><h2>${esc(s.storeName)}</h2><p>No products yet. Check back soon!</p></div></div>`;
    return;
  }
  app.innerHTML = heroHtml() + `<div class="wrap">${featuresHtml()}${tilesHtml()}${featuredHtml()}${bannersHtml()}${categoriesHtml()}${infoBandHtml()}</div>`;
  bindHero();
  bindFeatured();
  bindCards(app);
}

/* hero slider */
const TINTS = ['#dfe7f6', '#f3e6dc', '#e2efe7', '#ece3f3', '#f5ecd6'];
function heroSlides() {
  const slides = (state.settings.heroSlides || []).filter((x) => x.title);
  if (slides.length) return slides;
  return [{ eyebrow: 'Welcome', title: state.settings.storeName, subtitle: state.settings.tagline, buttonText: 'Shop now', target: '' }];
}
function heroHtml() {
  const slides = heroSlides();
  if (state.slide >= slides.length) state.slide = 0;
  return `
    <section class="hero-slider" id="hero">
      <div class="hero-track" id="heroTrack" style="transform:translateX(-${state.slide * 100}%)">
        ${slides.map((sl, i) => {
          const { list, link } = resolveTarget(sl.target);
          const pics = withImageFirst(list).slice(0, 3);
          const maxD = Math.max(0, ...list.map(discount));
          const minP = list.length ? Math.min(...list.map((p) => p.price)) : 0;
          return `
          <div class="hero-slide" style="--tint:${TINTS[i % TINTS.length]}" aria-hidden="${i !== state.slide}">
            <div class="wrap hero-inner">
              <div class="hero-copy">
                ${sl.eyebrow ? `<div class="hero-eyebrow">${esc(sl.eyebrow)}</div>` : ''}
                <h1>${esc(sl.title)}</h1>
                ${sl.subtitle ? `<p>${esc(sl.subtitle)}</p>` : ''}
                <div class="hero-btns">
                  <a class="btn btn-primary btn-lg" href="${link}">${esc(sl.buttonText || 'Shop now')}</a>
                  <a class="btn btn-outline btn-lg" href="#/shop">View all products</a>
                </div>
              </div>
              <div class="hero-art">
                ${pics[0] ? `<div class="ha ha1">${img(pics[0])}</div>` : ''}
                ${pics[1] ? `<div class="ha ha2">${img(pics[1])}</div>` : ''}
                ${pics[2] ? `<div class="ha ha3">${img(pics[2])}</div>` : ''}
                ${list.length ? `<div class="hero-tag">${maxD ? `Save up to<strong>${maxD}% off</strong>` : `Starting at<strong>${money(minP)}</strong>`}</div>` : ''}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
      ${slides.length > 1 ? `
        <button class="hero-arrow prev" data-step="-1" aria-label="Previous">${ICON.left}</button>
        <button class="hero-arrow next" data-step="1" aria-label="Next">${ICON.arrow}</button>
        <div class="hero-dots">${slides.map((_, i) => `<button data-dot="${i}" class="${i === state.slide ? 'active' : ''}" aria-label="Slide ${i + 1}"></button>`).join('')}</div>` : ''}
    </section>`;
}
function bindHero() {
  const n = heroSlides().length;
  clearInterval(slideTimer);
  if (n < 2) return;
  const hero = document.getElementById('hero');
  const go = (i) => {
    state.slide = (i + n) % n;
    document.getElementById('heroTrack').style.transform = `translateX(-${state.slide * 100}%)`;
    hero.querySelectorAll('[data-dot]').forEach((d, k) => d.classList.toggle('active', k === state.slide));
    hero.querySelectorAll('.hero-slide').forEach((d, k) => d.setAttribute('aria-hidden', k !== state.slide));
  };
  const start = () => { clearInterval(slideTimer); slideTimer = setInterval(() => go(state.slide + 1), 6000); };
  hero.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => { go(state.slide + Number(b.dataset.step)); start(); }));
  hero.querySelectorAll('[data-dot]').forEach((b) => b.addEventListener('click', () => { go(Number(b.dataset.dot)); start(); }));
  hero.addEventListener('mouseenter', () => clearInterval(slideTimer));
  hero.addEventListener('mouseleave', start);
  let x0 = null;
  hero.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  hero.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) { go(state.slide + (dx < 0 ? 1 : -1)); start(); }
    x0 = null;
  });
  start();
}

function featuresHtml() {
  const s = state.settings;
  const ship = Number(s.shippingFee || 0);
  const pays = s.paymentMethods.map((m) => m.name).slice(0, 3).join(' · ');
  return `
    <section class="features">
      <div class="feature">${ICON.truck}<div><strong>${ship ? 'Flat-rate shipping' : 'Free shipping'}</strong><span>${ship ? `Only ${money(ship)} per order` : 'On every order'}</span></div></div>
      <div class="feature">${ICON.wallet}<div><strong>Flexible payment</strong><span>${esc(pays)}</span></div></div>
      <div class="feature">${ICON.shield}<div><strong>Secure checkout</strong><span>Your details stay private</span></div></div>
      <div class="feature">${ICON.box}<div><strong>Order tracking</strong><span>Check your order status anytime</span></div></div>
    </section>`;
}

const TILE_BG = ['#eef1f6', '#f4ede6', '#e9f1ec', '#efeaf5', '#f6f1e2'];
function tilesHtml() {
  const tiles = [];
  const sale = saleProducts();
  const used = new Set();
  const pick = (list) => { const p = withImageFirst(list).find((x) => !used.has(x.id)) || list[0]; if (p) used.add(p.id); return p; };
  if (sale.length) {
    tiles.push({ eb: 'Limited-time deals', title: 'Big Savings', text: `Up to ${discount(sale[0])}% off selected items`, link: '#/shop/sale', p: pick(sale) });
  }
  for (const c of categoryStats()) {
    if (tiles.length >= 4) break;
    tiles.push({
      badge: c.maxDisc ? `${c.maxDisc}% OFF` : '', eb: c.maxDisc ? '' : `${c.count} item${c.count > 1 ? 's' : ''}`,
      title: c.name, text: c.maxDisc ? `Up to ${c.maxDisc}% off` : `From ${money(c.minPrice)}`, link: catLink(c.name),
      p: pick([...c.products].sort((a, b) => b.price - a.price)),
    });
  }
  if (!tiles.length) return '';
  const cls = ['big', '', '', 'wide'];
  const layout = tiles.length === 4 ? 'tiles' : 'tiles tiles-flex';
  return `
    <section class="${layout}" ${tiles.length < 4 ? 'style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));grid-template-rows:260px"' : ''}>
      ${tiles.map((t, i) => `
        <a class="tile ${tiles.length === 4 ? cls[i] : ''}" href="${t.link}" style="--tile:${TILE_BG[i % TILE_BG.length]}">
          ${t.p && t.p.image ? `<img src="${esc(t.p.image)}" alt="" loading="lazy">` : ''}
          <div class="tile-copy">
            ${t.badge ? `<span class="badge-off">${esc(t.badge)}</span>` : ''}
            ${t.eb ? `<div class="eb">${esc(t.eb)}</div>` : ''}
            <h3>${esc(t.title)}</h3>
            <p>${esc(t.text)}</p>
            <span class="shop-link">Shop now ${ICON.arrow}</span>
          </div>
        </a>`).join('')}
    </section>`;
}

function featuredList() {
  const t = state.homeTab;
  const list = t === 'best' ? bestProducts() : t === 'sale' ? saleProducts() : newProducts();
  return list.slice(0, 10);
}
function featuredHtml() {
  const hasSale = state.products.some((p) => p.comparePrice);
  if (state.homeTab === 'sale' && !hasSale) state.homeTab = 'new';
  const tabs = [['new', 'New Arrivals'], ['best', 'Best Selling'], ...(hasSale ? [['sale', 'On Sale']] : [])];
  return `
    <section class="section" id="featured">
      <div class="section-head">
        <h2>Featured Products</h2>
        <div class="tabs-line">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${state.homeTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="pgrid five" id="featuredGrid">${featuredList().map((p) => cardHtml(p, { best: state.homeTab === 'best' })).join('')}</div>
      <div class="center-cta"><a class="btn btn-outline btn-lg" href="#/shop">View all products</a></div>
    </section>`;
}
function bindFeatured() {
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.homeTab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    const grid = document.getElementById('featuredGrid');
    grid.innerHTML = featuredList().map((p) => cardHtml(p, { best: state.homeTab === 'best' })).join('');
    bindCards(grid);
  }));
}

function bannersHtml() {
  const cats = categoryStats();
  if (cats.length < 2) return '';
  // Prefer categories not already featured in the tiles, then fall back to the top ones
  const tileCats = new Set(cats.slice(0, saleProducts().length ? 3 : 4).map((c) => c.name));
  const pool = [...cats.filter((c) => !tileCats.has(c.name)), ...cats];
  const chosen = [];
  for (const c of pool) { if (!chosen.find((x) => x.name === c.name)) chosen.push(c); if (chosen.length === 2) break; }
  const ebs = ['Weekend pick', 'Trending now'];
  const bgs = ['#dfe6f3', '#efe3d8'];
  return `
    <section class="section banners">
      ${chosen.map((c, i) => {
        const p = withImageFirst([...c.products].sort((a, b) => discount(b) - discount(a) || b.price - a.price))[0];
        return `
        <a class="banner" href="${catLink(c.name)}" style="--tile:${bgs[i]}">
          ${p && p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}
          <div class="tile-copy">
            <div class="eb" style="color:var(--muted);font-weight:500">${ebs[i]}</div>
            <h3>${esc(c.name)}</h3>
            <p>${c.maxDisc ? `<span class="off">Save up to ${c.maxDisc}%</span>` : `From <span class="off">${money(c.minPrice)}</span>`}</p>
            <span class="shop-link">Shop now ${ICON.arrow}</span>
          </div>
        </a>`;
      }).join('')}
    </section>`;
}

function categoriesHtml() {
  const cats = categoryStats();
  return `
    <section class="section">
      <div class="section-head"><h2>Shop by Category</h2><p>Find what you need, faster.</p></div>
      <div class="cats">
        ${cats.map((c) => {
          const p = withImageFirst(c.products)[0];
          return `<a class="cat" href="${catLink(c.name)}"><div class="circle">${img(p)}</div><strong>${esc(c.name)}</strong><span>${c.count} product${c.count > 1 ? 's' : ''}</span></a>`;
        }).join('')}
      </div>
    </section>`;
}

function infoBandHtml() {
  const s = state.settings;
  return `
    <section class="info-band">
      <div><h3>Ordered already?</h3><p>Track your order and send your payment reference number in one place.</p></div>
      <a class="btn btn-lg" href="#/track">Track your order</a>
    </section>
    `;
}

/* ================= SHOP ================= */
function renderShop(mode, cat) {
  const cats = categoryStats();
  let list = [...state.products];
  let title = 'All Products';
  if (mode === 'sale') { list = saleProducts(); title = 'On Sale'; }
  else if (mode === 'new') { list = newProducts(); title = 'New Arrivals'; }
  else if (mode === 'cat') { list = list.filter((p) => p.category === cat); title = cat; }
  const q = state.q.trim().toLowerCase();
  if (q) list = list.filter((p) => `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q));
  const sorters = {
    featured: null,
    low: (a, b) => a.price - b.price,
    high: (a, b) => b.price - a.price,
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    discount: (a, b) => discount(b) - discount(a),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  if (sorters[state.sort]) list.sort(sorters[state.sort]);
  else if (mode !== 'sale' && mode !== 'new') list.sort((a, b) => (b.stock > 0) - (a.stock > 0));

  const current = mode === 'cat' ? catLink(cat) : mode === 'sale' ? '#/shop/sale' : mode === 'new' ? '#/shop/new' : '#/shop';
  const saleCount = saleProducts().length;
  const links = [
    ['#/shop', 'All products', state.products.length],
    ...(saleCount ? [['#/shop/sale', 'On sale', saleCount]] : []),
    ['#/shop/new', 'New arrivals', state.products.length],
  ];
  app.innerHTML = `
    <div class="page-head"><div class="wrap">
      <div class="crumbs"><a href="#/">Home</a> / <a href="#/shop">Shop</a>${mode !== 'all' ? ` / ${esc(title)}` : ''}</div>
      <h1>${esc(title)}</h1>
    </div></div>
    <div class="wrap shop-layout">
      <aside class="sidebar">
        <h4>Browse</h4>
        <ul class="side-list">${links.map(([h, l, n]) => `<li><a href="${h}" class="${h === current ? 'active' : ''}">${l}<span>${n}</span></a></li>`).join('')}</ul>
        <h4>Categories</h4>
        <ul class="side-list">${cats.map((c) => `<li><a href="${catLink(c.name)}" class="${catLink(c.name) === current ? 'active' : ''}">${esc(c.name)}<span>${c.count}</span></a></li>`).join('')}</ul>
      </aside>
      <div>
        <div class="cat-pills">
          ${[['#/shop', 'All'], ...(saleCount ? [['#/shop/sale', 'On sale']] : []), ...cats.map((c) => [catLink(c.name), c.name])]
            .map(([h, l]) => `<a href="${h}" class="${h === current ? 'active' : ''}">${esc(l)}</a>`).join('')}
        </div>
        <div class="toolbar">
          <span class="muted">${list.length} product${list.length === 1 ? '' : 's'}</span>
          ${q ? `<span class="search-chip">“${esc(state.q)}” <button id="clearQ" aria-label="Clear search">&times;</button></span>` : ''}
          <span class="spacer"></span>
          <label class="muted small" for="sort" style="margin:0;font-weight:500">Sort by</label>
          <select id="sort">
            ${[['featured', 'Featured'], ['newest', 'Newest'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['discount', 'Biggest discount'], ['name', 'Name A–Z']]
              .map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        ${list.length ? `<div class="pgrid">${list.map((p) => cardHtml(p)).join('')}</div>`
          : `<div class="card empty"><h3>No products found</h3><p>Try a different search or category.</p><a class="btn btn-primary" href="#/shop">View all products</a></div>`}
      </div>
    </div>`;
  document.getElementById('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderShop(mode, cat); });
  const cq = document.getElementById('clearQ');
  if (cq) cq.addEventListener('click', () => { state.q = ''; document.getElementById('search').value = ''; renderShop(mode, cat); });
  bindCards(app);
}

/* ---------- product modal ---------- */
const modal = document.getElementById('productModal');
const overlay = document.getElementById('overlay');
function openProduct(id) {
  const p = productById(id);
  if (!p) return;
  let qty = 1;
  const d = discount(p);
  modal.innerHTML = `
    <div class="modal-box wide">
      <div class="modal-head"><span class="muted small">${esc(p.category)}</span><button class="x" data-close aria-label="Close">&times;</button></div>
      <div class="modal-body detail">
        <div class="thumb">${productImage(p)}</div>
        <div>
          <h2 style="font-size:26px">${esc(p.name)}</h2>
          <div class="row" style="gap:10px">${priceHtml(p)}${d ? `<span class="pill" style="background:var(--sale);color:#fff">${d}% OFF</span>` : ''}</div>
          <div style="margin:6px 0 14px">${stockText(p)}</div>
          <p>${esc(p.description || '')}</p>
          ${p.stock > 0 ? `
          <div class="row" style="margin-top:18px">
            <div class="qty"><button data-dec>−</button><span id="mQty">1</span><button data-inc>+</button></div>
            <button class="btn btn-primary" style="flex:1" data-madd>Add to cart</button>
          </div>` : '<button class="btn btn-block" disabled>Sold out</button>'}
        </div>
      </div>
    </div>`;
  modal.classList.add('show');
  overlay.classList.add('show');
  const qEl = modal.querySelector('#mQty');
  modal.querySelector('[data-close]').onclick = closeAll;
  modal.onclick = (e) => { if (e.target === modal) closeAll(); };
  if (p.stock > 0) {
    modal.querySelector('[data-dec]').onclick = () => { qty = Math.max(1, qty - 1); qEl.textContent = qty; };
    modal.querySelector('[data-inc]').onclick = () => { qty = Math.min(p.stock, qty + 1); qEl.textContent = qty; };
    modal.querySelector('[data-madd]').onclick = () => { cart.add(p.id, qty); closeAll(); };
  }
}

/* ---------- cart drawer ---------- */
const drawer = document.getElementById('drawer');
function openDrawer() { renderDrawer(); drawer.classList.add('open'); overlay.classList.add('show'); }
function closeAll() { drawer.classList.remove('open'); modal.classList.remove('show'); overlay.classList.remove('show'); }
overlay.addEventListener('click', closeAll);
document.querySelector('[data-close-drawer]').addEventListener('click', closeAll);
document.getElementById('cartBtn').addEventListener('click', openDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

function cartLineHtml(l, editable = true) {
  const p = l.product;
  return `
    <div class="line-item">
      <div class="mini">${productImage(p)}</div>
      <div>
        <div class="nm">${esc(p.name)}</div>
        <div class="muted small">${money(p.price)}${editable ? '' : ` × ${l.qty}`}</div>
        ${editable ? `
        <div class="row" style="margin-top:6px;gap:10px">
          <div class="qty"><button data-q="${p.id}" data-d="-1">−</button><span>${l.qty}</span><button data-q="${p.id}" data-d="1" ${l.qty >= p.stock ? 'disabled' : ''}>+</button></div>
          <button class="rm" data-rm="${p.id}">Remove</button>
        </div>` : ''}
      </div>
      <div style="font-weight:700">${money(p.price * l.qty)}</div>
    </div>`;
}

function renderDrawer() {
  const body = document.getElementById('drawerBody');
  const foot = document.getElementById('drawerFoot');
  const lines = cart.lines();
  if (!lines.length) {
    body.innerHTML = '<div class="empty">Your cart is empty.</div>';
    foot.innerHTML = '<button class="btn btn-block" data-close-x>Continue shopping</button>';
    foot.querySelector('[data-close-x]').onclick = closeAll;
    return;
  }
  body.innerHTML = lines.map((l) => cartLineHtml(l)).join('');
  foot.innerHTML = `
    <div class="totals"><div class="grand" style="border:none;padding:0;margin:0"><span>Subtotal</span><span>${money(cart.subtotal())}</span></div></div>
    <p class="muted small" style="margin:6px 0 14px">Shipping is added at checkout.</p>
    <button class="btn btn-primary btn-block" id="goCheckout">Checkout</button>`;
  body.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    const line = cart.get(b.dataset.q);
    cart.setQty(b.dataset.q, line.qty + Number(b.dataset.d));
    renderDrawer();
  }));
  body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { cart.setQty(b.dataset.rm, 0); renderDrawer(); }));
  foot.querySelector('#goCheckout').onclick = () => { closeAll(); location.hash = '#/checkout'; };
}

/* ---------- checkout ---------- */
function summaryHtml(editable = false) {
  const sub = cart.subtotal();
  const ship = Number(state.settings.shippingFee || 0);
  return `
    <div class="card summary">
      <h2 style="font-size:17px">Order summary</h2>
      <div>${cart.lines().map((l) => cartLineHtml(l, editable)).join('')}</div>
      <div class="totals" style="margin-top:10px">
        <div><span class="muted">Subtotal</span><span>${money(sub)}</span></div>
        <div><span class="muted">Shipping</span><span>${ship ? money(ship) : 'Free'}</span></div>
        <div class="grand"><span>Total</span><span>${money(sub + ship)}</span></div>
      </div>
    </div>`;
}
const pageHead = (title, crumb) => `<div class="page-head"><div class="wrap"><div class="crumbs"><a href="#/">Home</a> / ${esc(crumb || title)}</div><h1>${esc(title)}</h1></div></div>`;

async function renderCheckout() {
  const changed = await refreshProducts().catch(() => false);
  updateCartCount();
  if (!cart.lines().length) {
    app.innerHTML = `${pageHead('Checkout')}<div class="wrap page"><div class="card empty"><h2>Your cart is empty</h2><p>Add some items before checking out.</p><a class="btn btn-primary" href="#/shop">Browse products</a></div></div>`;
    return;
  }
  const saved = (() => { try { return JSON.parse(localStorage.getItem('customer') || '{}'); } catch { return {}; } })();
  const methods = state.settings.paymentMethods;
  const f = (name, label, opts = {}) => `
    <div class="field">
      <label for="f_${name}">${label}${opts.req ? ' <span class="req">*</span>' : ''}</label>
      <input id="f_${name}" name="${name}" type="${opts.type || 'text'}" ${opts.req ? 'required' : ''} autocomplete="${opts.ac || 'on'}" value="${esc(saved[name] || '')}">
    </div>`;
  app.innerHTML = `
    ${pageHead('Checkout')}
    <div class="wrap page">
      ${changed ? '<div class="alert alert-warn">Some items in your cart changed because of stock updates. Please review your order.</div>' : ''}
      <div class="checkout">
        <form class="card" id="checkoutForm" novalidate>
          <div id="formError"></div>
          <h3>Contact details</h3>
          ${f('name', 'Full name', { req: true, ac: 'name' })}
          <div class="field-row">
            ${f('email', 'Email', { req: true, type: 'email', ac: 'email' })}
            ${f('phone', 'Mobile number', { req: true, type: 'tel', ac: 'tel' })}
          </div>
          <h3 style="margin-top:10px">Delivery address</h3>
          ${f('address', 'House no., street, barangay', { req: true, ac: 'street-address' })}
          <div class="field-row three">
            ${f('city', 'City / Municipality', { req: true, ac: 'address-level2' })}
            ${f('province', 'Province', { ac: 'address-level1' })}
            ${f('postalCode', 'Postal code', { ac: 'postal-code' })}
          </div>
          <h3 style="margin-top:10px">Payment method</h3>
          <p class="muted small" style="margin-top:-4px">Payments are handled manually. You'll get instructions after placing your order.</p>
          ${methods.map((m, i) => `
            <label class="pay-option">
              <span class="top"><input type="radio" name="paymentMethod" value="${esc(m.id)}" ${i === 0 ? 'checked' : ''}> ${esc(m.name)}</span>
              ${m.instructions ? `<div class="inst">${esc(m.instructions)}</div>` : ''}
            </label>`).join('')}
          <div class="field" style="margin-top:14px">
            <label for="f_notes">Order notes (optional)</label>
            <textarea id="f_notes" name="notes" placeholder="Landmarks, preferred delivery time, etc."></textarea>
          </div>
          <button class="btn btn-primary btn-block" type="submit" id="placeBtn">Place order</button>
        </form>
        <div id="summary">${summaryHtml()}</div>
      </div>
    </div>`;

  document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const customer = {};
    for (const k of ['name', 'email', 'phone', 'address', 'city', 'province', 'postalCode']) customer[k] = String(fd.get(k) || '').trim();
    const errBox = document.getElementById('formError');
    const missing = [...form.querySelectorAll('[required]')].filter((i) => !i.value.trim());
    form.querySelectorAll('input').forEach((i) => { i.style.borderColor = ''; });
    if (missing.length) {
      missing.forEach((i) => { i.style.borderColor = 'var(--danger)'; });
      errBox.innerHTML = '<div class="alert alert-error">Please fill in all required fields.</div>';
      missing[0].focus();
      return;
    }
    const btn = document.getElementById('placeBtn');
    btn.disabled = true; btn.textContent = 'Placing order…';
    try {
      const order = await api('/api/orders', {
        json: {
          customer, paymentMethod: fd.get('paymentMethod'), notes: fd.get('notes'),
          items: cart.items.map((i) => ({ productId: i.productId, qty: i.qty })),
        },
      });
      try {
        localStorage.setItem('customer', JSON.stringify(customer));
        sessionStorage.setItem('lastOrder', JSON.stringify(order));
      } catch { /* storage unavailable */ }
      state.lastOrder = order;
      cart.clear();
      refreshProducts().catch(() => {});
      location.hash = `#/order/${order.number}`;
    } catch (err) {
      errBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (err.status === 409) { await refreshProducts().catch(() => {}); document.getElementById('summary').innerHTML = summaryHtml(); updateCartCount(); }
      btn.disabled = false; btn.textContent = 'Place order';
    }
  });
}

/* ---------- order details (confirmation + tracking) ---------- */
function orderDetailsHtml(o, { heading }) {
  const unpaid = o.paymentStatus === 'unpaid' && o.status !== 'cancelled';
  return `
    ${heading}
    ${unpaid ? `
      <div class="instructions">
        <h3>How to pay — ${esc(o.paymentMethod.name)}</h3>
        <p>${esc(o.paymentMethod.instructions || 'We will contact you with payment details.')}</p>
        <p style="margin-top:10px"><strong>Amount due: ${money(o.total)}</strong> · Reference: <strong>${esc(o.number)}</strong></p>
      </div>` : ''}
    <div class="card" style="margin-bottom:16px">
      <dl class="kv">
        <dt>Order number</dt><dd>${esc(o.number)}</dd>
        <dt>Placed on</dt><dd>${fmtDate(o.createdAt)}</dd>
        <dt>Order status</dt><dd>${pill(o.status)}</dd>
        <dt>Payment</dt><dd>${pill(o.paymentStatus)} <span class="muted small">via ${esc(o.paymentMethod.name)}</span></dd>
        ${o.paymentReference ? `<dt>Your reference no.</dt><dd>${esc(o.paymentReference)}</dd>` : ''}
      </dl>
    </div>
    ${unpaid && o.paymentMethod.id !== 'cod' ? `
      <form class="card" id="refForm" style="margin-bottom:16px">
        <h2 style="font-size:16px">Already paid? Send us your reference number</h2>
        <div id="refMsg"></div>
        <div class="row">
          <input name="reference" placeholder="e.g. GCash ref no. 1234 567 890" value="${esc(o.paymentReference || '')}" required>
          <button class="btn btn-primary" type="submit">Submit</button>
        </div>
      </form>` : ''}
    <div class="card" style="margin-bottom:16px">
      <h2 style="font-size:16px">Items</h2>
      ${o.items.map((i) => `
        <div class="line-item">
          <div class="mini">${productImage(i)}</div>
          <div><div class="nm">${esc(i.name)}</div><div class="muted small">${money(i.price)} × ${i.qty}</div></div>
          <div style="font-weight:700">${money(i.lineTotal)}</div>
        </div>`).join('')}
      <div class="totals" style="margin-top:8px">
        <div><span class="muted">Subtotal</span><span>${money(o.subtotal)}</span></div>
        <div><span class="muted">Shipping</span><span>${o.shippingFee ? money(o.shippingFee) : 'Free'}</span></div>
        <div class="grand"><span>Total</span><span>${money(o.total)}</span></div>
      </div>
    </div>
    <div class="card">
      <h2 style="font-size:16px">Order updates</h2>
      <ul class="timeline">${[...o.history].reverse().map((h) => `<li>${esc(h.text)}<time>${fmtDate(h.at)}</time></li>`).join('')}</ul>
    </div>`;
}

function bindRefForm(o, email, rerender) {
  const form = document.getElementById('refForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reference = new FormData(form).get('reference');
    try {
      const updated = await api('/api/orders/reference', { json: { number: o.number, email, reference } });
      toast('Reference number submitted. Thank you!');
      rerender(updated);
    } catch (err) {
      document.getElementById('refMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  });
}

function renderConfirmation(number) {
  let o = state.lastOrder;
  if (!o) { try { o = JSON.parse(sessionStorage.getItem('lastOrder') || 'null'); } catch { o = null; } }
  if (!o || o.number !== number) { location.hash = '#/track'; return; }
  const email = o.customer.email;
  const draw = (order) => {
    state.lastOrder = order;
    try { sessionStorage.setItem('lastOrder', JSON.stringify(order)); } catch { /* ignore */ }
    app.innerHTML = `<div class="wrap page"><div class="success">${orderDetailsHtml(order, {
      heading: `<div class="success-icon">✓</div>
        <h1 class="page-title">Thank you, ${esc(order.customer.name.split(' ')[0])}!</h1>
        <p class="muted">Your order <strong>${esc(order.number)}</strong> has been placed. Save this order number — you can check its status anytime on the <a href="#/track">Track order</a> page using your email (${esc(email)}).</p>`,
    })}<p style="margin-top:20px"><a class="btn" href="#/shop">Continue shopping</a></p></div></div>`;
    bindRefForm(order, email, draw);
  };
  draw(o);
}

function renderTrack() {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('customer') || '{}'); } catch { return {}; } })();
  app.innerHTML = `
    ${pageHead('Track your order', 'Track order')}
    <div class="wrap page"><div class="success">
      <p class="muted">Enter your order number and the email you used at checkout.</p>
      <form class="card" id="trackForm" style="margin-bottom:20px">
        <div id="trackErr"></div>
        <div class="field-row">
          <div class="field"><label>Order number</label><input name="number" placeholder="ORD-1001" required></div>
          <div class="field"><label>Email</label><input name="email" type="email" value="${esc(saved.email || '')}" required></div>
        </div>
        <button class="btn btn-primary" type="submit">Find order</button>
      </form>
      <div id="trackResult"></div>
    </div></div>`;
  document.getElementById('trackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const number = String(fd.get('number')).trim();
    const email = String(fd.get('email')).trim();
    const errBox = document.getElementById('trackErr');
    errBox.innerHTML = '';
    try {
      const order = await api('/api/orders/track', { json: { number, email } });
      const draw = (o) => {
        document.getElementById('trackResult').innerHTML = orderDetailsHtml(o, { heading: '' });
        bindRefForm(o, email, draw);
      };
      draw(order);
    } catch (err) {
      errBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      document.getElementById('trackResult').innerHTML = '';
    }
  });
}

/* ---------- router ---------- */
function shopFromHash() {
  const hash = location.hash || '';
  if (hash === '#/shop/sale') { setActiveNav('sale'); return renderShop('sale'); }
  if (hash === '#/shop/new') { setActiveNav('new'); return renderShop('new'); }
  if (hash.startsWith('#/shop/c/')) { setActiveNav('shop'); return renderShop('cat', decodeURIComponent(hash.slice(9))); }
  setActiveNav('shop');
  return renderShop('all');
}
function setActiveNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
}
function route() {
  closeAll();
  clearInterval(slideTimer);
  document.getElementById('mainNav').classList.remove('open');
  document.getElementById('searchForm').classList.remove('open');
  const hash = location.hash || '#/';
  window.scrollTo(0, 0);
  if (hash === '#/checkout') { setActiveNav(''); return renderCheckout(); }
  if (hash.startsWith('#/order/')) { setActiveNav(''); return renderConfirmation(decodeURIComponent(hash.slice(8))); }
  if (hash === '#/track') { setActiveNav('track'); return renderTrack(); }
  if (hash.startsWith('#/shop')) return shopFromHash();
  setActiveNav('home');
  return renderHome();
}

/* ---------- header interactions ---------- */
const searchInput = document.getElementById('search');
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = searchInput.value;
    if (!(location.hash || '').startsWith('#/shop')) { if (state.q.trim()) location.hash = '#/shop'; return; }
    shopFromHash();
  }, 250);
});
document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  state.q = searchInput.value;
  if ((location.hash || '').startsWith('#/shop')) route(); else location.hash = '#/shop';
});
document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('mainNav').classList.toggle('open'));
document.getElementById('searchToggle').addEventListener('click', () => {
  const f = document.getElementById('searchForm');
  f.classList.toggle('open');
  if (f.classList.contains('open')) searchInput.focus();
});

window.addEventListener('hashchange', route);
window.addEventListener('storage', (e) => { if (e.key === 'cart') { try { cart.items = JSON.parse(e.newValue || '[]'); } catch { cart.items = []; } updateCartCount(); } });

loadStore()
  .then(route)
  .catch(() => { app.innerHTML = '<div class="wrap page"><div class="card empty">The store could not be loaded. Please refresh the page.</div></div>'; });
