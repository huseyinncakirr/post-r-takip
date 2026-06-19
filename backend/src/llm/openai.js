const OpenAI = require('openai');

let client = null;

function getClient() {
  if (!client) {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      client = new OpenAI({
        apiKey: groqKey,
        baseURL: 'https://api.groq.com/openai/v1',
      });
    } else {
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }
  return client;
}

function getModel() {
  if (process.env.GROQ_API_KEY) {
    return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  }
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

async function analyzeHealthRisk(stats, dailyData, recentRecords) {
  const openai = getClient();

  const avgScore    = parseFloat(stats.avg_score ?? 0);
  const goodPct     = parseFloat(stats.good_pct  ?? 0);
  const badPct      = parseFloat(stats.bad_pct   ?? 0);
  const totalDays   = dailyData.length;

  const avgNeck     = average(recentRecords, 'neck_angle');
  const avgTension  = average(recentRecords, 'tension');
  const avgShoulder = average(recentRecords, 'shoulder_tilt');
  const avgHeadTilt = average(recentRecords, 'head_tilt');
  const avgCenter   = average(recentRecords, 'center_offset');

  // Trend: son %25 vs önceki %25 karşılaştır
  const quarter = Math.max(1, Math.floor(recentRecords.length / 4));
  const recent  = recentRecords.slice(0, quarter);
  const older   = recentRecords.slice(-quarter);
  const trendNeck = average(recent, 'neck_angle') - average(older, 'neck_angle');
  const trendScore = average(recent, 'score') - average(older, 'score');
  const trendMetni = trendScore > 3 ? 'iyileşiyor' : trendScore < -3 ? 'kötüleşiyor' : 'stabil';

  // Eşik tespiti — her metrik için klinik öneme göre sınır
  const sorunlar = [];

  if (avgNeck > 22) {
    sorunlar.push({ seviye: 'KRİTİK', alan: 'Boyun öne eğilmesi', deger: `${avgNeck.toFixed(1)}°`, normal: '<12°', riskAraligi: '0.55–0.75', riskler: 'Servikal disk hernisi, boyun düzleşmesi (servikal lordoz kaybı), erken spondiloz' });
  } else if (avgNeck > 12) {
    sorunlar.push({ seviye: 'ORTA', alan: 'Boyun öne eğilmesi', deger: `${avgNeck.toFixed(1)}°`, normal: '<12°', riskAraligi: '0.28–0.48', riskler: 'Baş öne düşme sendromu, kronik baş ağrısı, servikal kas yorgunluğu' });
  }

  if (avgTension > 45) {
    sorunlar.push({ seviye: 'KRİTİK', alan: 'Omuz-trapez gerginliği', deger: `%${avgTension.toFixed(1)}`, normal: '<%20', riskAraligi: '0.55–0.80', riskler: 'Trapez kas sendromu, miyofasyal tetik nokta ağrısı, kronik boyun-omuz ağrısı' });
  } else if (avgTension > 20) {
    sorunlar.push({ seviye: 'ORTA', alan: 'Omuz-trapez gerginliği', deger: `%${avgTension.toFixed(1)}`, normal: '<%20', riskAraligi: '0.25–0.45', riskler: 'Kronik trapez gerilmesi, gerilim tipi baş ağrısı' });
  }

  if (avgShoulder > 9) {
    sorunlar.push({ seviye: 'KRİTİK', alan: 'Omuz dengesizliği', deger: `${avgShoulder.toFixed(1)}°`, normal: '<4°', riskAraligi: '0.40–0.65', riskler: 'Rotator manşet zorlanması, postüral skolyoz, asimetrik kas atrofisi' });
  } else if (avgShoulder > 4) {
    sorunlar.push({ seviye: 'ORTA', alan: 'Omuz dengesizliği', deger: `${avgShoulder.toFixed(1)}°`, normal: '<4°', riskAraligi: '0.18–0.35', riskler: 'Asimetrik kas gelişimi, omuz sıkışma sendromu başlangıcı' });
  }

  if (avgHeadTilt > 6) {
    sorunlar.push({ seviye: 'KRİTİK', alan: 'Baş yana eğilmesi', deger: `${avgHeadTilt.toFixed(1)}°`, normal: '<3°', riskAraligi: '0.40–0.60', riskler: 'Sternokleidomastoid kas kısalması, servikal faset eklem baskısı, baş ağrısı' });
  } else if (avgHeadTilt > 3) {
    sorunlar.push({ seviye: 'HAFIF', alan: 'Baş yana eğilmesi', deger: `${avgHeadTilt.toFixed(1)}°`, normal: '<3°', riskAraligi: '0.15–0.30', riskler: 'Boyun yan kasları asimetrisi, gerilim baş ağrısı riski' });
  }

  if (avgCenter > 14) {
    sorunlar.push({ seviye: 'ORTA', alan: 'Baş merkez kayması', deger: `%${avgCenter.toFixed(1)}`, normal: '<%7', riskAraligi: '0.25–0.45', riskler: 'Boyun asimetrik yüklenmesi, tek taraflı kas yorgunluğu' });
  } else if (avgCenter > 7) {
    sorunlar.push({ seviye: 'HAFIF', alan: 'Baş merkez kayması', deger: `%${avgCenter.toFixed(1)}`, normal: '<%7', riskAraligi: '0.12–0.25', riskler: 'Hafif boyun asimetrisi' });
  }

  const sorunMetni = sorunlar.length > 0
    ? sorunlar.map(s =>
        `[${s.seviye}] ${s.alan}: ${s.deger} (normal ${s.normal}) → risk olasılığı ${s.riskAraligi} arasında olmalı, ilgili riskler: ${s.riskler}`
      ).join('\n')
    : 'Tüm metrikler normal sınırlar içinde.';

  const systemPrompt = `Sen deneyimli bir Türk fizyoterapist ve klinik postüroloji uzmanısın.
Kullanıcının postur ölçüm verilerini KLİNİK, DÜRÜST ve KİŞİYE ÖZGÜ biçimde analiz et.

ZORUNLU KURALLAR:
1. YALNIZCA Türkçe yaz, tek bir İngilizce kelime bile kullanma
2. Verilen risk aralıklarına KESINLIKLE uy — kendi aralığını uydurma
3. risk_level belirleme: kötü duruş >%35 → "high"; >%15 veya herhangi eşik aşımı → "medium"; aksi → "low"
4. Tespit edilen sorunları doğrudan address et — genel tavsiye verme
5. 3-5 risk listele; her riskin description'ı bu kişinin spesifik değerlerine atıfta bulunsun
6. 4-5 öneri yaz; her öneri tespit edilen sorunlardan birine çözüm getirsin; somut, uygulanabilir olsun
7. summary: 2-3 cümle, kişinin verilerini sayısal olarak dahil et (ör: "Boyun açınız ortalama X° ile…")
8. SADECE JSON döndür, başka hiçbir şey yazma

JSON şeması (bu yapıyı koru):
{
  "risk_level": "low|medium|high",
  "summary": "...",
  "risks": [
    { "name": "Risk Adı", "probability": 0.00, "description": "Bu kişinin verilerine özel açıklama." }
  ],
  "recommendations": ["Öneri 1.", "Öneri 2.", "Öneri 3.", "Öneri 4."]
}`;

  const userMessage = `## Kullanıcı Duruş Profili (son ${recentRecords.length} ölçüm — ${totalDays} gün)

**Genel Performans**
- Duruş skoru: ${avgScore}/100 (iyi: %${goodPct} | kötü: %${badPct})
- Trend: ${trendMetni} (son dönem skor farkı: ${trendScore > 0 ? '+' : ''}${trendScore.toFixed(1)} puan)

**Bölgesel Ölçümler**
| Metrik | Ölçülen | Normal Sınır | Durum |
|---|---|---|---|
| Boyun öne eğimi | ${avgNeck.toFixed(1)}° | <12° | ${avgNeck > 22 ? '🔴 KRİTİK' : avgNeck > 12 ? '🟡 UYARI' : '🟢 NORMAL'} |
| Omuz gerginliği | %${avgTension.toFixed(1)} | <%20 | ${avgTension > 45 ? '🔴 KRİTİK' : avgTension > 20 ? '🟡 UYARI' : '🟢 NORMAL'} |
| Omuz dengesizliği | ${avgShoulder.toFixed(1)}° | <4° | ${avgShoulder > 9 ? '🔴 KRİTİK' : avgShoulder > 4 ? '🟡 UYARI' : '🟢 NORMAL'} |
| Baş yana eğimi | ${avgHeadTilt.toFixed(1)}° | <3° | ${avgHeadTilt > 6 ? '🔴 KRİTİK' : avgHeadTilt > 3 ? '🟡 UYARI' : '🟢 NORMAL'} |
| Baş merkez kayması | %${avgCenter.toFixed(1)} | <%7 | ${avgCenter > 14 ? '🔴 KRİTİK' : avgCenter > 7 ? '🟡 UYARI' : '🟢 NORMAL'} |
| Boyun trendi | ${trendNeck > 2 ? '+'+trendNeck.toFixed(1)+'° kötüleşiyor' : trendNeck < -2 ? trendNeck.toFixed(1)+'° iyileşiyor' : 'stabil'} | — | — |

**Tespit Edilen Sorunlar ve Risk Aralıkları** (bu aralıklara uy):
${sorunMetni}

Yukarıdaki verilere göre bu kişiye ÖZEL sağlık risk analizi yap.`;

  const model = getModel();

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1200,
      temperature: 0.4,
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return { success: true, data: parsed, model };
  } catch (err) {
    console.error('Groq/OpenAI health risk error:', err.status, err.message);
    let msg = 'AI analizi şu an kullanılamıyor.';
    const s = err.status || 0;
    const m = (err.message || '').toLowerCase();
    if (s === 429 || m.includes('rate') || m.includes('quota') || m.includes('limit')) {
      msg = 'AI kota sınırı doldu. Birkaç dakika sonra tekrar deneyin.';
    } else if (s === 401 || s === 403 || m.includes('auth') || m.includes('key')) {
      msg = 'AI servisi kimlik doğrulaması başarısız. Yöneticiyle iletişime geçin.';
    } else if (s >= 500) {
      msg = 'AI servisi geçici olarak kullanılamıyor. Lütfen sonra tekrar deneyin.';
    }
    return { success: false, error: msg };
  }
}

function average(records, field) {
  if (!records || records.length === 0) return 0;
  const sum = records.reduce((acc, r) => acc + (parseFloat(r[field]) || 0), 0);
  return sum / records.length;
}

module.exports = { analyzeHealthRisk };
