const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { db, seedData } = require('./database');

const app = express();
// Increased body limit to support testing native file uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = 'ecommerce-qa-secret-2026';
let guestCarts = {};

const SERVICEABLE_PINCODES = {
  '560001': { city: 'Bengaluru', days: 1, deliverable: true },
  '110001': { city: 'New Delhi', days: 2, deliverable: true },
  '400001': { city: 'Mumbai', days: 2, deliverable: true },
  '673001': { city: 'Kozhikode', days: 3, deliverable: true }
};

const VALID_COUPONS = {
  'SAVE10': { type: 'PERCENT', value: 10, minCart: 500 },
  'FLAT500': { type: 'FLAT', value: 500, minCart: 2000 }
};

// Token Verification Middleware
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Please log in to proceed with your transaction.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
};

// ==========================================
// 1. AUTHENTICATION APIS
// ==========================================
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Full name must be at least 2 characters long.' });
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) return res.status(400).json({ error: 'Please provide a valid email address.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (existing) return res.status(409).json({ error: 'An account with this email address already exists.' });

  const userId = 'usr-' + Date.now();
  db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)').run(userId, name.trim(), email.trim().toLowerCase(), password);
  const token = jwt.sign({ id: userId, email: email.trim().toLowerCase(), name: name.trim() }, JWT_SECRET, { expiresIn: '6h' });
  res.status(201).json({ message: 'Registration successful', token, user: { id: userId, email: email.trim().toLowerCase(), name: name.trim() } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Both email and password are required.' });

  const user = db.prepare('SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?) AND password = ?').get(email.trim(), password);
  if (!user) return res.status(401).json({ error: 'Incorrect email or password. Please verify your credentials.' });

  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '6h' });
  res.json({ message: 'Login successful', token, user });
});

// ==========================================
// 2. CATALOG & DETAILS APIS
// ==========================================
app.get('/api/products', (req, res) => {
  const { category, query } = req.query;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];

  if (category) { sql += ' AND LOWER(category) = LOWER(?)'; params.push(category); }
  if (query) { sql += ' AND LOWER(name) LIKE LOWER(?)'; params.push(`%${query}%`); }

  const rows = db.prepare(sql).all(...params).map(r => ({
    ...r,
    inStock: Boolean(r.in_stock),
    originalPrice: r.original_price
  }));
  res.json(rows);
});

app.get('/api/products/:id', (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Selected product does not exist.' });

    let reviews = [];
    try {
      reviews = db.prepare('SELECT * FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC').all(req.params.id);
    } catch {
      reviews = [];
    }

    res.json({
      ...product,
      inStock: Boolean(product.in_stock),
      originalPrice: product.original_price,
      reviewsList: reviews
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve product details.' });
  }
});

// ==========================================
// 3. NATIVE FILE UPLOADS: PROFILE AVATAR / DOCUMENT
// ==========================================
app.post('/api/user/upload-avatar', auth, (req, res) => {
  const { filename, fileBase64, mimeType } = req.body;
  if (!filename || !fileBase64) {
    return res.status(400).json({ error: 'No file data received. Please select a valid file to upload.' });
  }

  // Validate supported extensions
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'text/plain'];
  if (mimeType && !allowed.includes(mimeType)) {
    return res.status(415).json({ error: 'Unsupported Media Type. Upload PNG, JPEG, WEBP or TXT files only.' });
  }

  const fileSizeApprox = Math.round((fileBase64.length * 3) / 4);
  if (fileSizeApprox > 5 * 1024 * 1024) {
    return res.status(413).json({ error: 'File size exceeds maximum threshold of 5MB.' });
  }

  res.status(200).json({
    message: 'Avatar uploaded and processed successfully!',
    file: {
      originalName: filename,
      mimeType: mimeType || 'application/octet-stream',
      sizeBytes: fileSizeApprox,
      uploadedAt: new Date().toISOString()
    }
  });
});

// ==========================================
// 4. NATIVE FILE DOWNLOAD: DYNAMIC ORDER INVOICE
// ==========================================
app.get('/api/orders/:orderId/invoice', (req, res) => {
  const { orderId } = req.params;
  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
  if (!order) return res.status(404).send('Invoice not found for the requested order ID');

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

  // Generate plain-text structured invoice file for download validation
  const invoiceContent = [
    '====================================================',
    '                 BAZAAR ENTERPRISE INVOICE          ',
    '====================================================',
    `Invoice / Order ID : ${order.order_id}`,
    `Customer Name      : ${order.customer_name}`,
    `Customer Email     : ${order.user_email}`,
    `Delivery Pincode   : ${order.delivery_pincode}`,
    `Payment Instrument : ${order.paid_with}`,
    `Status             : ${order.status}`,
    `Date Generated     : ${new Date().toISOString()}`,
    '----------------------------------------------------',
    'PURCHASED LINE ITEMS:',
    ...items.map((item, idx) => `  ${idx + 1}. ${item.product_name} x ${item.quantity} = ₹${item.price * item.quantity}`),
    '----------------------------------------------------',
    `Subtotal           : ₹${order.subtotal}`,
    `Discount Applied   : -₹${order.discount || 0}`,
    `Total Amount Paid  : ₹${order.total_amount}`,
    '====================================================',
    'Thank you for shopping with Bazaar!'
  ].join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Invoice-${order.order_id}.txt"`);
  res.status(200).send(invoiceContent);
});

