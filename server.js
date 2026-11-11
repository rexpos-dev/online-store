'use strict';
/**
 * Simple Online Store (MySQL)
 * - Storefront:   http://localhost:5050/
 * - Admin login:  http://localhost:5050/login
 * - Admin portal: http://localhost:5050/admin
 * Database connection comes from DATABASE_URL in .env. Tables are created automatically.
 * Product images are stored in uploads/.
 */
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5050;
const DATABASE_URL = process.env.DATABASE_URL;
const DEMO_USER = process.env.DEMO_ADMIN_USERNAME || 'admin';
const DEMO_PASS = process.env.DEMO_ADMIN_PASSWORD || 'admin123';
const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const LOW_STOCK = 5;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'completed', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'];

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------- helpers
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const uid = () => crypto.randomBytes(6).toString('hex');
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function toMoney(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? round2(n) : NaN;
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(String(pw ?? ''), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- database
let pool;
const q = async (sql, params, conn = pool) => (await conn.query(sql, params))[0];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(60) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL DEFAULT '',
    password_hash VARCHAR(255) NOT NULL,
    is_demo TINYINT(1) NOT NULL DEFAULT 0,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    admin_id INT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX (expires_at),
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS settings (
    id TINYINT PRIMARY KEY,
    data TEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(16) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    sku VARCHAR(60) NOT NULL DEFAULT '',
    category VARCHAR(60) NOT NULL DEFAULT 'General',
    description TEXT,
    price DECIMAL(12,2) NOT NULL,
    compare_price DECIMAL(12,2) NULL,
    stock INT NOT NULL DEFAULT 0,
    image VARCHAR(255) NOT NULL DEFAULT '',
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(16) PRIMARY KEY,
    seq INT NOT NULL AUTO_INCREMENT UNIQUE,
    number VARCHAR(20) NULL UNIQUE,
    customer_name VARCHAR(120) NOT NULL,
    email VARCHAR(160) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    address VARCHAR(300) NOT NULL,
    city VARCHAR(80) NOT NULL,
    province VARCHAR(80) NOT NULL DEFAULT '',
    postal_code VARCHAR(20) NOT NULL DEFAULT '',
    subtotal DECIMAL(12,2) NOT NULL,
    shipping_fee DECIMAL(12,2) NOT NULL,
    total DECIMAL(12,2) NOT NULL,
    payment_method_id VARCHAR(40) NOT NULL,
    payment_method_name VARCHAR(60) NOT NULL,
    payment_instructions TEXT,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
    payment_reference VARCHAR(100) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    notes TEXT,
    admin_note TEXT,
    restocked TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX (email),
    INDEX (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=1001`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(16) NOT NULL,
    product_id VARCHAR(16) NOT NULL,
    name VARCHAR(120) NOT NULL,
    sku VARCHAR(60) NOT NULL DEFAULT '',
    price DECIMAL(12,2) NOT NULL,
    qty INT NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,
    image VARCHAR(255) NOT NULL DEFAULT '',
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS order_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(16) NOT NULL,
    at DATETIME NOT NULL,
    text VARCHAR(500) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const DEFAULT_SETTINGS = {
  storeName: 'My Online Store',
  tagline: 'Quality finds, delivered to your door.',
  currency: '₱',
  shippingFee: 100,
  contactEmail: 'hello@example.com',
  contactPhone: '0917 000 0000',
  heroSlides: [
    { eyebrow: 'Holiday Sale', title: 'Up to 20% off our favourites', subtitle: 'Headphones, sneakers, watches and more — while stocks last.', buttonText: 'Shop the sale', target: 'sale' },
    { eyebrow: 'New Arrivals', title: 'Everyday gear, made to last', subtitle: 'Backpacks, sunglasses and accessories for work, travel and weekends.', buttonText: 'Shop accessories', target: 'Accessories' },
    { eyebrow: 'Home Essentials', title: 'Little things, big comfort', subtitle: 'Mugs, tumblers and notebooks to brighten your daily routine.', buttonText: 'Shop home', target: 'Home' },
  ],
  paymentMethods: [
    { id: 'gcash', name: 'GCash', instructions: 'Send the total amount to GCash 0917 000 0000 (Juan Dela Cruz). Put your order number in the message, then submit your reference number on the Track Order page.' },
    { id: 'bank', name: 'Bank Transfer', instructions: 'Deposit to BDO Savings 0000-0000-0000 (Juan Dela Cruz). Submit your reference number on the Track Order page after paying.' },
    { id: 'cod', name: 'Cash on Delivery', instructions: 'Prepare the exact amount and pay the rider when your order arrives.' },
  ],
};

// [name, category, price, stock, description, comparePrice, sku, image file in sample-data/images]
const SAMPLE_PRODUCTS = [
  ['Classic Cotton Tee', 'Apparel', 450, 40, 'Soft 100% cotton crew-neck tee. Pre-shrunk, regular fit.\nAvailable in one colour, sizes S–XL.', 550, 'TEE-001', 'tee.jpg'],
  ['Hooded Sweatshirt', 'Apparel', 1290, 12, 'Midweight fleece hoodie with kangaroo pocket and drawstring hood. Our bestseller.', null, 'HOD-001', 'hoodie.jpg'],
  ['Everyday Cap', 'Accessories', 399, 0, 'Adjustable six-panel cap with curved brim and embroidered patch.', null, 'CAP-001', 'cap.jpg'],
  ['Canvas Tote Bag', 'Accessories', 350, 25, 'Heavy-duty canvas tote with inner pocket. Fits a 14" laptop.', null, 'BAG-001', 'tote.jpg'],
  ['Travel Backpack', 'Accessories', 1890, 10, 'Water-resistant backpack with padded 15" laptop sleeve and quick-access front pocket.', null, 'BPK-001', 'backpack.jpg'],
  ['Polarized Sunglasses', 'Accessories', 799, 20, 'Lightweight frame with polarized UV400 lenses. Includes a soft pouch.', null, 'SUN-001', 'sunglasses.jpg'],
  ['Classic Analog Watch', 'Accessories', 1990, 6, 'Gold-tone case, minimalist dial and genuine leather strap. Water resistant to 30 m.', 2490, 'WAT-001', 'watch.jpg'],
  ['Everyday Sneakers', 'Footwear', 2490, 15, 'Cushioned low-top sneakers with breathable upper and non-slip sole.', 2990, 'SNK-001', 'sneakers.jpg'],
  ['Wireless Headphones', 'Electronics', 2990, 8, 'Over-ear Bluetooth headphones with up to 40 hours of battery life and soft memory-foam cushions.', 3490, 'HPH-001', 'headphones.jpg'],
  ['Ceramic Coffee Mug', 'Home', 280, 3, '12 oz stoneware mug, microwave and dishwasher safe.', null, 'MUG-001', 'mug.jpg'],
  ['Stainless Tumbler', 'Home', 690, 18, 'Double-walled vacuum tumbler with straw lid. Keeps drinks cold for 24 hours.', 850, 'TMB-001', 'tumbler.jpg'],
  ['Hardcover Notebook', 'Stationery', 220, 50, 'A5 dotted notebook, 160 pages, with elastic band and ribbon bookmark.', null, 'NTB-001', 'notebook.jpg'],
];
const SAMPLE_IMAGE_DIR = path.join(ROOT, 'sample-data', 'images');

function copySampleImage(file) {
  const src = path.join(SAMPLE_IMAGE_DIR, file || '');
  if (!file || !fs.existsSync(src)) return '';
  const name = `sample-${path.basename(file, path.extname(file))}-${uid()}${path.extname(file)}`;
  fs.copyFileSync(src, path.join(UPLOAD_DIR, name));
  return `/uploads/${name}`;
}

/**
 * Adds the sample products. Matches existing products by SKU:
 * existing ones get the sample photo if they don't have one yet; missing ones are created.
 * With refresh=true, products still using an older sample photo get the latest one (your own uploads are never replaced).
 */
async function seedSampleProducts(refresh = false) {
  let added = 0; let updated = 0;
  const t = new Date();
  for (const [name, category, price, stock, description, comparePrice, sku, file] of SAMPLE_PRODUCTS) {
    const [existing] = await q('SELECT id, image FROM products WHERE sku = ?', [sku]);
    if (existing) {
      if (!existing.image || (refresh && existing.image.startsWith('/uploads/sample-'))) {
        if (existing.image) removeImage(existing.image);
        await q('UPDATE products SET image = ?, updated_at = ? WHERE id = ?', [copySampleImage(file), t, existing.id]);
        updated += 1;
      }
      continue;
    }
    await q('INSERT INTO products SET ?', [{
      id: uid(), name, category, price, stock, description, compare_price: comparePrice, sku,
      image: copySampleImage(file), active: 1, created_at: t, updated_at: t,
    }]);
    added += 1;
  }
  return { added, updated };
}

let settingsCache = null;
async function getSettings() {
  if (!settingsCache) {
    const rows = await q('SELECT data FROM settings WHERE id = 1');
    settingsCache = rows.length ? { ...DEFAULT_SETTINGS, ...JSON.parse(rows[0].data) } : { ...DEFAULT_SETTINGS };
  }
  return settingsCache;
}
async function saveSettings(s) {
  await q('INSERT INTO settings (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)', [JSON.stringify(s)]);
  settingsCache = s;
}

async function initDb() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Create a .env file (see .env.example).');
  }
  const url = new URL(DATABASE_URL);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must include a database name, e.g. mysql://user:pass@localhost:3306/online_store');
  const conn = {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    charset: 'utf8mb4',
  };

  // Create the database if it doesn't exist yet
  const boot = await mysql.createConnection(conn);
  await boot.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await boot.end();

  pool = mysql.createPool({ ...conn, database, connectionLimit: 10, decimalNumbers: true, timezone: 'Z' });
  for (const sql of SCHEMA) await q(sql);

  const t = new Date();
  // Demo admin (only when there are no admins yet)
  const [{ n: adminCount }] = await q('SELECT COUNT(*) AS n FROM admins');
  if (!Number(adminCount)) {
    await q('INSERT INTO admins SET ?', [{ username: DEMO_USER, name: 'Demo Admin', password_hash: hashPassword(DEMO_PASS), is_demo: 1, created_at: t }]);
    console.log(`Created demo admin -> username: ${DEMO_USER}  password: ${DEMO_PASS}`);
  }
  // Default settings + sample products on first run
  const hasSettings = (await q('SELECT 1 FROM settings WHERE id = 1')).length;
  if (!hasSettings) {
    await saveSettings({ ...DEFAULT_SETTINGS });
    const [{ n: productCount }] = await q('SELECT COUNT(*) AS n FROM products');
    if (!Number(productCount)) {
      await seedSampleProducts();
      console.log('Added sample products.');
    }
  }
  await q('DELETE FROM admin_sessions WHERE expires_at < ?', [t]);
}

// ---------------------------------------------------------------- row mappers
const toProduct = (r) => ({
  id: r.id, name: r.name, sku: r.sku || '', category: r.category || 'General', description: r.description || '',
  price: Number(r.price), comparePrice: r.compare_price === null ? null : Number(r.compare_price),
  stock: r.stock, image: r.image || '', active: !!r.active, createdAt: r.created_at, updatedAt: r.updated_at,
});
const publicProduct = (p) => ({
  id: p.id, name: p.name, category: p.category, price: p.price, comparePrice: p.comparePrice,
  description: p.description, image: p.image, stock: p.stock, createdAt: p.createdAt, sold: p.sold || 0,
});

async function loadOrders(whereSql = '', params = [], conn = pool) {
  const rows = await q(`SELECT * FROM orders ${whereSql}`.replace(/( FOR UPDATE)?$/, (m) => ` ORDER BY seq DESC${m}`), params, conn);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const items = await q('SELECT * FROM order_items WHERE order_id IN (?) ORDER BY id', [ids], conn);
  const hist = await q('SELECT * FROM order_history WHERE order_id IN (?) ORDER BY id', [ids], conn);
  return rows.map((r) => ({
    id: r.id, number: r.number, createdAt: r.created_at, updatedAt: r.updated_at,
    customer: { name: r.customer_name, email: r.email, phone: r.phone, address: r.address, city: r.city, province: r.province, postalCode: r.postal_code },
    items: items.filter((i) => i.order_id === r.id).map((i) => ({
      productId: i.product_id, name: i.name, sku: i.sku, price: Number(i.price), qty: i.qty, lineTotal: Number(i.line_total), image: i.image,
    })),
    subtotal: Number(r.subtotal), shippingFee: Number(r.shipping_fee), total: Number(r.total),
    paymentMethod: { id: r.payment_method_id, name: r.payment_method_name, instructions: r.payment_instructions || '' },
    paymentStatus: r.payment_status, paymentReference: r.payment_reference || '', status: r.status,
    notes: r.notes || '', adminNote: r.admin_note || '', restocked: !!r.restocked,
    history: hist.filter((x) => x.order_id === r.id).map((x) => ({ at: x.at, text: x.text })),
  }));
}
const publicOrder = (o) => ({
  number: o.number, createdAt: o.createdAt, status: o.status, paymentStatus: o.paymentStatus,
  paymentMethod: o.paymentMethod, paymentReference: o.paymentReference,
  customer: { name: o.customer.name, email: o.customer.email },
  items: o.items.map(({ name, price, qty, lineTotal, image }) => ({ name, price, qty, lineTotal, image })),
  subtotal: o.subtotal, shippingFee: o.shippingFee, total: o.total, history: o.history,
});

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------- app setup
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));

const h = (fn) => (req, res, next) => {
  try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); }
};

// ---------------------------------------------------------------- admin sessions
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
async function getSession(req) {
  const token = getCookie(req, 'admin_session');
  if (!token) return null;
  const rows = await q(
    `SELECT a.id, a.username, a.name, a.password_hash, a.is_demo, s.expires_at FROM admin_sessions s
     JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    [sha256(token), new Date()],
  );
  if (!rows.length) return null;
  // Sliding expiry: extend short sessions while they're in use
  const next = new Date(Date.now() + SESSION_TTL);
  if (rows[0].expires_at < next) await q('UPDATE admin_sessions SET expires_at = ? WHERE token_hash = ?', [next, sha256(token)]);
  return rows[0];
}
const requireAdmin = h(async (req, res, next) => {
  const admin = await getSession(req);
  if (!admin) return res.status(401).json({ error: 'Please log in.' });
  req.admin = admin;
  next();
});
const usesDemoPassword = (admin) => !!admin.is_demo && verifyPassword(DEMO_PASS, admin.password_hash);

// ---------------------------------------------------------------- pages
app.get('/admin', h(async (req, res) => {
  if (!(await getSession(req))) return res.redirect('/login');
  res.sendFile(path.join(ROOT, 'public', 'admin.html'));
}));
app.get('/admin.html', (req, res) => res.redirect('/admin'));
app.get('/login', h(async (req, res) => {
  if (await getSession(req)) return res.redirect('/admin');
  res.sendFile(path.join(ROOT, 'public', 'login.html'));
}));
app.get('/login.html', (req, res) => res.redirect('/login'));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// ---------------------------------------------------------------- uploads
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, uid() + MIME_EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(MIME_EXT[file.mimetype] ? null : new HttpError(400, 'Image must be PNG, JPG, GIF or WEBP.'), !!MIME_EXT[file.mimetype]),
});
function removeImage(image) {
  if (image && image.startsWith('/uploads/')) fs.unlink(path.join(UPLOAD_DIR, path.basename(image)), () => {});
}

