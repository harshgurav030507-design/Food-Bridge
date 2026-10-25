require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query('SELECT NOW()')
  .then((result) => {
    console.log('Connected!', result.rows[0]);
    pool.end();
  })
  .catch((err) => {
    console.error('Failed:', err.message);
    pool.end();
  });