// ==========================================
// 5. GATEWAY SIMULATION (FOR ROUTE ABORT & MOCKING)
// ==========================================
app.post('/api/checkout/gateway-handshake', (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid transaction amount' });

  // Playwright tests can intercept or abort this URL:
  // e.g. await page.route('**/gateway-handshake', route => route.abort('connectionfailed'))
  res.json({
    gatewayStatus: 'ONLINE',
    sessionToken: 'gw_tok_' + Math.random().toString(36).substring(2),
    timestamp: Date.now()
  });
});

// ==========================================
// 6. SHIPPING PINCODE CHECKER
// ==========================================
app.get('/api/shipping/check-pincode/:pincode', (req, res) => {
  const { pincode } = req.params;
  if (!/^\d{6}$/.test(pincode)) {
    return res.status(400).json({ deliverable: false, message: 'Please enter a valid 6-digit numeric postal code.' });
  }

  const info = SERVICEABLE_PINCODES[pincode];
  if (info) {
    return res.json({ deliverable: true, city: info.city, message: `Delivery available to ${info.city} in ${info.days} day(s)` });
  }
  return res.json({ deliverable: false, message: 'Delivery currently unavailable to this pincode.' });
});

// ==========================================
// 7. CART & COUPON APIS
// ==========================================
app.get('/api/cart', (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default-guest';
  res.json(guestCarts[sessionId] || { items: [], total: 0 });
});

app.post('/api/cart/add', (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default-guest';
  const { productId, quantity = 1 } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);

  if (!product) return res.status(404).json({ error: 'Item not found in catalog.' });
  if (!product.in_stock && quantity > 0) return res.status(400).json({ error: 'Selected item is currently out of stock.' });

  if (!guestCarts[sessionId]) guestCarts[sessionId] = { items: [], total: 0 };
  const existing = guestCarts[sessionId].items.find(i => i.id === productId);

  if (existing) {
    existing.quantity += quantity;
    if (existing.quantity <= 0) {
      guestCarts[sessionId].items = guestCarts[sessionId].items.filter(i => i.id !== productId);
    }
  } else if (quantity > 0) {
    guestCarts[sessionId].items.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      quantity
    });
  }

  guestCarts[sessionId].total = guestCarts[sessionId].items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  res.json(guestCarts[sessionId]);
});

app.post('/api/cart/apply-coupon', (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default-guest';
  const { couponCode } = req.body;
  const cart = guestCarts[sessionId];

  if (!cart || cart.items.length === 0) return res.status(400).json({ error: 'Your basket is empty. Add products before applying coupons.' });

  const code = (couponCode || '').trim().toUpperCase();
  const coupon = VALID_COUPONS[code];
  if (!coupon) return res.status(404).json({ error: 'Invalid coupon code. Valid promo codes: SAVE10 or FLAT500' });

  if (cart.total < coupon.minCart) {
    return res.status(400).json({ error: `Coupon ${code} requires a minimum cart amount of ₹${coupon.minCart}. Current subtotal: ₹${cart.total}` });
  }

  let discount = coupon.type === 'PERCENT' ? Math.round((cart.total * coupon.value) / 100) : coupon.value;
  const finalAmount = Math.max(0, cart.total - discount);

  res.json({
    couponApplied: code,
    subtotal: cart.total,
    discount,
    finalAmount,
    message: `Coupon ${code} applied successfully!`
  });
});

