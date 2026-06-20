const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

// .rlwy.net = Railway'in dış proxy'si → SSL gerekir
// .railway.internal = iç ağ → SSL gerekmez
const _dbUrl = process.env.DATABASE_URL || '';
const _needSsl = _dbUrl.includes('.rlwy.net') || _dbUrl.includes('sslmode=require');

const pool = new Pool({
  connectionString: _dbUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: _needSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

async function initDb() {
  const client = await pool.connect().catch(err => {
    console.error('❌ DB bağlantı hatası:', err.message);
    return null;
  });
  if (!client) return;
  try {
    await client.query('SET statement_timeout = 15000'); // 15 saniye max
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await client.query(sql);
    console.log('✅ Veritabanı şeması uygulandı');
  } catch (err) {
    console.error('❌ DB init hatası:', err.message);
  } finally {
    client.release();
  }
}

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('query', { text: text.substring(0, 80), duration, rows: res.rowCount });
  }
  return res;
}

async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool, initDb };
