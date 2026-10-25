require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { db, initDatabase, calculateDistance, updateExpiredListings } = require('./database/db');
const { sendOtpEmail } = require('./mailer');

// Ensure database tables exist
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'foodbridge-super-secret-key-2026';

// Hosting platforms (Render, Railway, etc.) sit behind a proxy; needed for secure cookies
if (IS_PROD) app.set('trust proxy', 1);

// OTP settings
const OTP_VALID_MS = 10 * 60 * 1000;   // OTP valid for 10 minutes
const OTP_RESEND_WAIT_MS = 30 * 1000;  // wait 30s before asking for a new OTP
const OTP_MAX_ATTEMPTS = 5;            // wrong tries allowed per OTP

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD
    }
  })
);

// Middleware to check authentication
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  next();
}

// Middleware to check role
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }
    if (req.session.user.role !== role) {
      return res.status(403).json({ error: `Forbidden. Only ${role.toUpperCase()} accounts can access this resource.` });
    }
    next();
  };
}

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

// ------------------------------------------
// Registration with email OTP (2 steps)
//   Step 1: /api/auth/register/send-otp   -> validates form, emails a 6-digit code
//   Step 2: /api/auth/register/verify-otp -> checks code, THEN creates the account
// ------------------------------------------

const USER_COLUMNS = 'id, role, name, email, phone, address, city, state, pincode, latitude, longitude, contact_person, org_type';

function hashOtp(email, otp) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`${email}:${otp}`).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Step 1: validate details and send OTP
app.post('/api/auth/register/send-otp', async (req, res) => {
  try {
    const {
      role, name, email, password, phone, address, city, state,
      pincode, latitude, longitude, contact_person, org_type
    } = req.body;

    if (!role || !name || !email || !password || !phone || !address || !city) {
      return res.status(400).json({ error: 'Please fill in all required fields.' });
    }
    if (!['mess', 'ngo'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either "mess" or "ngo".' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email address already exists.' });
    }

    const cleanPhone = String(phone).trim().replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ error: 'Phone number must be exactly 10 digits.' });
    }

    // Stop people from spamming the "send OTP" button
    const pending = db.prepare('SELECT last_sent_at FROM email_otps WHERE email = ?').get(cleanEmail);
    if (pending) {
      const waitMs = OTP_RESEND_WAIT_MS - (Date.now() - pending.last_sent_at);
      if (waitMs > 0) {
        return res.status(429).json({
          error: `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting a new OTP.`
        });
      }
    }

    const payload = {
      role,
      name: String(name).trim(),
      email: cleanEmail,
      password: bcrypt.hashSync(password, 10), // never store the plain password
      phone: cleanPhone,
      address: String(address).trim(),
      city: String(city).trim(),
      state: state ? String(state).trim() : '',
      pincode: pincode ? String(pincode).trim() : '',
      latitude: latitude ? parseFloat(latitude) : 28.5450,
      longitude: longitude ? parseFloat(longitude) : 77.1926,
      contact_person: contact_person ? String(contact_person).trim() : '',
      org_type: org_type ? String(org_type).trim() : (role === 'mess' ? 'College Mess' : 'NGO')
    };

    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

    db.prepare(`
      INSERT INTO email_otps (email, otp_hash, payload, expires_at, attempts, last_sent_at)
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(email) DO UPDATE SET
        otp_hash = excluded.otp_hash,
        payload = excluded.payload,
        expires_at = excluded.expires_at,
        attempts = 0,
        last_sent_at = excluded.last_sent_at
    `).run(cleanEmail, hashOtp(cleanEmail, otp), JSON.stringify(payload), Date.now() + OTP_VALID_MS, Date.now());

    try {
      await sendOtpEmail(cleanEmail, otp, payload.name);
    } catch (mailErr) {
      console.error('OTP email error:', mailErr.message);
      db.prepare('DELETE FROM email_otps WHERE email = ?').run(cleanEmail);
      return res.status(500).json({ error: 'Could not send the OTP email. Please check the email address and try again.' });
    }

    res.json({ message: `OTP sent to ${cleanEmail}. It is valid for 10 minutes.`, email: cleanEmail });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

