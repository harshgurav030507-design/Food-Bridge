require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { pool, initDatabase, calculateDistance, updateExpiredListings } = require('./database/db');
const { sendOtpEmail } = require('./mailer');

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

    const existingResult = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existingResult.rows[0]) {
      return res.status(400).json({ error: 'An account with this email address already exists.' });
    }

    const cleanPhone = String(phone).trim().replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ error: 'Phone number must be exactly 10 digits.' });
    }

    // Stop people from spamming the "send OTP" button
    const pendingResult = await pool.query('SELECT last_sent_at FROM email_otps WHERE email = $1', [cleanEmail]);
    const pending = pendingResult.rows[0];
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

    await pool.query(
      `INSERT INTO email_otps (email, otp_hash, payload, expires_at, attempts, last_sent_at)
       VALUES ($1, $2, $3, $4, 0, $5)
       ON CONFLICT (email) DO UPDATE SET
         otp_hash = EXCLUDED.otp_hash,
         payload = EXCLUDED.payload,
         expires_at = EXCLUDED.expires_at,
         attempts = 0,
         last_sent_at = EXCLUDED.last_sent_at`,
      [cleanEmail, hashOtp(cleanEmail, otp), JSON.stringify(payload), Date.now() + OTP_VALID_MS, Date.now()]
    );

    try {
      await sendOtpEmail(cleanEmail, otp, payload.name);
    } catch (mailErr) {
      console.error('OTP email error:', mailErr.message);
      await pool.query('DELETE FROM email_otps WHERE email = $1', [cleanEmail]);
      return res.status(500).json({ error: 'Could not send the OTP email. Please check the email address and try again.' });
    }

    res.json({ message: `OTP sent to ${cleanEmail}. It is valid for 10 minutes.`, email: cleanEmail });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

