const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'ecommerce.db'));

console.log('\n--- 👥 USERS TABLE ---');
console.table(db.prepare('SELECT id, name, email FROM users').all());

console.log('\n--- 📦 PRODUCTS TABLE ---');
console.table(db.prepare('SELECT id, name, price, stock, in_stock FROM products').all());

console.log('\n--- 🛒 RECENT ORDERS ---');
console.table(db.prepare('SELECT order_id, user_email, subtotal, discount, total_amount, delivery_pincode, status FROM orders').all());

console.log('\n--- 📑 ORDER ITEMS ---');
console.table(db.prepare('SELECT * FROM order_items').all());

db.close();