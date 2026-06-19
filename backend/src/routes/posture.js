const express = require('express');
const { body, query, validationResult } = require('express-validator');
const db      = require('../db');
const authMW  = require('../middleware/auth');

const router = express.Router();
router.use(authMW); // tüm posture endpoint'leri auth gerektiriyor

// POST /api/posture/session/start
router.post('/session/start', async (req, res) => {
  try {
    const result = await db.query(
      'INSERT INTO sessions (user_id) VALUES ($1) RETURNING id, started_at',
      [req.user.id]
    );
    res.status(201).json({ session: result.rows[0] });
  } catch (err) {
    console.error('session start error:', err.message);
    res.status(500).json({ error: 'Oturum başlatılamadı' });
  }
});

// POST /api/posture/session/:id/end
router.post('/session/:id/end', async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE sessions
       SET ended_at = NOW(),
           duration_sec = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
       WHERE id = $1 AND user_id = $2
       RETURNING id, started_at, ended_at, duration_sec`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Oturum bulunamadı' });
    }
    res.json({ session: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Oturum sonlandırılamadı' });
  }
});

// POST /api/posture/record  -  tek kayit veya toplu gönderim
router.post('/record',
  body('session_id').optional().isUUID(),
  body('records').isArray({ min: 1, max: 100 }),
  body('records.*.score').isInt({ min: 0, max: 100 }),
  body('records.*.neck_angle').isFloat({ min: 0 }),
  body('records.*.head_tilt').isFloat({ min: 0 }),
  body('records.*.shoulder_tilt').isFloat({ min: 0 }),
  body('records.*.tension').isFloat({ min: 0, max: 100 }),
  body('records.*.center_offset').isFloat({ min: 0 }),
  body('records.*.status').isIn(['good', 'warning', 'bad']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { session_id, records } = req.body;
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      const insertQ = `
        INSERT INTO posture_records
          (user_id, session_id, score, neck_angle, head_tilt, shoulder_tilt, tension, center_offset, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;

      for (const r of records) {
        await client.query(insertQ, [
          req.user.id, session_id || null,
          r.score, r.neck_angle, r.head_tilt, r.shoulder_tilt,
          r.tension, r.center_offset, r.status
        ]);
      }

      await client.query('COMMIT');
      res.status(201).json({ saved: records.length });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('record insert error:', err.message);
      res.status(500).json({ error: 'Kayıt sırasında hata oluştu' });
    } finally {
      client.release();
    }
  }
);

// GET /api/posture/history?days=7&limit=500
router.get('/history',
  query('days').optional().isInt({ min: 1, max: 365 }),
  query('limit').optional().isInt({ min: 1, max: 2000 }),
  async (req, res) => {
    const days  = parseInt(req.query.days  || '7',   10);
    const limit = parseInt(req.query.limit || '500', 10);

    try {
      const result = await db.query(
        `SELECT id, recorded_at, score, neck_angle, head_tilt, shoulder_tilt,
                tension, center_offset, status
         FROM posture_records
         WHERE user_id = $1
           AND recorded_at >= NOW() - ($2 || ' days')::INTERVAL
         ORDER BY recorded_at DESC
         LIMIT $3`,
        [req.user.id, days, limit]
      );
      res.json({ records: result.rows });
    } catch (err) {
      res.status(500).json({ error: 'Geçmiş alınamadı' });
    }
  }
);