// ==========================================
// 8. CHECKOUT & ORDERS APIS
// ==========================================
app.post('/api/checkout/pay', auth, (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default-guest';
  const { cardNumber, expiry, cvv, cardHolder, pincode, couponCode } = req.body;
  const cart = guestCarts[sessionId];

  if (!cart || cart.items.length === 0) return res.status(400).json({ error: 'Your cart is empty. Please add items before checking out.' });

  const cleanPin = (pincode || '').trim();
  if (!/^\d{6}$/.test(cleanPin)) return res.status(400).json({ error: 'A valid 6-digit delivery pincode is required.' });

  if (!cardHolder || cardHolder.trim().length < 3) return res.status(422).json({ error: 'Please enter the full cardholder name (minimum 3 characters).' });

  const cleanCard = (cardNumber || '').replace(/[\s-]/g, '');
  if (!/^\d{16}$/.test(cleanCard)) return res.status(422).json({ error: 'Invalid card number. Please provide a standard 16-digit card number.' });

  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry || '')) return res.status(422).json({ error: 'Invalid expiry format. Format must be MM/YY.' });
  const [expMonth, expYear] = expiry.split('/').map(n => parseInt(n, 10));
  const fullExpYear = 2000 + expYear;
  const now = new Date();
  if (fullExpYear < now.getFullYear() || (fullExpYear === now.getFullYear() && expMonth < (now.getMonth() + 1))) {
    return res.status(422).json({ error: 'Card has expired. Please use an active card.' });
  }

  const cleanCvv = (cvv || '').trim();
  if (!/^\d{3,4}$/.test(cleanCvv)) return res.status(422).json({ error: 'Invalid security code (CVV). Must be 3 or 4 numeric digits.' });

  let discount = 0;
  if (couponCode && VALID_COUPONS[couponCode.toUpperCase()]) {
    const coupon = VALID_COUPONS[couponCode.toUpperCase()];
    if (cart.total >= coupon.minCart) {
      discount = coupon.type === 'PERCENT' ? Math.round((cart.total * coupon.value) / 100) : coupon.value;
    }
  }

  const finalTotal = Math.max(0, cart.total - discount);
  const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  const paidWith = `CARD ending with ${cleanCard.slice(-4)}`;

  try {
    const executeOrder = db.transaction(() => {
      db.prepare(`
        INSERT INTO orders (order_id, user_id, user_email, customer_name, subtotal, discount, total_amount, coupon_applied, delivery_pincode, paid_with, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID_CONFIRMED')
      `).run(orderId, req.user.id, req.user.email, req.user.name, cart.total, discount, finalTotal, couponCode || null, cleanPin, paidWith);

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const item of cart.items) {
        insertItem.run(orderId, item.id, item.name, item.quantity, item.price);
      }
    });

    executeOrder();
    delete guestCarts[sessionId];

    res.status(201).json({
      message: 'Payment authorized and order confirmed!',
      order: {
        orderId,
        customerName: req.user.name,
        user: req.user.email,
        subtotal: cart.total,
        discount,
        total: finalTotal,
        deliveryPincode: cleanPin,
        paidWith,
        status: 'PAID_CONFIRMED'
      }
    });
  } catch (dbErr) {
    res.status(500).json({ error: 'Transaction failed while processing database records. Please try again.' });
  }
});

app.get('/api/orders/my-orders', auth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const enriched = orders.map(ord => ({ ...ord, items: getItems.all(ord.order_id) }));
  res.json(enriched);
});

// ==========================================
// 9. REVIEWS APIS
// ==========================================
app.post('/api/products/:id/reviews', auth, (req, res) => {
  const productId = req.params.id;
  const { rating, comment } = req.body;
  const numRating = parseInt(rating);

  if (!numRating || numRating < 1 || numRating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5 stars.' });
  if (!comment || comment.trim().length < 5) return res.status(400).json({ error: 'Review comment must be at least 5 characters long.' });

  const purchase = db.prepare(`
    SELECT oi.id FROM order_items oi
    JOIN orders o ON oi.order_id = o.order_id
    WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'PAID_CONFIRMED'
    LIMIT 1
  `).get(req.user.id, productId);

  if (!purchase) {
    return res.status(403).json({ error: 'Verified Purchase Required: You can only review products you have bought.' });
  }

  const reviewTx = db.transaction(() => {
    db.prepare('INSERT INTO product_reviews (product_id, author, rating, comment) VALUES (?, ?, ?, ?)').run(productId, req.user.name, numRating, comment.trim());
    const stats = db.prepare('SELECT COUNT(*) as total_reviews, AVG(rating) as avg_rating FROM product_reviews WHERE product_id = ?').get(productId);
    const roundedRating = Math.round(stats.avg_rating * 10) / 10;
    db.prepare('UPDATE products SET rating = ?, reviews = ? WHERE id = ?').run(roundedRating, stats.total_reviews, productId);
    return { roundedRating, totalReviews: stats.total_reviews };
  });

  const updatedStats = reviewTx();
  const allReviews = db.prepare('SELECT * FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC').all(productId);

  res.status(201).json({
    message: 'Review verified and published!',
    newRating: updatedStats.roundedRating,
    totalReviews: updatedStats.totalReviews,
    reviewsList: allReviews
  });
});

// PUT /api/admin/products/:id/stock - Real-time stock updates for race-condition testing
app.put('/api/admin/products/:id/stock', (req, res) => {
  const { stock } = req.body;
  const numStock = parseInt(stock, 10);
  if (isNaN(numStock) || numStock < 0) {
    return res.status(400).json({ error: 'Stock must be a non-negative number.' });
  }

  const inStock = numStock > 0 ? 1 : 0;
  const result = db.prepare('UPDATE products SET stock = ?, in_stock = ? WHERE id = ?').run(numStock, inStock, req.params.id);

  if (result.changes === 0) return res.status(404).json({ error: 'Product not found.' });
  res.json({ message: 'Stock updated', productId: req.params.id, stock: numStock, inStock: Boolean(inStock) });
});

// ==========================================
// 10. SYSTEM RESET & EXPLICIT HTML ROUTES
// ==========================================
app.post('/api/test/reset', (req, res) => {
  db.exec(`
    DELETE FROM order_items;
    DELETE FROM orders;
    DELETE FROM users WHERE id != 'usr-1';
  `);
  seedData();
  guestCarts = {};
  res.json({ message: 'Database reset to default clean state.' });
});

// ==========================================
// 9B. QA AUTOMATION LAB ENDPOINTS (OTP, OAuth, Users, Pagination, PDF)
// ==========================================
let activeOtps = {};

// Topic #7: Network Interception target (/api/users)
app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT id, name, email FROM users').all();
  res.json(users.map((u, idx) => ({
    ...u,
    age: 26 + idx * 3,
    status: idx % 2 === 0 ? 'Active' : 'Inactive'
  })));
});