function readProductInput(body, existing = {}) {
  const pick = (k) => (body[k] !== undefined ? body[k] : existing[k]);
  const name = str(pick('name'), 120);
  if (!name) fail(400, 'Product name is required.');
  const price = toMoney(pick('price'));
  if (price === null || Number.isNaN(price) || price < 0) fail(400, 'Enter a valid price.');
  let comparePrice = toMoney(pick('comparePrice'));
  if (Number.isNaN(comparePrice) || (comparePrice !== null && comparePrice < 0)) fail(400, 'Enter a valid compare-at price.');
  if (comparePrice !== null && comparePrice <= price) comparePrice = null;
  const stock = Number(pick('stock') ?? 0);
  if (!Number.isInteger(stock) || stock < 0) fail(400, 'Stock must be a whole number (0 or more).');
  const activeRaw = pick('active');
  const active = activeRaw === undefined ? true : (activeRaw === true || activeRaw === 'true' || activeRaw === 'on');
  return {
    name, price, comparePrice, stock, active,
    sku: str(pick('sku'), 60),
    category: str(pick('category'), 60) || 'General',
    description: str(pick('description'), 3000),
  };
}
const productRow = (d) => ({
  name: d.name, price: d.price, compare_price: d.comparePrice, stock: d.stock, active: d.active ? 1 : 0,
  sku: d.sku, category: d.category, description: d.description,
});

