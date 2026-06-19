const express  = require('express');
const db       = require('../db');
const authMW   = require('../middleware/auth');
const { analyzeHealthRisk: openaiHealthRisk }   = require('../llm/openai');
const { generateExerciseProgram, analyzeHealthRisk: ollamaHealthRisk, isOllamaAvailable } = require('../llm/ollama');

const router = express.Router();
router.use(authMW);

// GET /api/ai/health-prediction
// Kullanicinin postur gecmisine gore saglik riski tahmini (OpenAI)
router.get('/health-prediction', async (req, res) => {
  const userId = req.user.id;

  try {
    // Daha onceki tahminleri kontrol et (son 24 saat)
    const cached = await db.query(
      `SELECT id, risk_level, prediction_text, risk_factors, created_at, model_used
       FROM health_predictions
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (cached.rows.length > 0) {
      return res.json({ prediction: cached.rows[0], cached: true });
    }

    // Yeterli veri var mi kontrol et
    const countResult = await db.query(
      'SELECT COUNT(*) FROM posture_records WHERE user_id = $1',
      [userId]
    );
    if (parseInt(countResult.rows[0].count) < 50) {
      return res.status(422).json({
        error: 'Yeterli veri yok. En az 50 kayıt gerekli.',
        current: parseInt(countResult.rows[0].count)
      });
    }

    // Istatistikleri getir
    const statsResult = await db.query(
      `SELECT
         ROUND(AVG(score)::NUMERIC, 1)                               AS avg_score,
         ROUND((COUNT(*) FILTER (WHERE status = 'good')::NUMERIC
                / NULLIF(COUNT(*), 0) * 100), 1)                     AS good_pct,
         ROUND((COUNT(*) FILTER (WHERE status = 'bad')::NUMERIC
                / NULLIF(COUNT(*), 0) * 100), 1)                     AS bad_pct
       FROM posture_records WHERE user_id = $1`,
      [userId]
    );

    const dailyResult = await db.query(
      `SELECT DATE(recorded_at) AS day, ROUND(AVG(score)::NUMERIC,1) AS avg_score
       FROM posture_records
       WHERE user_id = $1 AND recorded_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1 ORDER BY 1`,
      [userId]
    );

    const recentResult = await db.query(
      `SELECT neck_angle, tension, shoulder_tilt, head_tilt, center_offset, score
       FROM posture_records
       WHERE user_id = $1
       ORDER BY recorded_at DESC LIMIT 400`,
      [userId]
    );

    // Öncelik: 1) Groq/OpenAI  2) Yerel dikdur modeli
    let llmResult = { success: false };

    llmResult = await openaiHealthRisk(
      statsResult.rows[0],
      dailyResult.rows,
      recentResult.rows
    );

    if (!llmResult.success) {
      console.log('Groq basarisiz, yerel model deneniyor:', llmResult.error);
      const ollamaOk = await isOllamaAvailable();
      if (ollamaOk) {
        llmResult = await ollamaHealthRisk(
          statsResult.rows[0],
          dailyResult.rows,
          recentResult.rows
        );
      }
    }

    if (!llmResult.success) {
      return res.status(502).json({ error: 'AI analizi başarısız: ' + llmResult.error });
    }

    const data = llmResult.data;

    // Veritabanina kaydet
    const saved = await db.query(
      `INSERT INTO health_predictions (user_id, risk_level, prediction_text, risk_factors, model_used)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [
        userId,
        data.risk_level,
        JSON.stringify(data),   // tum JSON'u text olarak sakla
        JSON.stringify({ risks: data.risks }),
        llmResult.model
      ]
    );

    res.json({
      prediction: {
        id:              saved.rows[0].id,
        risk_level:      data.risk_level,
        prediction_text: JSON.stringify(data),
        risk_factors:    { risks: data.risks },
        created_at:      saved.rows[0].created_at,
        model_used:      llmResult.model,
        parsed:          data,
      },
      cached: false,
    });
  } catch (err) {
    console.error('health prediction error:', err.message);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/ai/health-prediction/history
router.get('/health-prediction/history', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, risk_level, risk_factors, created_at, model_used
       FROM health_predictions
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [req.user.id]
    );
    res.json({ predictions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Geçmiş alınamadı' });
  }
});

// GET /api/ai/exercise-program
// Kisisel egzersiz programi (Ollama - lokal model)
router.get('/exercise-program', async (req, res) => {
  const userId = req.user.id;

  try {
    // Son 1 gunde olusturulmus ve en az 3 egzersiz iceren program varsa don
    const cached = await db.query(
      `SELECT id, title, program, based_on_days, created_at, model_used
       FROM exercise_programs
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '1 day'
         AND jsonb_array_length((program::jsonb) -> 'egzersizler') >= 3
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (cached.rows.length > 0) {
      return res.json({ program: cached.rows[0], cached: true });
    }

    // Yeterli veri kontrolu
    const countResult = await db.query(
      'SELECT COUNT(*) FROM posture_records WHERE user_id = $1',
      [userId]
    );
    if (parseInt(countResult.rows[0].count) < 20) {
      return res.status(422).json({
        error: 'En az 20 postur kaydı gerekli.',
        current: parseInt(countResult.rows[0].count)
      });
    }

    const statsResult = await db.query(
      `SELECT
         ROUND(AVG(score)::NUMERIC, 1)                                                   AS avg_score,
         ROUND(AVG(neck_angle)::NUMERIC, 1)                                              AS avg_neck,
         ROUND(AVG(tension)::NUMERIC, 1)                                                 AS avg_tension,
         ROUND(AVG(shoulder_tilt)::NUMERIC, 1)                                           AS avg_shoulder,
         ROUND(AVG(head_tilt)::NUMERIC, 1)                                               AS avg_head_tilt,
         ROUND(AVG(center_offset)::NUMERIC, 1)                                           AS avg_center,
         ROUND((COUNT(*) FILTER (WHERE status='bad')::NUMERIC / NULLIF(COUNT(*),0)*100),1) AS bad_pct,
         COUNT(DISTINCT DATE(recorded_at))                                                AS active_days
       FROM posture_records WHERE user_id = $1`,
      [userId]
    );

    const recentResult = await db.query(
      `SELECT neck_angle, tension, shoulder_tilt, head_tilt, center_offset, score
       FROM posture_records
       WHERE user_id = $1
       ORDER BY recorded_at DESC LIMIT 400`,
      [userId]
    );

    const daysResult = await db.query(
      `SELECT COUNT(DISTINCT DATE(recorded_at)) AS days FROM posture_records WHERE user_id = $1`,
      [userId]
    );

    const llmResult = await generateExerciseProgram(
      statsResult.rows[0],
      recentResult.rows
    );

    if (!llmResult.success) {
      return res.status(502).json({ error: 'Program oluşturulamadı: ' + llmResult.error });
    }

    const saved = await db.query(
      `INSERT INTO exercise_programs (user_id, title, program, based_on_days, model_used)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [
        userId,
        llmResult.data.title || 'Kişisel Egzersiz Programı',
        JSON.stringify(llmResult.data),
        parseInt(daysResult.rows[0].days),
        llmResult.model
      ]
    );

    res.json({
      program: {
        id:           saved.rows[0].id,
        title:        llmResult.data.title,
        program:      llmResult.data,
        based_on_days: parseInt(daysResult.rows[0].days),
        created_at:   saved.rows[0].created_at,
        model_used:   llmResult.model,
      },
      cached: false,
    });
  } catch (err) {
    console.error('exercise program error:', err.message);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/ai/status  - AI servis durumunu kontrol et
router.get('/status', async (req, res) => {
  const ollamaOk = await isOllamaAvailable();
  const groqAktif = !!process.env.GROQ_API_KEY;
  res.json({
    groq_configured:   groqAktif,
    groq_model:        groqAktif ? (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile') : null,
    openai_configured: !groqAktif && !!process.env.OPENAI_API_KEY,
    ollama_available:  ollamaOk,
    ollama_model:      process.env.OLLAMA_MODEL || 'llama3.2',
    aktif_model:       groqAktif ? (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile') : 'gpt-4o-mini',
  });
});

module.exports = router;
