require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const authRoutes    = require('./routes/auth');
const postureRoutes = require('./routes/posture');
const aiRoutes      = require('./routes/ai');
const adminRoutes   = require('./routes/admin');
const { initDb }    = require('./db');

const app  = express();
const PORT = process.env.PORT || 3001;

// Nginx arkasinda calistigimiz icin proxy guveni
app.set('trust proxy', 1);

// Guvenlik basiklari
app.use(helmet());
const _rawOrigin = process.env.CORS_ORIGIN || '*';
const _corsOrigins = _rawOrigin === '*' ? '*' : _rawOrigin.split(',').map(o => o.trim());
app.use(cors({
  origin: _corsOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiting - genel API
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek, lütfen bekleyin' },
});
app.use('/api', limiter);

// Auth icin daha siki limit
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Çok fazla giriş denemesi' },
});

// Routes
app.use('/api/auth',    authLimiter, authRoutes);
app.use('/api/posture', postureRoutes);
app.use('/api/ai',      aiRoutes);
app.use('/api/admin',   adminRoutes);

// Saglik kontrolu + DB testi (gecici)
app.get('/health', async (req, res) => {
  const { pool } = require('./db');
  let dbOk = false, dbErr = null, dbUrlHint = '';
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch (e) {
    dbErr = e.message;
  }
  const raw = (process.env.DATABASE_URL || '');
  dbUrlHint = raw.substring(0, 40) + (raw.length > 40 ? '...' : '');
  res.json({ status: 'ok', timestamp: new Date().toISOString(), db: dbOk ? 'ok' : 'error', dbErr, dbUrlHint });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint bulunamadı' });
});

// Global hata yakalayici
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Sunucu hatası' });
});

// Server hemen başlar — initDb arka planda çalışır, server'ı bloke etmez
app.listen(PORT, '0.0.0.0', () => {
  console.log(`DikDur Backend calisiyor: http://0.0.0.0:${PORT}`);
  console.log(`Ortam: ${process.env.NODE_ENV || 'development'}`);
  initDb();
});
