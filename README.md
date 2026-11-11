# Online Store

A simple Shopify-style store with:

- **Storefront**: product catalog with categories and search, cart, checkout form, and order tracking
- **Admin login page** with a demo admin account
- **Admin portal**: add and edit products (photo, price, sale price, stock), manage inventory, process orders, and edit settings
- **Manual payments only**: customers choose a method you set up (GCash, bank transfer, COD…), see your instructions after ordering, and can submit their payment reference number. You mark orders as paid in the admin portal.
- **MySQL** database

## Setup (Windows)

1. Install **Node.js 18 or newer** from https://nodejs.org (LTS).
2. Make sure MySQL is running. Check the connection in `.env`:
   ```dotenv
   DATABASE_URL="mysql://root:123700@localhost:3306/online_store"
   PORT=5050
   ```
   The `online_store` database and all tables are **created automatically** on first start.
3. Double-click `start.bat`, or run:
   ```
   npm install
   npm start
   ```
4. Open:
   - Store: http://localhost:5050/
   - Admin login: http://localhost:5050/login

### Demo admin

On first start (when the `admins` table is empty) a demo admin is created:

| Username | Password |
|---|---|
| `admin` | `admin123` |

The login page shows these demo credentials and a **Use demo login** button until the demo password is changed. Change it in **Admin → Settings → Admin login** before going live. You can choose different demo credentials with `DEMO_ADMIN_USERNAME` / `DEMO_ADMIN_PASSWORD` in `.env` (used only when the first admin is created).

## Storefront layout

The home page uses the full screen width and has:
- a top strip with your contact details, and a header with menu, search and cart
- a **hero slider** that shows product photos automatically
- a features strip (shipping, payment methods, secure checkout, order tracking)
- promo tiles for **Big Savings** and your top categories
- **Featured Products** with New Arrivals / Best Selling / On Sale tabs (Best Selling uses real order counts)
- two category banners, **Shop by Category**, and a full footer

There is also a **Shop** page with category sidebar, search and sorting (price, newest, biggest discount, name).

All of it is built from your products and settings, so it updates as you add items, set sale prices or change categories.
Discount labels (e.g. "17% OFF") are calculated from the compare-at price.

**Edit the slider:** go to **Admin → Settings → Homepage slider**. Each slide has a small label, headline, text, button and a "links to" target (sale items, new arrivals, all products or a category). The slide shows photos of the products it links to.

## Sample products

On first start, 12 sample products are added (apparel, accessories, footwear, electronics, home and stationery), each with a studio-style photo from `sample-data/images/`. Five of them have sale prices.

- If your database was set up before the samples existed, run `npm run seed:samples`. It adds missing samples and fills in missing photos, and it's safe to run more than once.
- To swap old sample photos for the latest ones, run `npm run seed:refresh-images`. Photos you uploaded yourself are never touched.

## Database tables

| Table | Holds |
|---|---|
| `admins` | Admin accounts (passwords are hashed with scrypt) |
| `admin_sessions` | Login sessions, so a server restart doesn't sign admins out |
| `settings` | Store name, shipping fee, payment methods (one JSON row) |
| `products` | Items, prices, stock |
| `orders` | Customer details, totals, payment and order status |
| `order_items` | Items in each order, with the name and price at the time of purchase |
| `order_history` | Timeline of what happened to each order |

Product photos are stored as files in `uploads/`. Back up the database and that folder together.

## Order flow

1. The customer adds items to the cart and checks out. They enter their name, email, mobile, address and payment method.
2. The order is created as **Pending / Unpaid** and stock is deducted in a database transaction with row locks, so two buyers can't take the last item at the same time.
3. The customer sees the payment instructions and their order number (e.g. `ORD-1001`). Later they can open **Track order** with that number and their email to check the status or submit a payment reference number.
4. In **Admin → Orders**, check the payment, set **Payment: Paid**, then move the status through Processing → Shipped → Completed.
5. Setting an order to **Cancelled** returns its items to inventory. Re-opening a cancelled order deducts them again.

## Notes

- To change the port, edit `PORT` in `.env` (and the URL in `start.bat`).
- `.env` holds your database password. It is excluded from git; `.env.example` is the template to share.
- Prices are always calculated on the server. The checkout never trusts prices sent from the browser.
- To deploy (e.g. Railway), set `DATABASE_URL` to the hosted MySQL URL and attach persistent storage for `uploads/`.
