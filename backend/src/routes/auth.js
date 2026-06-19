const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { body, validationResult } = require('express-validator');
const db       = require('../db');
const authMW   = require('../middleware/auth');
const { sendPasswordReset } = require('../mailer');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role || 'user' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
router.post('/register',
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('İsim 2-100 karakter olmalı'),
  body('email').isEmail().normalizeEmail().withMessage('Geçersiz e-posta'),
  body('password').isLength({ min: 6 }).withMessage('Şifre en az 6 karakter olmalı'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { name, email, password } = req.body;

    try {
      const exists = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (exists.rows.length > 0) {
        return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı' });
      }

      const hash = await bcrypt.hash(password, 12);
      const result = await db.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
        [name, email, hash]
      );

      const user  = result.rows[0];
      const token = signToken(user);

      res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
      console.error('register error:', err.message);
      res.status(500).json({ error: 'Kayıt sırasında hata oluştu' });
    }
  }
);

// POST /api/auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'E-posta veya şifre hatalı' });
    }

    const { email, password } = req.body;

    // Admin kontrolü (veritabanına gerek yok)
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@posturtakip.com';
    const adminPass  = process.env.ADMIN_PASSWORD || 'PosturAdmin2024';
    if (email === adminEmail) {
      if (password !== adminPass) {
        return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
      }
      const token = signToken({ id: 'admin', email: adminEmail, name: 'Admin', role: 'admin' });
      return res.json({ token, user: { id: 'admin', name: 'Admin', email: adminEmail, role: 'admin' } });
    }

    try {
      const result = await db.query(
        'SELECT id, name, email, password_hash FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
      }

      const token = signToken(user);
      res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
      console.error('login error:', err.message);
      res.status(500).json({ error: 'Giriş sırasında hata oluştu' });
    }
  }
);

// POST /api/auth/change-password
router.post('/change-password', authMW,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }).withMessage('Yeni şifre en az 6 karakter olmalı'),
  async (req, res) => {
    if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin şifresi .env dosyasından değiştirilir' });
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
      const valid = await bcrypt.compare(req.body.currentPassword, result.rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Mevcut şifre hatalı' });
      const hash = await bcrypt.hash(req.body.newPassword, 12);
      await db.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
      res.json({ success: true });
    } catch (err) {
      console.error('change-password error:', err.message);
      res.status(500).json({ error: 'Şifre değiştirilemedi' });
    }
  }
);

// DELETE /api/auth/account — kullanici kendi hesabini siler (KVKK)
router.delete('/account', authMW,
  body('password').notEmpty().withMessage('Şifre gerekli'),
  async (req, res) => {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Admin hesabı bu yolla silinemez' });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

      const valid = await bcrypt.compare(req.body.password, result.rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Şifre hatalı' });

      // CASCADE — posture_records, sessions, health_predictions, exercise_programs hepsi silinir
      await db.query('DELETE FROM users WHERE id = $1', [req.user.id]);
      res.json({ success: true });
    } catch (err) {
      console.error('account delete error:', err.message);
      res.status(500).json({ error: 'Hesap silinirken hata oluştu' });
    }
  }
);

// GET /api/auth/me  (token dogrulama + kullanici bilgisi)
router.get('/me', authMW, async (req, res) => {
  // Admin veritabanında kayıtlı değil, token'dan döndür
  if (req.user.role === 'admin') {
    return res.json({
      user: {
        id:         req.user.sub,
        name:       req.user.name,
        email:      req.user.email,
        role:       'admin',
        created_at: null,
      }
    });
  }

  try {
    const result = await db.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password',
  body('email').isEmail().normalizeEmail(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Geçersiz e-posta adresi' });

    // Güvenlik: her zaman aynı yanıtı ver (kullanıcı varlığını sızdırma)
    const genericOk = { message: 'Kayıtlı bir e-posta adresi ise sıfırlama bağlantısı gönderildi.' };

    try {
      const result = await db.query('SELECT id, email FROM users WHERE email=$1', [req.body.email]);
      if (result.rows.length === 0) return res.json(genericOk);

      const user  = result.rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const exp   = new Date(Date.now() + 60 * 60 * 1000); // 1 saat

      // Önceki sıfırlama tokenlarını geçersiz kıl
      await db.query('UPDATE password_reset_tokens SET used=TRUE WHERE user_id=$1 AND used=FALSE', [user.id]);
      await db.query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
        [user.id, token, exp]
      );

      const appUrl   = (process.env.APP_URL || 'http://localhost').replace(/\/$/, '');
      const resetUrl = `${appUrl}/reset-password.html?token=${token}`;

      await sendPasswordReset(user.email, resetUrl);
      res.json(genericOk);
    } catch (err) {
      console.error('forgot-password error:', err.message);
      res.status(500).json({ error: 'Sunucu hatası' });
    }
  }
);

// POST /api/auth/reset-password
router.post('/reset-password',
  body('token').notEmpty(),
  body('password').isLength({ min: 6 }).withMessage('Şifre en az 6 karakter olmalı'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const result = await db.query(
        `SELECT t.id, t.user_id FROM password_reset_tokens t
         WHERE t.token=$1 AND t.used=FALSE AND t.expires_at > NOW()`,
        [req.body.token]
      );
      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Bağlantı geçersiz veya süresi dolmuş. Yeni sıfırlama talebinde bulunun.' });
      }
      const { id: tokenId, user_id } = result.rows[0];
      const hash = await bcrypt.hash(req.body.password, 12);

      await db.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, user_id]);
      await db.query('UPDATE password_reset_tokens SET used=TRUE WHERE id=$1', [tokenId]);

      res.json({ success: true, message: 'Şifreniz başarıyla değiştirildi.' });
    } catch (err) {
      console.error('reset-password error:', err.message);
      res.status(500).json({ error: 'Şifre sıfırlanamadı' });
    }
  }
);

module.exports = router;
