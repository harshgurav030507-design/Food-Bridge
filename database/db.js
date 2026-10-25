const { Pool, types } = require('pg');

// Postgres sends big numbers (COUNT, SUM, BIGINT) as text by default.
// This line turns them into normal JavaScript numbers.
types.setTypeParser(20, (value) => parseInt(value, 10));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('mess', 'ngo')),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT,
      pincode TEXT,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      contact_person TEXT,
      org_type TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS food_listings (
      id SERIAL PRIMARY KEY,
      mess_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      plates_count INTEGER NOT NULL,
      food_type TEXT NOT NULL DEFAULT 'veg',
      cooked_at TIMESTAMPTZ NOT NULL,
      fresh_till TIMESTAMPTZ NOT NULL,
      packaging_type TEXT DEFAULT 'Bring Own Containers',
      pickup_instructions TEXT,
      special_notes TEXT,
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'claimed', 'picked_up', 'expired', 'cancelled')),
      claimed_by_ngo_id INTEGER REFERENCES users(id),
      claimed_at TIMESTAMPTZ,
      estimated_pickup_time TEXT,
      ngo_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS email_otps (
      email TEXT PRIMARY KEY,
      otp_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_sent_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_food_status ON food_listings(status);
    CREATE INDEX IF NOT EXISTS idx_food_fresh_till ON food_listings(fresh_till);
  `);

  console.log('Database initialized successfully.');
}

// Distance calculation using Haversine Formula (returns kilometers) -- unchanged
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

// Auto-expire stale available listings
async function updateExpiredListings() {
  await pool.query(`
    UPDATE food_listings
    SET status = 'expired'
    WHERE status = 'available' AND fresh_till < NOW()
  `);
}

module.exports = { pool, initDatabase, calculateDistance, updateExpiredListings };