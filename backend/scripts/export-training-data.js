// ============================================================
// ADIM 1: Eğitim verisini dışa aktar
// Çalıştır: node backend/scripts/export-training-data.js
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

// Host'tan Docker'daki PostgreSQL'e bağlan (port 5432 mapped)
const pool = new Pool({
  host:     'localhost',
  port:     5432,
  database: process.env.POSTGRES_DB       || 'postur_takip',
  user:     process.env.POSTGRES_USER     || 'postur_user',
  password: process.env.POSTGRES_PASSWORD || '',
});

const SYSTEM_PROMPT =
`Sen bir Türk fizyoterapist ve sağlık analistisin. Kullanıcının postur verilerini KLİNİK VE DÜRÜST biçimde analiz et.
KURAL: Eşiği aşan her bölge için gerçekçi olasılık ver. Hiçbir riski 0.05 ile bırakma; veri eşiği aşıyorsa en az 0.25 olmalı.
Yanıtını kesinlikle JSON formatında ver, başka hiçbir şey yazma:
{"risk_level":"low|medium|high","summary":"Türkçe kısa özet","risks":[{"name":"Türkçe risk adı","probability":0.0-1.0,"description":"Türkçe açıklama"}],"recommendations":["Türkçe öneri"]}
risk_level: kötü duruş %30+ veya herhangi alan eşik üstündeyse en az medium olmalı.`;

function average(records, field) {
  if (!records.length) return 0;
  return records.reduce((s, r) => s + (parseFloat(r[field]) || 0), 0) / records.length;
}

async function main() {
  console.log('=== PosturTakip Fine-Tune — Eğitim Verisi Dışa Aktarma ===\n');

  const predictions = await pool.query(
    `SELECT id, user_id, risk_level, prediction_text, created_at
     FROM health_predictions
     WHERE prediction_text IS NOT NULL AND model_used != 'weekly-report'
     ORDER BY created_at DESC`
  );

  console.log(`Veritabanında ${predictions.rows.length} sağlık tahmini bulundu.`);

  if (predictions.rows.length === 0) {
    console.log('\nHenüz sağlık analizi yapılmamış.');
    console.log('Dashboard > AI Asistan > "Analizi Başlat" butonuna bas, veri biriktir.');
    await pool.end(); return;
  }

  const examples = [];

  for (const pred of predictions.rows) {
    // Bu tahminin yapıldığı andaki istatistikleri yeniden hesapla
    const [statsRes, recentRes] = await Promise.all([
      pool.query(
        `SELECT
           ROUND(AVG(score)::NUMERIC,1)  AS avg_score,
           ROUND((COUNT(*) FILTER (WHERE status='good')::NUMERIC / NULLIF(COUNT(*),0)*100),1) AS good_pct,
           ROUND((COUNT(*) FILTER (WHERE status='bad')::NUMERIC  / NULLIF(COUNT(*),0)*100),1) AS bad_pct,
           COUNT(DISTINCT DATE(recorded_at)) AS total_days
         FROM posture_records
         WHERE user_id = $1 AND recorded_at < $2`,
        [pred.user_id, pred.created_at]
      ),
      pool.query(
        `SELECT neck_angle, tension, shoulder_tilt
         FROM posture_records
         WHERE user_id = $1 AND recorded_at < $2
         ORDER BY recorded_at DESC LIMIT 200`,
        [pred.user_id, pred.created_at]
      ),
    ]);

    const stats   = statsRes.rows[0];
    const records = recentRes.rows;

    if (!stats.avg_score || records.length < 10) continue;

    const avgNeck     = average(records, 'neck_angle');
    const avgTension  = average(records, 'tension');
    const avgShoulder = average(records, 'shoulder_tilt');

    let predData;
    try { predData = JSON.parse(pred.prediction_text); } catch { continue; }
    if (!predData.risk_level || !predData.summary) continue;

    const userMsg =
`Kullanıcının ${stats.total_days} günlük postur verileri:
- Ortalama puan: ${stats.avg_score}/100
- İyi duruş yüzdesi: ${stats.good_pct}%
- Kötü duruş yüzdesi: ${stats.bad_pct}%
- Ortalama boyun açısı: ${avgNeck.toFixed(1)}° (normal: <12°, eşik aşımı: ${avgNeck > 12 ? 'EVET' : 'hayır'})
- Ortalama omuz gerginliği: ${avgTension.toFixed(1)}% (normal: <%22, eşik aşımı: ${avgTension > 22 ? 'EVET' : 'hayır'})
- Ortalama omuz eğimi: ${avgShoulder.toFixed(1)}° (normal: <4°, eşik aşımı: ${avgShoulder > 4 ? 'EVET' : 'hayır'})

Bu verilere göre sağlık risk analizi yap.`;

    const assistantMsg = JSON.stringify({
      risk_level:      predData.risk_level,
      summary:         predData.summary        || '',
      risks:           predData.risks           || [],
      recommendations: predData.recommendations || [],
    });

    examples.push({
      messages: [
        { role: 'system',    content: SYSTEM_PROMPT },
        { role: 'user',      content: userMsg },
        { role: 'assistant', content: assistantMsg },
      ],
    });
  }

  console.log(`${examples.length} geçerli eğitim örneği oluşturuldu.`);

  if (examples.length < 10) {
    console.log(`\nUYARI: Fine-tune için minimum 10 örnek gerekiyor (şu an: ${examples.length}).`);
    console.log('Daha fazla "Analizi Başlat" yaparak veri biriktirin.');
    console.log('Yine de dosya kaydedildi — hazır olduğunda tekrar çalıştırın.\n');
  }

  const outPath = path.join(__dirname, 'training_data.jsonl');
  fs.writeFileSync(outPath, examples.map(e => JSON.stringify(e)).join('\n'), 'utf8');
  console.log(`\n✓ Kaydedildi: ${outPath}`);
  console.log(`\nSonraki adım:`);
  console.log('  node backend/scripts/finetune-submit.js');

  await pool.end();
}

main().catch(err => { console.error('Hata:', err.message); process.exit(1); });
