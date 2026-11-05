const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'ecommerce.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// 1. Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price INTEGER NOT NULL,
    original_price INTEGER NOT NULL,
    rating REAL NOT NULL,
    reviews INTEGER NOT NULL,
    stock INTEGER NOT NULL,
    in_stock INTEGER NOT NULL,
    image TEXT NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS product_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    subtotal INTEGER NOT NULL,
    discount INTEGER DEFAULT 0,
    total_amount INTEGER NOT NULL,
    coupon_applied TEXT,
    delivery_pincode TEXT NOT NULL,
    paid_with TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price INTEGER NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(order_id)
  );
`);

// 2. Seed Initial Data
const seedData = () => {
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password)
    VALUES (?, ?, ?, ?)
  `);
  insertUser.run('usr-1', 'Demo Shopper', 'shopper@test.com', 'Pass@123');

  const initialProducts = [
    [
      'prod-101', 'Wireless Noise Canceling Headphones', 'Electronics', 2999, 4999, 4.5, 1240, 12, 1, '🎧',
      'Over-ear premium headphones with active noise cancellation, 30-hour battery life, and spatial audio support.'
    ],
    [
      'prod-102', 'Cotton Oversized Graphic T-Shirt', 'Fashion', 499, 999, 4.1, 450, 3, 1, '👕',
      '100% combed cotton, breathable fabric with a relaxed modern streetwear fit.'
    ],
    [
      'prod-103', 'Stainless Steel Water Bottle 1L', 'Home', 699, 1200, 4.8, 890, 0, 0, '🍶',
      'Double-walled vacuum insulated flask keeps liquids chilled for 24h or hot for 12h.'
    ],
    [
      'prod-104', 'Ergonomic Mechanical Keyboard', 'Electronics', 3499, 5999, 4.6, 310, 8, 1, '⌨️',
      'Hot-swappable tactile brown switches, per-key RGB backlighting, and detachable Type-C braided cable.'
    ],
    [
      'prod-105', 'Smart Fitness Tracker Watch', 'Electronics', 1999, 3999, 4.3, 820, 15, 1, '⌚',
      'OLED display, 24/7 heart-rate monitor, sleep tracking, and IP68 waterproof rating.'
    ],
    [
      'prod-106', 'Canvas Casual Sneakers', 'Fashion', 1299, 2499, 4.2, 510, 9, 1, '👟',
      'Lightweight, durable vulcanized rubber sole with breathable canvas upper.'
    ],
    [
      'prod-107', 'Ceramic Non-Stick Coffee Mug', 'Home', 399, 799, 4.7, 230, 20, 1, '☕',
      'Matte finish ceramic mug with heat-insulating wooden coaster lid.'
    ],
    [
      'prod-108', 'Minimalist Leather Slim Wallet', 'Fashion', 799, 1499, 4.4, 380, 11, 1, '👛',
      'RFID-blocking genuine leather pocket wallet with 8 card slots.'
    ],
    [
      'prod-109', 'RGB Ergonomic Gaming Mouse', 'Electronics', 899, 1899, 4.5, 950, 14, 1, '🖱️',
      '12,800 DPI optical sensor with 6 programmable macro buttons.'
    ],
    [
      'prod-110', 'Aroma Diffuser & Humidifier', 'Home', 1199, 2199, 4.6, 410, 6, 1, '🕯️',
      'Ultrasonic cool mist humidifier with 7 ambient color LED night lights.'
    ]
  ];

  const insertProd = db.prepare(`
    INSERT OR REPLACE INTO products (id, name, category, price, original_price, rating, reviews, stock, in_stock, image, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runSeed = db.transaction((items) => {
    for (const item of items) insertProd.run(...item);
  });
  runSeed(initialProducts);

  // Seed sample reviews
  const insertReview = db.prepare(`
    INSERT OR IGNORE INTO product_reviews (id, product_id, author, rating, comment)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertReview.run(1, 'prod-101', 'Rahul Verma', 5, 'Bass is incredible, battery easily lasted my whole flight!');
  insertReview.run(2, 'prod-101', 'Priya S.', 4, 'Comfortable ear cups, mic could be slightly clearer on calls.');
  insertReview.run(3, 'prod-102', 'Aditya K.', 5, 'Great quality cloth and fits perfectly baggy.');
};

seedData();

module.exports = { db, seedData };