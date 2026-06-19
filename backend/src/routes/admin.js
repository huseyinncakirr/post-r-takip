const express  = require('express');
const bcrypt   = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db       = require('../db');
const adminMW  = require('../middleware/admin');

const router = express.Router();
router.use(adminMW);

// GET /api/admin/stats — genel sistem istatistikleri
router.get('/stats', async (req, res) => {
  try {
    const [users, records, predictions] = await Promise.all([
      db.query('SELECT COUNT(*) AS toplam FROM users'),
      db.query('SELECT COUNT(*) AS toplam, ROUND(AVG(score)::NUMERIC,1) AS ort_skor FROM posture_records'),
      db.query("SELECT COUNT(*) FILTER (WHERE risk_level='high') AS yuksek, COUNT(*) FILTER (WHERE risk_level='medium') AS orta, COUNT(*) FILTER (WHERE risk_level='low') AS dusuk FROM health_predictions"),
    ]);
    res.json({
      kullanici_sayisi: parseInt(users.rows[0].toplam),
      toplam_kayit:     parseInt(records.rows[0].toplam),
      ortalama_skor:    parseFloat(records.rows[0].ort_skor) || 0,
      risk_yuksek:      parseInt(predictions.rows[0].yuksek),
      risk_orta:        parseInt(predictions.rows[0].orta),
      risk_dusuk:       parseInt(predictions.rows[0].dusuk),
    });
  } catch (err) {
    console.error('admin stats error:', err.message);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/admin/users — tüm kullanıcılar + özet istatistik
router.get('/users', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        u.id, u.name, u.email, u.created_at,
        COUNT(pr.id)                                          AS kayit_sayisi,
        ROUND(AVG(pr.score)::NUMERIC, 1)                     AS ort_skor,
        MAX(pr.recorded_at)                                   AS son_kayit,
        (SELECT risk_level FROM health_predictions hp WHERE hp.user_id = u.id ORDER BY hp.created_at DESC LIMIT 1) AS son_risk
      FROM users u
      LEFT JOIN posture_records pr ON pr.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: result.rows });
  } catch (err) {
    console.error('admin users error:', err.message);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/admin/users/:id — tek kullanıcı detay
router.get('/users/:id', async (req, res) => {
  try {
    const user = await db.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (user.rows.length === 0) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const stats = await db.query(`
      SELECT
        COUNT(*)                                              AS toplam_kayit,
        ROUND(AVG(score)::NUMERIC,1)                         AS ort_skor,
        ROUND((COUNT(*) FILTER (WHERE status='good')::NUMERIC / NULLIF(COUNT(*),0)*100),1) AS iyi_yuzde,
        ROUND((COUNT(*) FILTER (WHERE status='bad')::NUMERIC  / NULLIF(COUNT(*),0)*100),1) AS kotu_yuzde,
        ROUND(AVG(neck_angle)::NUMERIC,1)                    AS ort_boyun,
        ROUND(AVG(tension)::NUMERIC,1)                       AS ort_gerginlik
      FROM posture_records WHERE user_id = $1
    `, [req.params.id]);

    res.json({ user: user.rows[0], stats: stats.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/admin/users/:id/records — kullanıcının postur kayıtları (son 200)
router.get('/users/:id/records', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT recorded_at, score, neck_angle, head_tilt, shoulder_tilt, tension, center_offset, status
      FROM posture_records
      WHERE user_id = $1
      ORDER BY recorded_at DESC
      LIMIT 200
    `, [req.params.id]);
    res.json({ records: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/admin/users/:id/health — kullanıcının sağlık tahminleri
router.get('/users/:id/health', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, created_at, risk_level, prediction_text, risk_factors, model_used
      FROM health_predictions
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [req.params.id]);
    res.json({ predictions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/admin/users — yeni kullanıcı ekle
router.post('/users',
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { name, email, password } = req.body;
    try {
      const exists = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (exists.rows.length > 0) return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı' });

      const hash   = await bcrypt.hash(password, 12);
      const result = await db.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id, name, email, created_at',
        [name, email, hash]
      );
      res.status(201).json({ user: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Kullanıcı eklenemedi' });
    }
  }
);

// DELETE /api/admin/users/:id — kullanıcıyı ve tüm verilerini sil
router.delete('/users/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id, name', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    res.json({ message: result.rows[0].name + ' silindi' });
  } catch (err) {
    res.status(500).json({ error: 'Silme işlemi başarısız' });
  }
});

// POST /api/admin/recalibrate-thresholds
// Biriken postur verisinden istatistiksel olarak optimum eşik değerlerini hesaplar
router.post('/recalibrate-thresholds', async (req, res) => {
  try {
    // Minimum veri kontrolü
    const countRes = await db.query('SELECT COUNT(*) FROM posture_records');
    const total    = parseInt(countRes.rows[0].count);

    if (total < 200) {
      return res.status(422).json({
        error: `Yeterli veri yok. En az 200 kayıt gerekiyor (şu an: ${total}).`,
        current: total,
      });
    }

    // İyi ve kötü oturumları percentile ile ayır:
    //   iyi_esik  = "good" kayıtların 80. yüzdesi  → buradan sonrası dikkat bölgesi
    //   kotu_esik = "bad"  kayıtların 20. yüzdesi  → buradan sonrası kesinlikle kötü
    const result = await db.query(`
      SELECT
        ROUND(PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY neck_angle)    FILTER (WHERE status='good')::NUMERIC, 1) AS boyun_iyi,
        ROUND(PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY neck_angle)    FILTER (WHERE status='bad' )::NUMERIC, 1) AS boyun_kotu,
        ROUND(PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY tension)       FILTER (WHERE status='good')::NUMERIC, 1) AS gerg_iyi,
        ROUND(PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY tension)       FILTER (WHERE status='bad' )::NUMERIC, 1) AS gerg_kotu,
        ROUND(PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY shoulder_tilt) FILTER (WHERE status='good')::NUMERIC, 1) AS omuz_iyi,
        ROUND(PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY shoulder_tilt) FILTER (WHERE status='bad' )::NUMERIC, 1) AS omuz_kotu,
        ROUND(PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY head_tilt)     FILTER (WHERE status='good')::NUMERIC, 1) AS bas_iyi,
        ROUND(PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY head_tilt)     FILTER (WHERE status='bad' )::NUMERIC, 1) AS bas_kotu,
        ROUND(PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY center_offset) FILTER (WHERE status='good')::NUMERIC, 1) AS merkez_iyi,
        ROUND(PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY center_offset) FILTER (WHERE status='bad' )::NUMERIC, 1) AS merkez_kotu,
        COUNT(*) FILTER (WHERE status='good') AS good_count,
        COUNT(*) FILTER (WHERE status='bad')  AS bad_count
      FROM posture_records
    `);

    const d = result.rows[0];

    // Hesaplanan eşiği mantıklı sınırlarla sabitle (tamamen saçma değer çıkmasın)
    function sinirla(val, min, max) {
      const n = parseFloat(val);
      if (!n || isNaN(n)) return null;
      return Math.min(Math.max(n, min), max);
    }

    const yeni = {
      boyun:     { iyi: sinirla(d.boyun_iyi,  6,  20), kotu: sinirla(d.boyun_kotu,  12, 35) },
      gerginlik: { iyi: sinirla(d.gerg_iyi,  10,  35), kotu: sinirla(d.gerg_kotu,   25, 65) },
      omuz:      { iyi: sinirla(d.omuz_iyi,   2,   8), kotu: sinirla(d.omuz_kotu,    5, 16) },
      bas:       { iyi: sinirla(d.bas_iyi,    1.5, 5), kotu: sinirla(d.bas_kotu,     3,  9) },
      merkez:    { iyi: sinirla(d.merkez_iyi,  4, 12), kotu: sinirla(d.merkez_kotu, 8,  20) },
    };

    // iyi < kotu olduğundan emin ol
    for (const k of Object.keys(yeni)) {
      if (yeni[k].iyi && yeni[k].kotu && yeni[k].iyi >= yeni[k].kotu) {
        yeni[k].kotu = parseFloat(yeni[k].iyi) + 5;
      }
    }

    // Veritabanına kaydet
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const [key, val] of Object.entries(yeni)) {
        if (!val.iyi || !val.kotu) continue;
        await client.query(
          `UPDATE system_thresholds
           SET iyi_esik = $1, kotu_esik = $2, sample_count = $3, updated_at = NOW()
           WHERE key = $4`,
          [val.iyi, val.kotu, total, key]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally { client.release(); }

    res.json({
      message:      `${total} kayıttan eşikler yeniden hesaplandı.`,
      sample_count: total,
      good_count:   parseInt(d.good_count),
      bad_count:    parseInt(d.bad_count),
      thresholds:   yeni,
    });
  } catch (err) {
    console.error('recalibrate error:', err.message);
    res.status(500).json({ error: 'Hesaplama başarısız: ' + err.message });
  }
});

module.exports = router;