// ================================================================ PUBLIC API
app.get('/api/store', h(async (req, res) => {
  const s = await getSettings();
  res.json({
    storeName: s.storeName, tagline: s.tagline, currency: s.currency, shippingFee: s.shippingFee,
    contactEmail: s.contactEmail, contactPhone: s.contactPhone, heroSlides: s.heroSlides,
    paymentMethods: s.paymentMethods.map(({ id, name, instructions }) => ({ id, name, instructions })),
  });
}));

app.get('/api/products', h(async (req, res) => {
  const rows = await q('SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC, name');
  const sold = await q(`SELECT oi.product_id, SUM(oi.qty) AS n FROM order_items oi
    JOIN orders o ON o.id = oi.order_id WHERE o.status <> 'cancelled' GROUP BY oi.product_id`);
  const soldBy = Object.fromEntries(sold.map((r) => [r.product_id, Number(r.n)]));
  res.json(rows.map(toProduct).map((p) => publicProduct({ ...p, sold: soldBy[p.id] || 0 })));
}));

app.get('/api/products/:id', h(async (req, res) => {
  const rows = await q('SELECT * FROM products WHERE id = ? AND active = 1', [req.params.id]);
  if (!rows.length) fail(404, 'Product not found.');
  res.json(publicProduct(toProduct(rows[0])));
}));

