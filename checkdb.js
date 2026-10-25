require('dotenv').config();
const { pool } = require('./database/db');

pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
  .then((result) => {
    console.log(result.rows);
    return pool.end();
  })
  .catch((err) => {
    console.error('Failed:', err.message);
    pool.end();
  });