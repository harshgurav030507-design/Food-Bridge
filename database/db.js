const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'foodbridge.db');
const db = new Database(dbPath);

// Enable Foreign Keys
db.pragma('foreign_keys = ON');

// Initialize Tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('mess', 'ngo')),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT,
      pincode TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      contact_person TEXT,
      org_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS food_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mess_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      plates_count INTEGER NOT NULL,
      food_type TEXT NOT NULL DEFAULT 'veg',
      cooked_at DATETIME NOT NULL,
      fresh_till DATETIME NOT NULL,
      packaging_type TEXT DEFAULT 'Bring Own Containers',
      pickup_instructions TEXT,
      special_notes TEXT,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'claimed', 'picked_up', 'expired', 'cancelled')),
      claimed_by_ngo_id INTEGER REFERENCES users(id),
      claimed_at DATETIME,
      estimated_pickup_time TEXT,
      ngo_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Pending registrations waiting for email OTP verification
    CREATE TABLE IF NOT EXISTS email_otps (
      email TEXT PRIMARY KEY,
      otp_hash TEXT NOT NULL,
      payload TEXT NOT NULL,          -- registration form data (password already hashed)
      expires_at INTEGER NOT NULL,    -- ms timestamp
      attempts INTEGER NOT NULL DEFAULT 0,
      last_sent_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_food_status ON food_listings(status);
    CREATE INDEX IF NOT EXISTS idx_food_fresh_till ON food_listings(fresh_till);
  `);

  console.log('Database initialized successfully.');
}

// Distance calculation using Haversine Formula (returns kilometers)
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10; // Round to 1 decimal place
}

// Helper: auto-expire stale available listings
function updateExpiredListings() {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE food_listings 
    SET status = 'expired' 
    WHERE status = 'available' AND fresh_till < ?
  `);
  stmt.run(now);
}

module.exports = {
  db,
  initDatabase,
  calculateDistance,
  updateExpiredListings
};