// Step 2: verify OTP and create the account
app.post('/api/auth/register/verify-otp', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const otp = String(req.body.otp || '').trim();

    if (!email || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'Please enter the 6-digit OTP.' });
    }

    const rowResult = await pool.query('SELECT * FROM email_otps WHERE email = $1', [email]);
    const row = rowResult.rows[0];
    if (!row) {
      return res.status(400).json({ error: 'No OTP found for this email. Please request a new one.' });
    }

    if (Date.now() > row.expires_at) {
      await pool.query('DELETE FROM email_otps WHERE email = $1', [email]);
      return res.status(400).json({ error: 'This OTP has expired. Please request a new one.' });
    }

    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      await pool.query('DELETE FROM email_otps WHERE email = $1', [email]);
      return res.status(429).json({ error: 'Too many wrong attempts. Please request a new OTP.' });
    }

    if (!safeEqual(hashOtp(email, otp), row.otp_hash)) {
      await pool.query('UPDATE email_otps SET attempts = attempts + 1 WHERE email = $1', [email]);
      const left = OTP_MAX_ATTEMPTS - (row.attempts + 1);
      return res.status(400).json({
        error: left > 0 ? `Incorrect OTP. ${left} attempt(s) left.` : 'Incorrect OTP. Please request a new one.'
      });
    }

    // OTP is correct -> create the account
    const d = JSON.parse(row.payload);

    const alreadyResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (alreadyResult.rows[0]) {
      await pool.query('DELETE FROM email_otps WHERE email = $1', [email]);
      return res.status(400).json({ error: 'An account with this email address already exists.' });
    }

    // Create the user and delete the OTP together: both succeed or neither does
    const client = await pool.connect();
    let newId;
    try {
      await client.query('BEGIN');
      const insertResult = await client.query(
        `INSERT INTO users (role, name, email, password, phone, address, city, state, pincode, latitude, longitude, contact_person, org_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [d.role, d.name, d.email, d.password, d.phone, d.address, d.city, d.state, d.pincode, d.latitude, d.longitude, d.contact_person, d.org_type]
      );
      newId = insertResult.rows[0].id;
      await client.query('DELETE FROM email_otps WHERE email = $1', [email]);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const userResult = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [newId]);
    const newUser = userResult.rows[0];
    req.session.user = newUser;

    res.status(201).json({ message: 'Email verified. Account registered successfully!', user: newUser });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Failed to verify OTP. Please try again.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = userResult.rows[0];

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
app.get('/api/auth/me', async (req, res) => {
  try {
    if (req.session.user) {
      // Refresh user data from database to capture any profile updates
      const refreshedResult = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.session.user.id]);
      const refreshed = refreshedResult.rows[0];
      if (refreshed) {
        req.session.user = refreshed;
        return res.json({ user: refreshed });
      }
    }
    res.json({ user: null });
  } catch (err) {
    console.error('Session check error:', err);
    res.status(500).json({ error: 'Could not check session.' });
  }
});

// Update location / coordinates
app.post('/api/auth/update-location', requireAuth, async (req, res) => {
  try {
    const { latitude, longitude, address, city, state } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Latitude and Longitude are required.' });
    }

    await pool.query(
      `UPDATE users
       SET latitude = $1, longitude = $2,
           address = COALESCE($3, address),
           city = COALESCE($4, city),
           state = COALESCE($5, state)
       WHERE id = $6`,
      [parseFloat(latitude), parseFloat(longitude), address || null, city || null, state || null, req.session.user.id]
    );

    const updatedResult = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.session.user.id]);
    const updated = updatedResult.rows[0];
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
app.get('/api/mess/listings', requireRole('mess'), async (req, res) => {
  try {
    await updateExpiredListings();

    const result = await pool.query(`
      SELECT 
        f.*,
        u.name AS claimed_ngo_name,
        u.phone AS claimed_ngo_phone,
        u.contact_person AS claimed_ngo_contact,
        u.address AS claimed_ngo_address
      FROM food_listings f
      LEFT JOIN users u ON f.claimed_by_ngo_id = u.id
      WHERE f.mess_id = $1
      ORDER BY 
        CASE 
          WHEN f.status = 'claimed' THEN 1
          WHEN f.status = 'available' THEN 2
          WHEN f.status = 'picked_up' THEN 3
          ELSE 4 
        END,
        f.created_at DESC
    `, [req.session.user.id]);

    res.json({ listings: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new surplus food listing
app.post('/api/mess/listings', requireRole('mess'), async (req, res) => {
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

    const result = await pool.query(
      `INSERT INTO food_listings (
        mess_id, title, description, plates_count, food_type, cooked_at, fresh_till, 
        packaging_type, pickup_instructions, special_notes, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'available')
      RETURNING *`,
      [
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
      ]
    );

    const newListing = result.rows[0];

    res.status(201).json({
      message: 'Surplus food listing published successfully!',
      listing: newListing
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update listing status (e.g. mark handed over / picked up or cancel)
app.put('/api/mess/listings/:id/status', requireRole('mess'), async (req, res) => {
  try {
    const { status } = req.body;
    const listingId = parseInt(req.params.id, 10);

    if (!['picked_up', 'cancelled', 'available'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    // Verify listing belongs to this mess
    const listingResult = await pool.query('SELECT * FROM food_listings WHERE id = $1 AND mess_id = $2', [listingId, req.session.user.id]);
    const listing = listingResult.rows[0];
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found or not owned by you.' });
    }

    let query = 'UPDATE food_listings SET status = $1 WHERE id = $2';
    let params = [status, listingId];

    // If reverting back to available from claimed
    if (status === 'available') {
      query = 'UPDATE food_listings SET status = $1, claimed_by_ngo_id = NULL, claimed_at = NULL, estimated_pickup_time = NULL, ngo_notes = NULL WHERE id = $2';
    }

    await pool.query(query, params);

    res.json({ message: `Listing status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete listing
app.delete('/api/mess/listings/:id', requireRole('mess'), async (req, res) => {
  try {
    const listingId = parseInt(req.params.id, 10);
    const result = await pool.query('DELETE FROM food_listings WHERE id = $1 AND mess_id = $2', [listingId, req.session.user.id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    res.json({ message: 'Listing deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mess summary stats
app.get('/api/mess/stats', requireRole('mess'), async (req, res) => {
  try {
    await updateExpiredListings();

    const messId = req.session.user.id;

    const statsResult = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN status = 'picked_up' THEN plates_count ELSE 0 END), 0) AS total_plates_saved,
        COUNT(CASE WHEN status = 'available' THEN 1 END) AS active_listings,
        COUNT(CASE WHEN status = 'claimed' THEN 1 END) AS awaiting_pickup,
        COUNT(CASE WHEN status = 'picked_up' THEN 1 END) AS total_donations_completed
      FROM food_listings
      WHERE mess_id = $1
    `, [messId]);

    res.json({ stats: statsResult.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// NGO PORTAL API ROUTES (WITH PROXIMITY RECOMMENDATION)
// ==========================================

// Get available food listings with distance calculation & recommendation
app.get('/api/ngo/available-food', async (req, res) => {
  try {
    await updateExpiredListings();

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
      WHERE f.status = 'available' AND f.fresh_till > NOW()
    `;

    const params = [];

    if (food_type && food_type !== 'all') {
      params.push(food_type);
      query += ` AND f.food_type = $${params.length}`;
    }

    if (search) {
      // ILIKE = case-insensitive search (plain LIKE is case-sensitive in Postgres)
      params.push(`%${search}%`);
      const n = params.length;
      query += ` AND (f.title ILIKE $${n} OR f.description ILIKE $${n} OR m.name ILIKE $${n} OR m.address ILIKE $${n})`;
    }

    const listingsResult = await pool.query(query, params);
    let listings = listingsResult.rows;

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
app.post('/api/ngo/claim/:id', requireRole('ngo'), async (req, res) => {
  try {
    await updateExpiredListings();

    const listingId = parseInt(req.params.id, 10);
    const { estimated_pickup_time, ngo_notes } = req.body;

    const listingResult = await pool.query(`
      SELECT f.*, m.name AS mess_name, m.phone AS mess_phone 
      FROM food_listings f
      JOIN users m ON f.mess_id = m.id
      WHERE f.id = $1
    `, [listingId]);
    const listing = listingResult.rows[0];

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
    const result = await pool.query(
      `UPDATE food_listings
       SET status = 'claimed',
           claimed_by_ngo_id = $1,
           claimed_at = $2,
           estimated_pickup_time = $3,
           ngo_notes = $4
       WHERE id = $5 AND status = 'available'`,
      [
        req.session.user.id,
        now,
        estimated_pickup_time ? estimated_pickup_time.trim() : 'Within 1 hour',
        ngo_notes ? ngo_notes.trim() : '',
        listingId
      ]
    );

    if (result.rowCount === 0) {
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
app.post('/api/ngo/cancel-claim/:id', requireRole('ngo'), async (req, res) => {
  try {
    const listingId = parseInt(req.params.id, 10);

    const listingResult = await pool.query('SELECT * FROM food_listings WHERE id = $1 AND claimed_by_ngo_id = $2', [listingId, req.session.user.id]);
    const listing = listingResult.rows[0];

    if (!listing) {
      return res.status(404).json({ error: 'Claimed listing not found.' });
    }

    if (listing.status !== 'claimed') {
      return res.status(400).json({ error: `Cannot cancel claim because the status is ${listing.status}.` });
    }

    await pool.query(`
      UPDATE food_listings
      SET status = 'available',
          claimed_by_ngo_id = NULL,
          claimed_at = NULL,
          estimated_pickup_time = NULL,
          ngo_notes = NULL
      WHERE id = $1
    `, [listingId]);

    res.json({ message: 'Claim successfully cancelled. Food is now available for other NGOs.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NGO's claimed pickups and history
app.get('/api/ngo/my-claims', requireRole('ngo'), async (req, res) => {
  try {
    const ngoId = req.session.user.id;
    const ngoLat = req.session.user.latitude;
    const ngoLon = req.session.user.longitude;

    const claimsResult = await pool.query(`
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
      WHERE f.claimed_by_ngo_id = $1
      ORDER BY 
        CASE WHEN f.status = 'claimed' THEN 1 ELSE 2 END,
        f.claimed_at DESC
    `, [ngoId]);

    let claims = claimsResult.rows;

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
app.get('/api/stats', async (req, res) => {
  try {
    await updateExpiredListings();

    const countsResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'mess') AS total_messes,
        (SELECT COUNT(*) FROM users WHERE role = 'ngo') AS total_ngos,
        (SELECT COALESCE(SUM(plates_count), 0) FROM food_listings WHERE status = 'picked_up') AS total_meals_served,
        (SELECT COALESCE(SUM(plates_count), 0) FROM food_listings WHERE status = 'available' AND fresh_till > NOW()) AS available_plates_now,
        (SELECT COUNT(*) FROM food_listings WHERE status = 'available' AND fresh_till > NOW()) AS available_listings_count
    `);

    res.json(countsResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Map markers API: returns all active food locations with mess details
app.get('/api/map/markers', async (req, res) => {
  try {
    await updateExpiredListings();

    const markersResult = await pool.query(`
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
      WHERE f.status = 'available' AND f.fresh_till > NOW()
    `);

    res.json({ markers: markersResult.rows });
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

// Start Server (only after the database tables are ready)
initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`FoodBridge server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Could not start server:', err.message);
    process.exit(1);
  });