app.post('/api/orders', h(async (req, res) => {
  const { customer = {}, items = [], paymentMethod, notes } = req.body || {};
  const c = {
    name: str(customer.name, 120), email: str(customer.email, 160).toLowerCase(), phone: str(customer.phone, 40),
    address: str(customer.address, 300), city: str(customer.city, 80), province: str(customer.province, 80),
    postalCode: str(customer.postalCode, 20),
  };
  const missing = [['name', 'Full name'], ['email', 'Email'], ['phone', 'Mobile number'], ['address', 'Address'], ['city', 'City']]
    .filter(([k]) => !c[k]).map(([, label]) => label);
  if (missing.length) fail(400, `Please fill in: ${missing.join(', ')}.`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) fail(400, 'Please enter a valid email address.');

  if (!Array.isArray(items) || !items.length) fail(400, 'Your cart is empty.');
  const qtyById = new Map();
  for (const it of items) {
    const qty = Number(it && it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) fail(400, 'Invalid quantity in cart.');
    qtyById.set(String(it.productId), (qtyById.get(String(it.productId)) || 0) + qty);
  }

  const settings = await getSettings();
  const pm = settings.paymentMethods.find((m) => m.id === paymentMethod);
  if (!pm) fail(400, 'Please choose a payment method.');

  const orderId = await withTransaction(async (conn) => {
    // Lock the products so two buyers can't take the last item at the same time
    const rows = await q('SELECT * FROM products WHERE id IN (?) AND active = 1 FOR UPDATE', [[...qtyById.keys()]], conn);
    const lines = [];
    for (const [productId, qty] of qtyById) {
      const r = rows.find((x) => x.id === productId);
      if (!r) fail(409, 'An item in your cart is no longer available. Please review your cart.');
      const p = toProduct(r);
      if (p.stock < qty) fail(409, p.stock === 0 ? `"${p.name}" is sold out.` : `Only ${p.stock} left of "${p.name}". Please update your cart.`);
      lines.push({ productId: p.id, name: p.name, sku: p.sku, price: p.price, qty, lineTotal: round2(p.price * qty), image: p.image });
    }
    for (const l of lines) await q('UPDATE products SET stock = stock - ? WHERE id = ?', [l.qty, l.productId], conn);

    const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const shippingFee = round2(settings.shippingFee || 0);
    const t = new Date();
    const id = uid();
    const ins = await q('INSERT INTO orders SET ?', [{
      id, customer_name: c.name, email: c.email, phone: c.phone, address: c.address, city: c.city,
      province: c.province, postal_code: c.postalCode, subtotal, shipping_fee: shippingFee, total: round2(subtotal + shippingFee),
      payment_method_id: pm.id, payment_method_name: pm.name, payment_instructions: pm.instructions,
      payment_status: 'unpaid', payment_reference: '', status: 'pending', notes: str(notes, 1000), admin_note: '',
      restocked: 0, created_at: t, updated_at: t,
    }], conn);
    await q('UPDATE orders SET number = ? WHERE id = ?', [`ORD-${ins.insertId}`, id], conn);
    await q('INSERT INTO order_items (order_id, product_id, name, sku, price, qty, line_total, image) VALUES ?',
      [lines.map((l) => [id, l.productId, l.name, l.sku, l.price, l.qty, l.lineTotal, l.image])], conn);
    await q('INSERT INTO order_history (order_id, at, text) VALUES (?, ?, ?)', [id, t, 'Order placed'], conn);
    return id;
  });

  const [order] = await loadOrders('WHERE id = ?', [orderId]);
  res.status(201).json(publicOrder(order));
}));