// Topic #9: Pagination API (/api/products/paginated?page=1&limit=4)
app.get('/api/products-paginated', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.max(1, parseInt(req.query.limit || '4', 10));
  const allProducts = db.prepare('SELECT * FROM products').all().map(r => ({
    ...r,
    inStock: Boolean(r.in_stock),
    originalPrice: r.original_price
  }));
  const totalPages = Math.ceil(allProducts.length / limit);
  const offset = (page - 1) * limit;
  const items = allProducts.slice(offset, offset + limit);

  res.json({ page, limit, totalPages, totalItems: allProducts.length, items });
});

// Topic #18: Email OTP Automation (Generates OTP & returns inbox preview for API/UI testing)
app.post('/api/auth/send-otp', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required to send OTP.' });
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  activeOtps[email.toLowerCase()] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 };
  res.json({ message: `OTP sent to ${email}`, mockInboxOtp: otp });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  const record = activeOtps[(email || '').toLowerCase()];
  if (!record || record.otp !== String(otp) || Date.now() > record.expiresAt) {
    return res.status(401).json({ error: 'Invalid or expired OTP.' });
  }
  delete activeOtps[email.toLowerCase()];
  const token = jwt.sign({ id: 'usr-otp', email, name: 'OTP Verified User' }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ message: 'OTP verified successfully!', token });
});

// Topic #19: OAuth Authentication Flow Simulation
app.get('/api/auth/oauth/mock-provider', (req, res) => {
  const redirectUri = req.query.redirect_uri || '/qa-lab.html';
  const mockCode = 'oauth_code_' + Date.now();
  res.redirect(`${redirectUri}?code=${mockCode}&provider=BazaarOAuth`);
});

app.post('/api/auth/oauth/exchange', (req, res) => {
  const { code } = req.body;
  if (!code || !code.startsWith('oauth_code_')) {
    return res.status(400).json({ error: 'Invalid OAuth authorization code.' });
  }
  const token = jwt.sign({ id: 'usr-oauth', email: 'oauth.user@bazaar.test', name: 'OAuth Shopper' }, JWT_SECRET, { expiresIn: '6h' });
  res.json({ message: 'OAuth login complete', token, user: { name: 'OAuth Shopper', email: 'oauth.user@bazaar.test' } });
});

// Topic #17: Valid Minimal PDF Download Endpoint for PDF Content Validation
app.get('/api/qa/sample-brochure.pdf', (req, res) => {
  const pdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 68 >> stream
BT /F1 18 Tf 50 700 Td (BAZAAR ENTERPRISE QA REPORT - VERIFIED) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000229 00000 n 
0000000347 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
417
%%EOF`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="bazaar-qa-brochure.pdf"');
  res.send(Buffer.from(pdfContent, 'utf-8'));
});


app.get('/product-details.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'product-details.html')));
app.get('/secure-checkout.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'secure-checkout.html')));
app.get('/advanced-catalog.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'advanced-catalog.html')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/qa-lab.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'qa-lab.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bazaar Enterprise Engine online at http://localhost:${PORT}`));