// Step 2: verify OTP and create the account
app.post('/api/auth/register/verify-otp', (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const otp = String(req.body.otp || '').trim();

    if (!email || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'Please enter the 6-digit OTP.' });
    }

    const row = db.prepare('SELECT * FROM email_otps WHERE email = ?').get(email);
    if (!row) {
      return res.status(400).json({ error: 'No OTP found for this email. Please request a new one.' });
    }

    if (Date.now() > row.expires_at) {
      db.prepare('DELETE FROM email_otps WHERE email = ?').run(email);
      return res.status(400).json({ error: 'This OTP has expired. Please request a new one.' });
    }

    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      db.prepare('DELETE FROM email_otps WHERE email = ?').run(email);
      return res.status(429).json({ error: 'Too many wrong attempts. Please request a new OTP.' });
    }

    if (!safeEqual(hashOtp(email, otp), row.otp_hash)) {
      db.prepare('UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?').run(email);
      const left = OTP_MAX_ATTEMPTS - (row.attempts + 1);
      return res.status(400).json({
        error: left > 0 ? `Incorrect OTP. ${left} attempt(s) left.` : 'Incorrect OTP. Please request a new one.'
      });
    }

    // OTP is correct -> create the account
    const d = JSON.parse(row.payload);

    const alreadyExists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (alreadyExists) {
      db.prepare('DELETE FROM email_otps WHERE email = ?').run(email);
      return res.status(400).json({ error: 'An account with this email address already exists.' });
    }

    const createUser = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (role, name, email, password, phone, address, city, state, pincode, latitude, longitude, contact_person, org_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(d.role, d.name, d.email, d.password, d.phone, d.address, d.city, d.state, d.pincode, d.latitude, d.longitude, d.contact_person, d.org_type);
      db.prepare('DELETE FROM email_otps WHERE email = ?').run(email);
      return result.lastInsertRowid;
    });

    const newId = createUser();
    const newUser = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(newId);
    req.session.user = newUser;

    res.status(201).json({ message: 'Email verified. Account registered successfully!', user: newUser });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Failed to verify OTP. Please try again.' });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // If specific role requested, verify role matches
    if (role && user.role !== role) {
      return res.status(401).json({ error: `This account is registered as a ${user.role.toUpperCase()}, not ${role.toUpperCase()}.` });
    }

    const isValid = bcrypt.compareSync(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Omit password from session
    const { password: _, ...safeUser } = user;
    req.session.user = safeUser;

    res.json({
      message: 'Logged in successfully!',
      user: safeUser
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// Get current session user
app.get('/api/auth/me', (req, res) => {
  if (req.session.user) {
    // Refresh user data from database to capture any profile updates
    const refreshed = db.prepare('SELECT id, role, name, email, phone, address, city, state, pincode, latitude, longitude, contact_person, org_type FROM users WHERE id = ?').get(req.session.user.id);
    if (refreshed) {
      req.session.user = refreshed;
      return res.json({ user: refreshed });
    }
  }
  res.json({ user: null });
});

// Update location / coordinates
app.post('/api/auth/update-location', requireAuth, (req, res) => {
  try {
    const { latitude, longitude, address, city, state } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Latitude and Longitude are required.' });
    }

    const stmt = db.prepare(`
      UPDATE users 
      SET latitude = ?, longitude = ?, 
          address = COALESCE(?, address),
          city = COALESCE(?, city),
          state = COALESCE(?, state)
      WHERE id = ?
    `);
    stmt.run(parseFloat(latitude), parseFloat(longitude), address || null, city || null, state || null, req.session.user.id);

    const updated = db.prepare('SELECT id, role, name, email, phone, address, city, state, pincode, latitude, longitude, contact_person, org_type FROM users WHERE id = ?').get(req.session.user.id);
    req.session.user = updated;

    res.json({ message: 'Location updated successfully', user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Failed to logout' });
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

// ==========================================
// MESS PORTAL API ROUTES
// ==========================================

// Get listings created by current mess
app.get('/api/mess/listings', requireRole('mess'), (req, res) => {
  try {
    updateExpiredListings();

    const stmt = db.prepare(`
      SELECT 
        f.*,
        u.name AS claimed_ngo_name,
        u.phone AS claimed_ngo_phone,
        u.contact_person AS claimed_ngo_contact,
        u.address AS claimed_ngo_address
      FROM food_listings f
      LEFT JOIN users u ON f.claimed_by_ngo_id = u.id
      WHERE f.mess_id = ?
      ORDER BY 
        CASE 
          WHEN f.status = 'claimed' THEN 1
          WHEN f.status = 'available' THEN 2
          WHEN f.status = 'picked_up' THEN 3
          ELSE 4 
        END,
        f.created_at DESC
    `);

    const listings = stmt.all(req.session.user.id);
    res.json({ listings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new surplus food listing
app.post('/api/mess/listings', requireRole('mess'), (req, res) => {
  try {
    const {
      title,
      description,
      plates_count,
      food_type,
      cooked_at,
      fresh_till,
      packaging_type,
      pickup_instructions,
      special_notes
    } = req.body;

    if (!title || !plates_count || !fresh_till) {
      return res.status(400).json({ error: 'Food title, number of plates, and fresh till expiry time are required.' });
    }

    const plates = parseInt(plates_count, 10);
    if (isNaN(plates) || plates <= 0) {
      return res.status(400).json({ error: 'Please enter a valid number of plates.' });
    }

    const cookedTime = cooked_at ? new Date(cooked_at).toISOString() : new Date().toISOString();
    const expiryTime = new Date(fresh_till).toISOString();

    if (new Date(expiryTime) <= new Date()) {
      return res.status(400).json({ error: 'The "Fresh Till" time must be set in the future.' });
    }

    const stmt = db.prepare(`
      INSERT INTO food_listings (
        mess_id, title, description, plates_count, food_type, cooked_at, fresh_till, 
        packaging_type, pickup_instructions, special_notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')
    `);

    const result = stmt.run(
      req.session.user.id,
      title.trim(),
      description ? description.trim() : '',
      plates,
      food_type || 'veg',
      cookedTime,
      expiryTime,
      packaging_type || 'Bring own containers',
      pickup_instructions ? pickup_instructions.trim() : req.session.user.address,
      special_notes ? special_notes.trim() : ''
    );

    const newListing = db.prepare('SELECT * FROM food_listings WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      message: 'Surplus food listing published successfully!',
      listing: newListing
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update listing status (e.g. mark handed over / picked up or cancel)
app.put('/api/mess/listings/:id/status', requireRole('mess'), (req, res) => {
  try {
    const { status } = req.body;
    const listingId = parseInt(req.params.id, 10);

    if (!['picked_up', 'cancelled', 'available'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    // Verify listing belongs to this mess
    const listing = db.prepare('SELECT * FROM food_listings WHERE id = ? AND mess_id = ?').get(listingId, req.session.user.id);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found or not owned by you.' });
    }

    let query = 'UPDATE food_listings SET status = ? WHERE id = ?';
    let params = [status, listingId];

    // If reverting back to available from claimed
    if (status === 'available') {
      query = 'UPDATE food_listings SET status = ?, claimed_by_ngo_id = NULL, claimed_at = NULL, estimated_pickup_time = NULL, ngo_notes = NULL WHERE id = ?';
    }

    db.prepare(query).run(...params);

    res.json({ message: `Listing status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete listing
app.delete('/api/mess/listings/:id', requireRole('mess'), (req, res) => {
  try {
    const listingId = parseInt(req.params.id, 10);
    const result = db.prepare('DELETE FROM food_listings WHERE id = ? AND mess_id = ?').run(listingId, req.session.user.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    res.json({ message: 'Listing deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mess summary stats
app.get('/api/mess/stats', requireRole('mess'), (req, res) => {
  try {
    updateExpiredListings();

    const messId = req.session.user.id;

    const stats = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN status = 'picked_up' THEN plates_count ELSE 0 END), 0) AS total_plates_saved,
        COUNT(CASE WHEN status = 'available' THEN 1 END) AS active_listings,
        COUNT(CASE WHEN status = 'claimed' THEN 1 END) AS awaiting_pickup,
        COUNT(CASE WHEN status = 'picked_up' THEN 1 END) AS total_donations_completed
      FROM food_listings
      WHERE mess_id = ?
    `).get(messId);

    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// NGO PORTAL API ROUTES (WITH PROXIMITY RECOMMENDATION)
// ==========================================

// Get available food listings with distance calculation & recommendation
app.get('/api/ngo/available-food', (req, res) => {
  try {
    updateExpiredListings();

    // NGO coordinates: check session or query parameters (lat/lon)
    let ngoLat = req.session.user ? req.session.user.latitude : null;
    let ngoLon = req.session.user ? req.session.user.longitude : null;

    if (req.query.lat && req.query.lon) {
      ngoLat = parseFloat(req.query.lat);
      ngoLon = parseFloat(req.query.lon);
    }

    const { food_type, sort = 'distance', max_dist, search } = req.query;

    let query = `
      SELECT 
        f.*,
        m.name AS mess_name,
        m.phone AS mess_phone,
        m.address AS mess_address,
        m.city AS mess_city,
        m.state AS mess_state,
        m.latitude AS mess_latitude,
        m.longitude AS mess_longitude,
        m.contact_person AS mess_contact_person,
        m.org_type AS mess_org_type
      FROM food_listings f
      JOIN users m ON f.mess_id = m.id
      WHERE f.status = 'available' AND f.fresh_till > datetime('now')
    `;

    const params = [];

    if (food_type && food_type !== 'all') {
      query += ` AND f.food_type = ?`;
      params.push(food_type);
    }

    if (search) {
      query += ` AND (f.title LIKE ? OR f.description LIKE ? OR m.name LIKE ? OR m.address LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    let listings = db.prepare(query).all(...params);

    // Calculate distance for each listing relative to NGO
    listings = listings.map((item) => {
      const dist = calculateDistance(ngoLat, ngoLon, item.mess_latitude, item.mess_longitude);
      
      // Calculate freshness remaining in minutes
      const now = new Date();
      const expiry = new Date(item.fresh_till);
      const remainingMinutes = Math.max(0, Math.floor((expiry - now) / (1000 * 60)));

      return {
        ...item,
        distance_km: dist,
        remaining_minutes: remainingMinutes
      };
    });

    // Optional filter by maximum distance
    if (max_dist && !isNaN(parseFloat(max_dist))) {
      const maxD = parseFloat(max_dist);
      listings = listings.filter(item => item.distance_km === null || item.distance_km <= maxD);
    }

    // Sort listings: Closest to Me (Recommended) is default
    if (sort === 'distance') {
      listings.sort((a, b) => {
        if (a.distance_km == null) return 1;
        if (b.distance_km == null) return -1;
        return a.distance_km - b.distance_km;
      });
    } else if (sort === 'freshness') {
      listings.sort((a, b) => a.remaining_minutes - b.remaining_minutes);
    } else if (sort === 'plates') {
      listings.sort((a, b) => b.plates_count - a.plates_count);
    } else if (sort === 'recent') {
      listings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    res.json({
      listings,
      ngoLocation: (ngoLat != null && ngoLon != null) ? { latitude: ngoLat, longitude: ngoLon } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Claim surplus food
app.post('/api/ngo/claim/:id', requireRole('ngo'), (req, res) => {
  try {
    updateExpiredListings();

    const listingId = parseInt(req.params.id, 10);
    const { estimated_pickup_time, ngo_notes } = req.body;

    const listing = db.prepare(`
      SELECT f.*, m.name AS mess_name, m.phone AS mess_phone 
      FROM food_listings f
      JOIN users m ON f.mess_id = m.id
      WHERE f.id = ?
    `).get(listingId);

    if (!listing) {
      return res.status(404).json({ error: 'Food listing not found.' });
    }

    if (listing.status !== 'available') {
      return res.status(400).json({ error: `This food listing is already ${listing.status}.` });
    }

    if (new Date(listing.fresh_till) <= new Date()) {
      return res.status(400).json({ error: 'This food listing has expired and cannot be claimed.' });
    }

    const now = new Date().toISOString();
    const updateStmt = db.prepare(`
      UPDATE food_listings
      SET status = 'claimed',
          claimed_by_ngo_id = ?,
          claimed_at = ?,
          estimated_pickup_time = ?,
          ngo_notes = ?
      WHERE id = ? AND status = 'available'
    `);

    const result = updateStmt.run(
      req.session.user.id,
      now,
      estimated_pickup_time ? estimated_pickup_time.trim() : 'Within 1 hour',
      ngo_notes ? ngo_notes.trim() : '',
      listingId
    );

    if (result.changes === 0) {
      return res.status(400).json({ error: 'Listing was claimed just now by another organization.' });
    }

    res.json({
      message: 'Food successfully claimed! Please coordinate pickup with the mess.',
      messContact: {
        mess_name: listing.mess_name,
        mess_phone: listing.mess_phone
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel a claim (reverts listing to available for other NGOs)
app.post('/api/ngo/cancel-claim/:id', requireRole('ngo'), (req, res) => {
  try {
    const listingId = parseInt(req.params.id, 10);

    const listing = db.prepare('SELECT * FROM food_listings WHERE id = ? AND claimed_by_ngo_id = ?').get(listingId, req.session.user.id);

    if (!listing) {
      return res.status(404).json({ error: 'Claimed listing not found.' });
    }

    if (listing.status !== 'claimed') {
      return res.status(400).json({ error: `Cannot cancel claim because the status is ${listing.status}.` });
    }

    db.prepare(`
      UPDATE food_listings
      SET status = 'available',
          claimed_by_ngo_id = NULL,
          claimed_at = NULL,
          estimated_pickup_time = NULL,
          ngo_notes = NULL
      WHERE id = ?
    `).run(listingId);

    res.json({ message: 'Claim successfully cancelled. Food is now available for other NGOs.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NGO's claimed pickups and history
app.get('/api/ngo/my-claims', requireRole('ngo'), (req, res) => {
  try {
    const ngoId = req.session.user.id;
    const ngoLat = req.session.user.latitude;
    const ngoLon = req.session.user.longitude;

    const stmt = db.prepare(`
      SELECT 
        f.*,
        m.name AS mess_name,
        m.phone AS mess_phone,
        m.address AS mess_address,
        m.city AS mess_city,
        m.state AS mess_state,
        m.latitude AS mess_latitude,
        m.longitude AS mess_longitude,
        m.contact_person AS mess_contact_person,
        m.org_type AS mess_org_type
      FROM food_listings f
      JOIN users m ON f.mess_id = m.id
      WHERE f.claimed_by_ngo_id = ?
      ORDER BY 
        CASE WHEN f.status = 'claimed' THEN 1 ELSE 2 END,
        f.claimed_at DESC
    `);

    let claims = stmt.all(ngoId);

    claims = claims.map(c => ({
      ...c,
      distance_km: calculateDistance(ngoLat, ngoLon, c.mess_latitude, c.mess_longitude)
    }));

    res.json({ claims });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// PUBLIC OVERVIEW & STATS API
// ==========================================
app.get('/api/stats', (req, res) => {
  try {
    updateExpiredListings();

    const counts = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'mess') AS total_messes,
        (SELECT COUNT(*) FROM users WHERE role = 'ngo') AS total_ngos,
        (SELECT COALESCE(SUM(plates_count), 0) FROM food_listings WHERE status = 'picked_up') AS total_meals_served,
        (SELECT COALESCE(SUM(plates_count), 0) FROM food_listings WHERE status = 'available' AND fresh_till > datetime('now')) AS available_plates_now,
        (SELECT COUNT(*) FROM food_listings WHERE status = 'available' AND fresh_till > datetime('now')) AS available_listings_count
    `).get();

    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Map markers API: returns all active food locations with mess details
app.get('/api/map/markers', (req, res) => {
  try {
    updateExpiredListings();

    const stmt = db.prepare(`
      SELECT 
        f.id AS listing_id,
        f.title,
        f.plates_count,
        f.food_type,
        f.fresh_till,
        f.packaging_type,
        m.id AS mess_id,
        m.name AS mess_name,
        m.phone AS mess_phone,
        m.address AS mess_address,
        m.latitude,
        m.longitude
      FROM food_listings f
      JOIN users m ON f.mess_id = m.id
      WHERE f.status = 'available' AND f.fresh_till > datetime('now')
    `);

    const markers = stmt.all();
    res.json({ markers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// HTML PAGE ROUTES
// ==========================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/mess', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mess-portal.html'));
});

app.get('/ngo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ngo-portal.html'));
});

app.get('/auth', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`FoodBridge server running at http://localhost:${PORT}`);
});