async function findOrderForCustomer(number, email) {
  const [o] = await loadOrders('WHERE number = ? AND email = ?', [str(number, 20).toUpperCase(), str(email, 160).toLowerCase()]);
  if (!o) fail(404, 'No order found with that order number and email.');
  return o;
}

app.post('/api/orders/track', h(async (req, res) => {
  const { number, email } = req.body || {};
  res.json(publicOrder(await findOrderForCustomer(number, email)));
}));

app.post('/api/orders/reference', h(async (req, res) => {
  const { number, email, reference } = req.body || {};
  const o = await findOrderForCustomer(number, email);
  const ref = str(reference, 100);
  if (!ref) fail(400, 'Please enter your payment reference number.');
  if (o.status === 'cancelled') fail(400, 'This order was cancelled.');
  const t = new Date();
  await q('UPDATE orders SET payment_reference = ?, updated_at = ? WHERE id = ?', [ref, t, o.id]);
  await q('INSERT INTO order_history (order_id, at, text) VALUES (?, ?, ?)', [o.id, t, `Customer submitted payment reference: ${ref}`]);
  res.json(publicOrder(await findOrderForCustomer(number, email)));
}));

// ================================================================ AUTH
const loginAttempts = new Map();

app.get('/api/auth/demo', h(async (req, res) => {
  // Show demo credentials on the login page only while the demo account still uses its default password
  const rows = await q('SELECT username, password_hash, is_demo FROM admins WHERE is_demo = 1 LIMIT 1');
  if (rows.length && usesDemoPassword(rows[0])) return res.json({ show: true, username: rows[0].username, password: DEMO_PASS });
  res.json({ show: false });
}));