// GET /api/posture/stats  -  ozet istatistikler
router.get('/stats', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         COUNT(*)::INTEGER                                             AS total_records,
         ROUND(AVG(score)::NUMERIC, 1)                               AS avg_score,
         ROUND((COUNT(*) FILTER (WHERE status = 'good')::NUMERIC
                / NULLIF(COUNT(*), 0) * 100), 1)                     AS good_pct,
         ROUND((COUNT(*) FILTER (WHERE status = 'warning')::NUMERIC
                / NULLIF(COUNT(*), 0) * 100), 1)                     AS warning_pct,
         ROUND((COUNT(*) FILTER (WHERE status = 'bad')::NUMERIC
                / NULLIF(COUNT(*), 0) * 100), 1)                     AS bad_pct,
         MIN(recorded_at)                                             AS first_record,
         MAX(recorded_at)                                             AS last_record
       FROM posture_records
       WHERE user_id = $1`,
      [req.user.id]
    );

    const daily = await db.query(
      `SELECT
         DATE(recorded_at AT TIME ZONE 'UTC')  AS day,
         ROUND(AVG(score)::NUMERIC, 1)         AS avg_score,
         COUNT(*)::INTEGER                      AS records
       FROM posture_records
       WHERE user_id = $1
         AND recorded_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1
       ORDER BY 1 ASC`,
      [req.user.id]
    );

    res.json({ summary: result.rows[0], daily: daily.rows });
  } catch (err) {
    res.status(500).json({ error: 'İstatistikler alınamadı' });
  }
});

// GET /api/posture/thresholds — sistem eşiklerini döner (frontend KALIB defaults için)
router.get('/thresholds', async (req, res) => {
  try {
    const result = await db.query('SELECT key, iyi_esik, kotu_esik, sample_count, updated_at FROM system_thresholds');
    const thresholds = {};
    for (const row of result.rows) {
      thresholds[row.key] = {
        iyi:          parseFloat(row.iyi_esik),
        kotu:         parseFloat(row.kotu_esik),
        sample_count: row.sample_count,
        updated_at:   row.updated_at,
      };
    }
    res.json({ thresholds, data_driven: result.rows.some(r => r.sample_count > 0) });
  } catch (err) {
    res.status(500).json({ error: 'Eşikler alınamadı' });
  }
});

// GET /api/posture/weekly-comparison — bu hafta vs geçen hafta
router.get('/weekly-comparison', async (req, res) => {
  try {
    const cmp = await db.query(
      `SELECT
         ROUND(AVG(score)         FILTER (WHERE recorded_at >= NOW()-INTERVAL '7 days')::NUMERIC,1) AS bu_skor,
         ROUND(AVG(neck_angle)    FILTER (WHERE recorded_at >= NOW()-INTERVAL '7 days')::NUMERIC,1) AS bu_boyun,
         ROUND(AVG(tension)       FILTER (WHERE recorded_at >= NOW()-INTERVAL '7 days')::NUMERIC,1) AS bu_gerginlik,
         ROUND(AVG(shoulder_tilt) FILTER (WHERE recorded_at >= NOW()-INTERVAL '7 days')::NUMERIC,1) AS bu_omuz,
         ROUND((COUNT(*) FILTER (WHERE recorded_at >= NOW()-INTERVAL '7 days' AND status='good')::NUMERIC
                / NULLIF(COUNT(*) FILTER (WHERE recorded_at >= NOW()-INTERVAL '7 days'),0)*100),1) AS bu_iyi_pct,
         COUNT(DISTINCT DATE(recorded_at)) FILTER (WHERE recorded_at >= NOW()-INTERVAL '7 days') AS bu_gun,
         ROUND(AVG(score)         FILTER (WHERE recorded_at >= NOW()-INTERVAL '14 days' AND recorded_at < NOW()-INTERVAL '7 days')::NUMERIC,1) AS gec_skor,
         ROUND(AVG(neck_angle)    FILTER (WHERE recorded_at >= NOW()-INTERVAL '14 days' AND recorded_at < NOW()-INTERVAL '7 days')::NUMERIC,1) AS gec_boyun,
         ROUND(AVG(tension)       FILTER (WHERE recorded_at >= NOW()-INTERVAL '14 days' AND recorded_at < NOW()-INTERVAL '7 days')::NUMERIC,1) AS gec_gerginlik,
         ROUND((COUNT(*) FILTER (WHERE recorded_at >= NOW()-INTERVAL '14 days' AND recorded_at < NOW()-INTERVAL '7 days' AND status='good')::NUMERIC
                / NULLIF(COUNT(*) FILTER (WHERE recorded_at >= NOW()-INTERVAL '14 days' AND recorded_at < NOW()-INTERVAL '7 days'),0)*100),1) AS gec_iyi_pct
       FROM posture_records WHERE user_id = $1`,
      [req.user.id]
    );

    const gunler = await db.query(
      `SELECT DATE(recorded_at AT TIME ZONE 'UTC') AS gun, ROUND(AVG(score)::NUMERIC,1) AS ort_skor
       FROM posture_records
       WHERE user_id = $1 AND recorded_at >= NOW()-INTERVAL '14 days'
       GROUP BY 1 ORDER BY 1`,
      [req.user.id]
    );

    res.json({ karsilastirma: cmp.rows[0], gunler: gunler.rows });
  } catch (err) {
    console.error('weekly comparison error:', err.message);
    res.status(500).json({ error: 'Karşılaştırma alınamadı' });
  }
});

module.exports = router;