app.post('/api/auth/login', h(async (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (a.until > Date.now()) fail(429, 'Too many attempts. Try again in a few minutes.');
  const { username, password, remember } = req.body || {};
  const [admin] = await q('SELECT * FROM admins WHERE username = ?', [str(username, 60)]);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    a.count += 1;
    if (a.count >= 8) { a.until = Date.now() + 10 * 60 * 1000; a.count = 0; }
    loginAttempts.set(ip, a);
    fail(401, 'Incorrect username or password.');
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  const t = new Date();
  const ttl = remember ? 30 * 24 * 60 * 60 * 1000 : SESSION_TTL;
  await q('DELETE FROM admin_sessions WHERE expires_at < ?', [t]);
  await q('INSERT INTO admin_sessions SET ?', [{ token_hash: sha256(token), admin_id: admin.id, expires_at: new Date(Date.now() + ttl), created_at: t }]);
  await q('UPDATE admins SET last_login_at = ? WHERE id = ?', [t, admin.id]);
  res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; Path=/; SameSite=Lax${remember ? `; Max-Age=${ttl / 1000}` : ''}`);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', h(async (req, res) => {
  const token = getCookie(req, 'admin_session');
  if (token) await q('DELETE FROM admin_sessions WHERE token_hash = ?', [sha256(token)]);
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
}));

// ================================================================ ADMIN API
app.use('/api/admin', requireAdmin);

app.get('/api/admin/me', (req, res) => res.json({
  username: req.admin.username, name: req.admin.name, defaultPassword: usesDemoPassword(req.admin),
}));

app.get('/api/admin/stats', h(async (req, res) => {
  const [pc] = await q('SELECT COUNT(*) AS total, COALESCE(SUM(active),0) AS active, COALESCE(SUM(stock = 0),0) AS outOfStock FROM products');
  const low = await q('SELECT id, name, stock FROM products WHERE stock <= ? ORDER BY stock, name', [LOW_STOCK]);
  const statusRows = await q('SELECT status, COUNT(*) AS n FROM orders GROUP BY status');
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, Number((statusRows.find((r) => r.status === s) || {}).n || 0)]));
  const [sums] = await q(`SELECT
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN payment_status = 'unpaid' THEN total END), 0) AS awaiting,
      COALESCE(SUM(payment_status = 'unpaid'), 0) AS awaitingCount
    FROM orders WHERE status <> 'cancelled'`);
  const [{ n: orderCount }] = await q('SELECT COUNT(*) AS n FROM orders');
  const recent = await q('SELECT id, number, created_at, customer_name, total, status, payment_status FROM orders ORDER BY seq DESC LIMIT 6');
  res.json({
    products: Number(pc.total), activeProducts: Number(pc.active), outOfStock: Number(pc.outOfStock),
    lowStock: low.map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
    orders: Number(orderCount), byStatus,
    revenue: round2(sums.revenue), awaitingPayment: round2(sums.awaiting), awaitingPaymentCount: Number(sums.awaitingCount),
    recentOrders: recent.map((o) => ({
      id: o.id, number: o.number, createdAt: o.created_at, customer: o.customer_name,
      total: Number(o.total), status: o.status, paymentStatus: o.payment_status,
    })),
    lowStockThreshold: LOW_STOCK,
  });
}));

// ---- products
app.get('/api/admin/products', h(async (req, res) => {
  res.json((await q('SELECT * FROM products ORDER BY created_at DESC, name')).map(toProduct));
}));

app.post('/api/admin/products', upload.single('image'), h(async (req, res) => {
  try {
    const data = readProductInput(req.body || {});
    const t = new Date();
    const id = uid();
    await q('INSERT INTO products SET ?', [{ id, ...productRow(data), image: req.file ? `/uploads/${req.file.filename}` : '', created_at: t, updated_at: t }]);
    const [row] = await q('SELECT * FROM products WHERE id = ?', [id]);
    res.status(201).json(toProduct(row));
  } catch (e) {
    if (req.file) removeImage(`/uploads/${req.file.filename}`);
    throw e;
  }
}));

app.put('/api/admin/products/:id', upload.single('image'), h(async (req, res) => {
  try {
    const [row] = await q('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!row) fail(404, 'Product not found.');
    const p = toProduct(row);
    const data = readProductInput(req.body || {}, p);
    let image = p.image;
    if (req.file) { removeImage(p.image); image = `/uploads/${req.file.filename}`; }
    else if (req.body.removeImage === 'true') { removeImage(p.image); image = ''; }
    await q('UPDATE products SET ? WHERE id = ?', [{ ...productRow(data), image, updated_at: new Date() }, p.id]);
    const [updated] = await q('SELECT * FROM products WHERE id = ?', [p.id]);
    res.json(toProduct(updated));
  } catch (e) {
    if (req.file) removeImage(`/uploads/${req.file.filename}`);
    throw e;
  }
}));

app.patch('/api/admin/products/:id/stock', h(async (req, res) => {
  const stock = Number(req.body && req.body.stock);
  if (!Number.isInteger(stock) || stock < 0) fail(400, 'Stock must be a whole number (0 or more).');
  const r = await q('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?', [stock, new Date(), req.params.id]);
  if (!r.affectedRows) fail(404, 'Product not found.');
  const [row] = await q('SELECT * FROM products WHERE id = ?', [req.params.id]);
  res.json(toProduct(row));
}));

app.delete('/api/admin/products/:id', h(async (req, res) => {
  const [row] = await q('SELECT image FROM products WHERE id = ?', [req.params.id]);
  if (!row) fail(404, 'Product not found.');
  await q('DELETE FROM products WHERE id = ?', [req.params.id]);
  removeImage(row.image);
  res.json({ ok: true });
}));

// ---- orders
app.get('/api/admin/orders', h(async (req, res) => res.json(await loadOrders())));

app.patch('/api/admin/orders/:id', h(async (req, res) => {
  const { status, paymentStatus, adminNote } = req.body || {};
  await withTransaction(async (conn) => {
    const [o] = await loadOrders('WHERE id = ? FOR UPDATE', [req.params.id], conn);
    if (!o) fail(404, 'Order not found.');
    const t = new Date();
    const history = [];
    const changes = { updated_at: t };

    if (status !== undefined && status !== o.status) {
      if (!ORDER_STATUSES.includes(status)) fail(400, 'Invalid order status.');
      if (status === 'cancelled' && !o.restocked) {
        for (const l of o.items) await q('UPDATE products SET stock = stock + ? WHERE id = ?', [l.qty, l.productId], conn);
        changes.restocked = 1;
        history.push('Items returned to inventory');
      } else if (o.status === 'cancelled' && o.restocked) {
        for (const l of o.items) {
          const [p] = await q('SELECT stock FROM products WHERE id = ? FOR UPDATE', [l.productId], conn);
          if (p && p.stock < l.qty) fail(409, `Not enough stock of "${l.name}" to re-open this order (${p.stock} left).`);
        }
        for (const l of o.items) await q('UPDATE products SET stock = stock - ? WHERE id = ?', [l.qty, l.productId], conn);
        changes.restocked = 0;
        history.push('Items deducted from inventory again');
      }
      history.push(`Status changed: ${o.status} → ${status}`);
      changes.status = status;
    }
    if (paymentStatus !== undefined && paymentStatus !== o.paymentStatus) {
      if (!PAYMENT_STATUSES.includes(paymentStatus)) fail(400, 'Invalid payment status.');
      history.push(`Payment marked ${paymentStatus}`);
      changes.payment_status = paymentStatus;
    }
    if (adminNote !== undefined) changes.admin_note = str(adminNote, 2000);
    await q('UPDATE orders SET ? WHERE id = ?', [changes, o.id], conn);
    for (const text of history) await q('INSERT INTO order_history (order_id, at, text) VALUES (?, ?, ?)', [o.id, t, text], conn);
  });
  const [updated] = await loadOrders('WHERE id = ?', [req.params.id]);
  res.json(updated);
}));

// ---- sales report
app.get('/api/admin/reports/sales', h(async (req, res) => {
  const from = new Date(String(req.query.from || ''));
  const to = new Date(String(req.query.to || ''));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) fail(400, 'Choose a valid date range.');
  if (to - from > 1000 * 60 * 60 * 24 * 1100) fail(400, 'Date range is too long (max 3 years).');
  const orders = await q(`SELECT id, number, created_at, status, payment_status, payment_method_name, payment_reference,
      customer_name, email, phone, city, province, subtotal, shipping_fee, total
    FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at`, [from, to]);
  const items = orders.length ? await q(`SELECT oi.order_id, oi.product_id, oi.name, oi.sku, oi.price, oi.qty, oi.line_total,
      COALESCE(p.category, 'Other') AS category
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id IN (?)`, [orders.map((o) => o.id)]) : [];
  res.json({
    from, to,
    orders: orders.map((o) => ({
      id: o.id, number: o.number, createdAt: o.created_at, status: o.status, paymentStatus: o.payment_status,
      paymentMethod: o.payment_method_name, paymentReference: o.payment_reference,
      customer: o.customer_name, email: o.email, phone: o.phone, city: [o.city, o.province].filter(Boolean).join(', '),
      subtotal: Number(o.subtotal), shippingFee: Number(o.shipping_fee), total: Number(o.total),
      items: items.filter((i) => i.order_id === o.id).map((i) => ({
        productId: i.product_id, name: i.name, sku: i.sku, category: i.category, price: Number(i.price), qty: i.qty, lineTotal: Number(i.line_total),
      })),
    })),
  });
}));

// ---- settings
app.get('/api/admin/settings', h(async (req, res) => res.json(await getSettings())));

app.put('/api/admin/settings', h(async (req, res) => {
  const b = req.body || {};
  const storeName = str(b.storeName, 80);
  if (!storeName) fail(400, 'Store name is required.');
  const shippingFee = toMoney(b.shippingFee ?? 0);
  if (shippingFee === null || Number.isNaN(shippingFee) || shippingFee < 0) fail(400, 'Enter a valid shipping fee.');
  const methods = (Array.isArray(b.paymentMethods) ? b.paymentMethods : [])
    .map((m) => ({ id: str(m.id, 40) || uid(), name: str(m.name, 60), instructions: str(m.instructions, 1500) }))
    .filter((m) => m.name);
  if (!methods.length) fail(400, 'Add at least one payment method.');
  const ids = new Set();
  for (const m of methods) { while (ids.has(m.id)) m.id = uid(); ids.add(m.id); }
  const heroSlides = (Array.isArray(b.heroSlides) ? b.heroSlides : []).slice(0, 6).map((x) => ({
    eyebrow: str(x.eyebrow, 40), title: str(x.title, 80), subtitle: str(x.subtitle, 200),
    buttonText: str(x.buttonText, 30), target: str(x.target, 60),
  })).filter((x) => x.title);
  const s = {
    storeName, shippingFee, paymentMethods: methods, heroSlides,
    tagline: str(b.tagline, 200), currency: str(b.currency, 5) || '₱',
    contactEmail: str(b.contactEmail, 160), contactPhone: str(b.contactPhone, 40),
  };
  await saveSettings(s);
  res.json(s);
}));

app.post('/api/admin/password', h(async (req, res) => {
  const { currentPassword, newPassword, username } = req.body || {};
  const [admin] = await q('SELECT * FROM admins WHERE id = ?', [req.admin.id]);
  if (!verifyPassword(currentPassword, admin.password_hash)) fail(400, 'Current password is incorrect.');
  if (String(newPassword || '').length < 8) fail(400, 'New password must be at least 8 characters.');
  const newUsername = str(username, 60) || admin.username;
  if (newUsername !== admin.username && (await q('SELECT 1 FROM admins WHERE username = ? AND id <> ?', [newUsername, admin.id])).length) {
    fail(400, 'That username is already taken.');
  }
  await q('UPDATE admins SET username = ?, password_hash = ? WHERE id = ?', [newUsername, hashPassword(newPassword), admin.id]);
  res.json({ ok: true, username: newUsername });
}));

// ---------------------------------------------------------------- errors
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller.' : err.message });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message });
});

// ---------------------------------------------------------------- start
if (process.argv.includes('--seed-samples')) {
  initDb()
    .then(() => seedSampleProducts(process.argv.includes('--refresh-images')))
    .then(({ added, updated }) => {
      console.log(`Sample products: ${added} added, ${updated} existing product(s) given a photo.`);
      process.exit(0);
    })
    .catch((e) => { console.error('Seeding failed:', e.code || '', e.message); process.exit(1); });
} else initDb()
  .then(async () => {
    const s = await getSettings();
    app.listen(PORT, () => {
      console.log(`\n  ${s.storeName} is running (MySQL database: ${new URL(DATABASE_URL).pathname.slice(1)})`);
      console.log(`  Storefront:   http://localhost:${PORT}/`);
      console.log(`  Admin login:  http://localhost:${PORT}/login\n`);
    });
  })
  .catch((e) => {
    console.error('\nCould not start: ', e.code || '', e.message);
    console.error('Check DATABASE_URL in your .env file and make sure MySQL is running.\n');
    process.exit(1);
  });
