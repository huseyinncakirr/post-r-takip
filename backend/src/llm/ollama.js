// =============================================================
// OLLAMA.JS — Yerel AI Modeli Bağlantısı
// Bu dosya, bilgisayarda çalışan Ollama modeliyle (llama3.2)
// iletişim kurar. OpenAI'ye alternatif olarak kullanılır.
// İki ana görev: sağlık risk analizi + kişisel egzersiz programı
// =============================================================
const http = require('http');

// Türkçe metinlerde kalıp kalan İngilizce kelimeleri otomatik düzelten liste
// Model bazen İngilizce kelime sızdırıyor, bu liste onları yakalıyor
const TR_DUZELTME = [
  [/frequent\s+olarak/gi,   'sık olarak'],
  [/regular\s+massage/gi,   'düzenli masaj'],
  [/repeat\s+or/gi,         'tekrar veya'],
  [/friend\s*size/gi,       'arkadaşlarınızla'],
  [/back['']?[aı]?\b/gi,   'geri'],
  [/frenteye\b/gi,          'öne doğru'],
  [/\bfrente\b/gi,          'öne'],
  [/\bslightly\b/gi,        'hafif'],
  [/\bfrequently\b/gi,      'sıklıkla'],
  [/\bfrequent\b/gi,        'sık'],
  [/\bregularly\b/gi,       'düzenli olarak'],
  [/\bregular\b/gi,         'düzenli'],
  [/\bmassage\b/gi,         'masaj'],
  [/\btogether\b/gi,        'birlikte'],
  [/regionlarını\b/gi,      'bölgelerini'],
  [/regionları\b/gi,        'bölgeleri'],
  [/regionından\b/gi,       'bölgesinden'],
  [/regionında\b/gi,        'bölgesinde'],
  [/regionına\b/gi,         'bölgesine'],
  [/regionını\b/gi,         'bölgesini'],
  [/regionı\b/gi,           'bölgesi'],
  [/\bregion\b/gi,          'bölge'],
  [/\bseconds\b/gi,         'saniye'],
  [/\bminutes\b/gi,         'dakika'],
  [/\bweekly\b/gi,          'haftalık'],
  [/\bdaily\b/gi,           'günlük'],
  [/\bExersiz/g,            'Egzersiz'],
  [/\bexersiz\b/gi,         'egzersiz'],
  [/\bexercise\b/gi,        'egzersiz'],
  [/\bstretching\b/gi,      'germe egzersizi'],
  [/\bstretch\b/gi,         'germe'],
  [/\bposture\b/gi,         'duruş'],
  [/\btension\b/gi,         'gerginlik'],
  [/\balignment\b/gi,       'hizalama'],
  [/\bposition\b/gi,        'pozisyon'],
  [/\bmuscles\b/gi,         'kaslar'],
  [/\bmuscle\b/gi,          'kas'],
  [/\bpain\b/gi,            'ağrı'],
  [/\bneck\b/gi,            'boyun'],
  [/\bshoulder\b/gi,        'omuz'],
  [/\bspine\b/gi,           'omurga'],
  [/\bslowly\b/gi,          'yavaşça'],
  [/\bgently\b/gi,          'nazikçe'],
  [/\brepeat\b/gi,          'tekrar'],
  [/\bhold\b/gi,            'tut'],
  [/\bkeep\b/gi,            'koru'],
  [/\band\b/gi,             've'],
  [/\bnecessary\b/gi,       'gereklidir'],
  [/\bimportant\b/gi,       'önemli'],
  [/\bdeep breathing\b/gi,  'derin nefes alma'],
  [/\bbreathing\b/gi,       'nefes alma'],
  [/\bbreath\b/gi,          'nefes'],
  [/\bwarning\b/gi,         'uyarı'],
  [/\bnote\b/gi,            'not'],
  [/\s{2,}/g,               ' '],
];

function temizleMetin(m) {
  if (!m || typeof m !== 'string') return m;
  var s = m;
  TR_DUZELTME.forEach(function(c) { s = s.replace(c[0], c[1]); });
  return s.trim();
}

function temizleNesne(nesne) {
  if (typeof nesne === 'string') return temizleMetin(nesne);
  if (Array.isArray(nesne)) return nesne.map(temizleNesne);
  if (nesne && typeof nesne === 'object') {
    var yeni = {};
    Object.keys(nesne).forEach(function(k) { yeni[k] = temizleNesne(nesne[k]); });
    return yeni;
  }
  return nesne;
}

const OLLAMA_URL   = process.env.OLLAMA_URL  || 'http://localhost:8080';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'dikdur';

// llama-server OpenAI-uyumlu API'sine istek gönderir
function ollamaRequest(payload) {
  return new Promise((resolve, reject) => {
    const { model, prompt, system, options } = payload;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    const chatBody = JSON.stringify({
      model:       model || OLLAMA_MODEL,
      messages,
      max_tokens:  options?.num_predict || 1200,
      temperature: options?.temperature || 0.3,
      stream:      false,
    });
    const url = new URL('/v1/chat/completions', OLLAMA_URL);

    const reqOptions = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(chatBody),
      },
    };

    const req = http.request(reqOptions, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed.choices?.[0]?.message?.content || '');
        } catch {
          resolve(raw);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy(new Error('llama-server timeout'));
    });
    req.write(chatBody);
    req.end();
  });
}

// llama-server'ın çalışıp çalışmadığını kontrol et
async function isOllamaAvailable() {
  return new Promise((resolve) => {
    const url = new URL('/health', OLLAMA_URL);
    const req = http.get({ hostname: url.hostname, port: url.port || 80, path: url.pathname }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

// Saglik risk analizi — OpenAI kotasi dolunca Ollama ile yapilir.
// Hangi bolge kotu cikiyorsa o bolgeye ozgu hastaliklar prompt'a eklenir.
async function analyzeHealthRisk(stats, dailyData, recentRecords, modelOverride) {
  const KULLANIILAN_MODEL = modelOverride || OLLAMA_MODEL;
  const avgScore    = stats.avg_score ?? 0;
  const goodPct     = stats.good_pct  ?? 0;
  const badPct      = stats.bad_pct   ?? 0;
  const totalDays   = dailyData.length;
  const avgNeck     = average(recentRecords, 'neck_angle');
  const avgTension  = average(recentRecords, 'tension');
  const avgShoulder = average(recentRecords, 'shoulder_tilt');

  // Hangi bolge kotu cikiyor? Buna gore ozgul hastalik bilgisi olustur
  const bolgeUyarilari = [];
  if (avgNeck > 22) {
    bolgeUyarilari.push('BOYUN CIDDI SORUNLU (ortalama ' + avgNeck.toFixed(1) + '°): Servikal disk fıtığı, boyun düzleşmesi (servikal lordoz kaybı), boyun kaslarında kronik gerilim, servikal spondiloz, ense ağrısı sendromu risklerini mutlaka listele.');
  } else if (avgNeck > 12) {
    bolgeUyarilari.push('BOYUN HAFİF SORUNLU (' + avgNeck.toFixed(1) + '°): Boyun kaslarında başlangıç gerilmesi, baş ağrısı riskini belirt.');
  }
  if (avgTension > 45) {
    bolgeUyarilari.push('OMUZ GERGİNLİĞİ ÇOK YÜKSEK (%' + avgTension.toFixed(1) + '): Trapez kas sendromu, miyofasyal ağrı sendromu, omuz-boyun kavşağı zorlanması, tetik nokta sendromu, kronik omuz ağrısı risklerini listele.');
  } else if (avgTension > 22) {
    bolgeUyarilari.push('OMUZ GERGİNLİĞİ ORTA (%' + avgTension.toFixed(1) + '): Trapez kaslarında başlangıç kronik gerilme, stres kaynaklı omuz yükselmesi riskini belirt.');
  }
  if (avgShoulder > 9) {
    bolgeUyarilari.push('OMUZ DENGESİZLİĞİ CİDDİ (' + avgShoulder.toFixed(1) + '°): Omuz sıkışması sendromu, rotator manşet zorlanması, asimetrik kas gelişimi, postüral skolyoz eğilimi risklerini listele.');
  } else if (avgShoulder > 4) {
    bolgeUyarilari.push('OMUZ EĞİMİ ORTA (' + avgShoulder.toFixed(1) + '°): Hafif omuz asimetrisi, tek taraflı kas gerilmesi riskini belirt.');
  }

  const bolgeMetni = bolgeUyarilari.length > 0
    ? '\n\nÖNEMLİ — Bu bölgeler sorunlu, bu hastalıklara özellikle odaklan:\n' + bolgeUyarilari.join('\n')
    : '';

  const riskLevel = badPct > 35 ? 'high' : (badPct > 15 || avgNeck > 12 || avgTension > 22 || avgShoulder > 4) ? 'medium' : 'low';

  const prompt = `Aşağıdaki duruş ölçüm verilerini analiz et ve YALNIZCA geçerli JSON döndür. Başka hiçbir şey yazma.

VERİLER:
- Toplam gün: ${totalDays}
- Ortalama puan: ${avgScore}/100
- İyi duruş oranı: %${goodPct}
- Kötü duruş oranı: %${badPct}
- Boyun açısı: ${avgNeck.toFixed(1)}° (normal: 12° altı)
- Omuz gerginliği: %${avgTension.toFixed(1)} (normal: %22 altı)
- Omuz eğimi: ${avgShoulder.toFixed(1)}° (normal: 4° altı)
${bolgeMetni}

ÇIKTI FORMATI (sadece bu JSON, başka hiçbir şey):
{"risk_level":"${riskLevel}","summary":"[Bu kişinin verilerine göre 2 cümle özet - boyun ${avgNeck.toFixed(0)}°, omuz %${avgTension.toFixed(0)} değerlerini mutlaka kullan]","risks":[{"name":"[Risk adı]","probability":0.40,"description":"[Bu kişiye özel açıklama]"},{"name":"[Risk adı 2]","probability":0.25,"description":"[Bu kişiye özel açıklama]"}],"recommendations":["[Somut öneri 1]","[Somut öneri 2]","[Somut öneri 3]"]}`;

  try {
    const response = await ollamaRequest({
      model:   KULLANIILAN_MODEL,
      system:  'Sen DikDur uygulaması için eğitilmiş bir postür analizi ve fizyoterapi uzmanısın. Kullanıcıların duruş verilerini analiz ederek JSON formatında Türkçe sağlık raporu üretiyorsun. Sadece JSON döndür, başka hiçbir şey yazma.',
      prompt:  prompt,
      options: { temperature: 0.2, num_predict: 800 },
    });

    const jsonMatch = response.match(/\{[\s\S]*/);
    if (!jsonMatch) throw new Error('Modelden JSON alınamadı');

    const parsed = jsonOnari(jsonMatch[0]);
    if (!parsed) throw new Error('JSON onarılamadı');

    return { success: true, data: temizleNesne(parsed), model: KULLANIILAN_MODEL + ' (yerel)' };
  } catch (err) {
    console.error('Ollama health risk error:', err.message);
    return { success: false, error: err.message };
  }
}

// -----------------------------------------------------------------------
// Egzersiz kütüphanesi — şiddet seviyesine göre katmanlı egzersizler.
// Her kategori hafif/orta/yüksek/kritik şiddet için ayrı egzersiz içerir.
// -----------------------------------------------------------------------
const EGZERSIZ_KUTUPHANESI = {

  // BOYUN ÖNE EĞİLMESİ
  boyun_hafif: [{
    ad: 'Boyun Döndürme',
    set: 2, tekrar: '10 tekrar (her yön)',
    hedef_bolge: 'Boyun — servikal döndürücüler',
    nasil_yapilir: 'Dik otur. Başını yavaşça sağa döndür, 3 saniye tut, merkeze dön. Sola tekrarla. Hareket yavaş ve kontrollü olsun, omuzlar sabit kalsın.',
    faydalari: 'Servikal eklem hareketliliğini artırır, boyun kaslarını ısıtır ve hafif tutukluğu giderir.',
    siklik: 'Günde 2 kez, haftanın her günü',
  }],
  boyun_orta: [{
    ad: 'Boyun Ekstansiyonu',
    set: 3, tekrar: '10 tekrar',
    hedef_bolge: 'Boyun arka kasları — servikal ekstansörler',
    nasil_yapilir: 'Dik otur. Başını yavaşça geriye eğ, tavana bak, 3 saniye tut, başlangıç pozisyonuna dön. Hız yapma, boyun gerilimini hisset.',
    faydalari: 'Öne eğilimle zayıflayan boyun arka kaslarını güçlendirir, servikal lordozu destekler.',
    siklik: 'Haftada 5 gün',
  }],
  boyun_yuksek: [{
    ad: 'Çene Geri Çekme',
    set: 3, tekrar: '12 tekrar (5sn bekleme)',
    hedef_bolge: 'Boyun — derin servikal fleksörler',
    nasil_yapilir: 'Dik otur ya da ayakta dur. Çeneni içe çekerek başını hafifçe geriye götür, sanki çene altında çift çene oluşturuyor gibi. 5 saniye tut, bırak. Boyun uzun kalsın, omuzlar düşük.',
    faydalari: 'Derin servikal kasları güçlendirir, servikal diski rahatlatır ve baş öne düşme duruşunu düzeltir.',
    siklik: 'Günde 2 kez, haftanın her günü',
  }],
  boyun_kritik: [{
    ad: 'İzometrik Boyun Güçlendirme',
    set: 3, tekrar: '10 tekrar (her yön, 5sn)',
    hedef_bolge: 'Tüm boyun kasları — derin stabilizatörler',
    nasil_yapilir: 'Dik otur. Avucunu alnına koy, başını öne itmeye çalış ama elin direnci yüzünden hareket etmesin. 5 saniye izometrik kas. Şakağa koy, sağa-sola tekrarla. 4 yön.',
    faydalari: 'Servikal disk baskısını azaltır, tüm boyun kaslarını eklem hareketi olmadan güçlendirir. Kritik boyun sorunlarında güvenli seçenek.',
    siklik: 'Günde 2 kez, haftanın her günü',
  }],

  // OMUZ GERGİNLİĞİ
  omuz_gerginlik_hafif: [{
    ad: 'Omuz Döngüsü',
    set: 3, tekrar: '10 ileri, 10 geri',
    hedef_bolge: 'Omuz kuşağı — trapez üst lif',
    nasil_yapilir: 'Oturarak omuzları önce yukarı kaldır, sonra geriye döndür, aşağı indir — tam daire çiz. Geriye döngüde omuz bıçakları sıkıştığını hisset.',
    faydalari: 'Omuz eklemini mobilize eder, hafif trapez gerginliğini serbest bırakır.',
    siklik: 'Günde 2 kez',
  }],
  omuz_gerginlik_orta: [{
    ad: 'Üst Trapez Germe',
    set: 3, tekrar: '30 saniye (her taraf)',
    hedef_bolge: 'Üst trapez — boyun-omuz kavşağı',
    nasil_yapilir: 'Dik otur. Sağ eli başın sol tarafına koy, başı sağ omza doğru nazikçe çek. Sol omuz aşağıda kalsın. 30 saniye tut, yer değiştir.',
    faydalari: 'Sürekli kasılı kalan üst trapezi gevşetir, boyun-omuz gerilimini ve baş ağrısını azaltır.',
    siklik: 'Günde 2 kez, haftanın her günü',
  }],
  omuz_gerginlik_yuksek: [{
    ad: 'Levator Scapulae Germe',
    set: 3, tekrar: '40 saniye (her taraf)',
    hedef_bolge: 'Levator scapulae — boyun-kürek arası derin kas',
    nasil_yapilir: 'Başı 45° yana çevir, aynı tarafa bak. Çeneyi göğse doğru eğ. Karşı elin gerilen tarafın başını nazikçe baskıla. 40 saniye tut, her taraf.',
    faydalari: 'Boyun-kürek arası derin kasları uzatır, kronik omuz yükselmesini ve tutukluğu giderir.',
    siklik: 'Haftada 5 gün',
  }],
  omuz_gerginlik_kritik: [{
    ad: 'Trapez Tetik Nokta Baskısı',
    set: 3, tekrar: '60 saniye (her taraf)',
    hedef_bolge: 'Trapez — miyofasyal tetik noktalar',
    nasil_yapilir: 'Otur. Sağ elin baş parmağıyla sol omuz kasında en ağrılı noktayı bul. Orta şiddette baskı uygula, 60 saniye tut. Nefes alırken baskıyı hisset. Sol elle tekrarla.',
    faydalari: 'Miyofasyal tetik noktaları devre dışı bırakır, kronik kas sertliğini çözer. Yüksek gerginlikte trapez masajının en etkili alternatifi.',
    siklik: 'Günde 1 kez, yatmadan önce',
  }],

  // OMUZ DENGESİZLİĞİ
  omuz_dengesiz_hafif: [{
    ad: 'Omuz Geri Çekme',
    set: 3, tekrar: '12 tekrar',
    hedef_bolge: 'Orta trapez — rhomboidler',
    nasil_yapilir: 'Dik otur, kollar yanda. Omuz bıçaklarını birbirine doğru sık, 3 saniye tut, bırak. Omuzlar yukarı kalkmasın.',
    faydalari: 'Rhomboid kasları aktive eder, öne düşen omuzları geri çeker.',
    siklik: 'Haftada 5 gün',
  }],
  omuz_dengesiz_orta: [{
    ad: 'Kürek Kemiği Geri Çekme (Güçlü)',
    set: 3, tekrar: '15 tekrar (5sn bekleme)',
    hedef_bolge: 'Orta trapez — rhomboidler — alt trapez',
    nasil_yapilir: 'Dik otur. Omuz bıçaklarını maksimum geri çek, 5 saniye kasılı tut, yavaşça bırak. Omuzlar aşağıda kalsın, boyun uzun.',
    faydalari: 'Zayıf rhomboid kaslarını derinlemesine güçlendirir, omuz asimetrisini giderir.',
    siklik: 'Haftada 5 gün',
  }],
  omuz_dengesiz_yuksek: [{
    ad: 'Duvar Meleği',
    set: 3, tekrar: '12 tekrar',
    hedef_bolge: 'Omuz stabilizatörleri — sırt üst — seratus anterior',
    nasil_yapilir: 'Sırtını duvara daya, topuklar duvara değsin. Kolları 90° dirsek bükerek duvara yapıştır. Yavaşça yukarı kaydır (duvara yapışık kalsın), indir. Bel duvara yapışık kalsın.',
    faydalari: 'Tüm omuz stabilizatörlerini dengeli çalıştırır, asimetrik kas gelişimini düzeltir.',
    siklik: 'Haftada 4 gün',
  }],
  omuz_dengesiz_kritik: [{
    ad: 'Tek Taraf Kürek Güçlendirme',
    set: 3, tekrar: '15 tekrar (zayıf taraf çift)',
    hedef_bolge: 'Zayıf taraf rhomboid — orta trapez',
    nasil_yapilir: 'Dik otur. Daha zayıf olan omzu geri çek, 5 saniye izometrik tut. Bırak. Zayıf tarafa 15 tekrar, güçlü tarafa 8 tekrar yap. Asimetriyi dengele.',
    faydalari: 'Dominant ve zayıf omuz farkını kapatır, postüral skolyoz riskini azaltır.',
    siklik: 'Haftada 5 gün',
  }],

  // BAŞ YANA EĞİLMESİ
  bas_yan_orta: [{
    ad: 'Boyun Yan Germe',
    set: 3, tekrar: '30 saniye (her taraf)',
    hedef_bolge: 'Sternokleidomastoid — boyun yan kasları',
    nasil_yapilir: 'Dik otur. Başı sağ omza doğru eğ, sol omuz aşağıda sabit kalsın. 30 saniye bekle. Sol tarafa tekrarla. Baş öne eğilmesin.',
    faydalari: 'Aşırı yüklenen boyun yan kaslarını uzatır, baş yana eğilmesini ve asimetrik kas gelişimini önler.',
    siklik: 'Günde 2 kez, haftanın her günü',
  }],
  bas_yan_kritik: [{
    ad: 'SCM Kasını Germe ve Güçlendirme',
    set: 3, tekrar: '30sn germe + 10 tekrar güçlendirme',
    hedef_bolge: 'Sternokleidomastoid — skalene kasları',
    nasil_yapilir: 'Otur. Başı sağa döndür, hafif geriye eğ — boyun sol yanında gerilme hissedeceksin. 30 saniye tut. Sonra dirençsiz başı yavaşça sola getir, 3 saniye tut. Her taraf.',
    faydalari: 'SCM kasının hem kısalmış hem de zayıf olan liflerini aynı anda hedefler, baş asimetrisini düzeltir.',
    siklik: 'Günde 2 kez',
  }],

  // MERKEZ KAYMASI
  merkez_kayma_orta: [{
    ad: 'Ayna Önü Duruş Hizalama',
    set: 1, tekrar: '5 dakika',
    hedef_bolge: 'Postüral farkındalık — tüm omurga',
    nasil_yapilir: 'Ayna önünde dik dur. Kulaklar omuzun üzerinde, omuzlar kalçanın üzerinde hizala. Bu pozisyonu hisset ve 5 dakika koru. Nefes alırken göğüs genişlesin.',
    faydalari: 'Doğru hizayı kas hafızasına işler, merkez kaymasının farkındalığını artırır.',
    siklik: 'Haftanın 5 günü, sabah rutini',
  }],
  merkez_kayma_kritik: [{
    ad: 'Derin Boyun Fleksörü Aktivasyonu',
    set: 3, tekrar: '10 tekrar (10sn bekleme)',
    hedef_bolge: 'Derin servikal fleksörler — longus colli',
    nasil_yapilir: 'Sırt üstü yat, diz büklü. Çeneyi hafifçe içe çek, kafayı zeminden 1cm kaldır, 10 saniye tut, yavaşça indir. Boyun kasılı kalmalı ama gergin değil.',
    faydalari: 'Baş merkez kaymasının temel nedeni olan derin boyun kaslarını güçlendirir. Boyun omurgasını doğal pozisyonuna getirir.',
    siklik: 'Günde 1 kez',
  }],

  // GENEL (sadece sorun yoksa)
  genel: [
    {
      ad: 'Göğüs Açma Egzersizi',
      set: 3, tekrar: '10 tekrar',
      hedef_bolge: 'Pektoral kaslar — ön omuz',
      nasil_yapilir: 'Ayakta dur, kolları T şeklinde yana aç. Omuzları geriye ve aşağıya çek, göğüs kafesini öne ver. 10 saniye tut, başlangıca dön. Çene içeride kalsın.',
      faydalari: 'Kasılan göğüs kaslarını uzatır, öne kapanan omuzları açar ve genel duruşu düzeltir.',
      siklik: 'Haftada 5 gün',
    },
    {
      ad: 'Omurga Mobilizasyon',
      set: 3, tekrar: '10 tekrar',
      hedef_bolge: 'Tüm omurga — paravertebral kaslar',
      nasil_yapilir: 'Dört ayak pozisyonunda başla. Nefes alırken sırtı aşağı eğ (bel içbükey), nefes verirken sırtı yukarı itmek (kambur). Her pozisyonda 2 saniye bekle.',
      faydalari: 'Tüm omurga eklemlerini mobilize eder, omurga esnekliğini artırır ve genel postüral tonus sağlar.',
      siklik: 'Sabah kalkışta haftanın her günü',
    },
    {
      ad: 'Diyafram Nefes Egzersizi',
      set: 1, tekrar: '10 nefes',
      hedef_bolge: 'Diyafram — boyun yardımcı solunum kasları',
      nasil_yapilir: 'Otur ya da yat. Bir elini göğsüne, bir elini karna koy. Burundan 4 saniye nefes al, karn şişsin, göğüs sabit. 4 saniye tut. Ağızdan 6 saniye bırak.',
      faydalari: 'Solunum için boyun kaslarını kullanan yanlış solunum düzenini düzeltir, üst trapez gerginliğini azaltır.',
      siklik: 'Günde 3 kez, özellikle stres anlarında',
    },
  ],
};

// Şiddet skoru hesapla (0-100 arası, 100 = kritik)
function siddetSkor(deger, esikler) {
  const { hafif, orta, yuksek, kritik } = esikler;
  if (deger >= kritik) return 100;
  if (deger >= yuksek) return 70 + ((deger - yuksek) / (kritik - yuksek)) * 30;
  if (deger >= orta)   return 40 + ((deger - orta)   / (yuksek - orta))   * 30;
  if (deger >= hafif)  return 10 + ((deger - hafif)  / (orta - hafif))    * 30;
  return 0;
}

function egzersizSec(metrikler) {
  const { avgNeck, avgTension, avgShoulder, avgHeadTilt, avgCenter } = metrikler;

  // Her sorunun şiddet skoru
  const sorunlar = [
    {
      ad: 'boyun',
      skor: siddetSkor(avgNeck,     { hafif: 8,  orta: 12, yuksek: 18, kritik: 25 }),
      deger: avgNeck,
      sec: (s) => {
        if (s >= 90) return ['boyun_kritik', 'boyun_yuksek'];
        if (s >= 60) return ['boyun_yuksek', 'boyun_orta'];
        if (s >= 30) return ['boyun_orta'];
        return ['boyun_hafif'];
      },
    },
    {
      ad: 'omuz_gerginlik',
      skor: siddetSkor(avgTension,  { hafif: 15, orta: 22, yuksek: 35, kritik: 50 }),
      deger: avgTension,
      sec: (s) => {
        if (s >= 90) return ['omuz_gerginlik_kritik', 'omuz_gerginlik_yuksek'];
        if (s >= 60) return ['omuz_gerginlik_yuksek', 'omuz_gerginlik_orta'];
        if (s >= 30) return ['omuz_gerginlik_orta'];
        return ['omuz_gerginlik_hafif'];
      },
    },
    {
      ad: 'omuz_dengesiz',
      skor: siddetSkor(avgShoulder, { hafif: 2,  orta: 4,  yuksek: 7,  kritik: 12 }),
      deger: avgShoulder,
      sec: (s) => {
        if (s >= 90) return ['omuz_dengesiz_kritik', 'omuz_dengesiz_yuksek'];
        if (s >= 60) return ['omuz_dengesiz_yuksek'];
        if (s >= 30) return ['omuz_dengesiz_orta'];
        return ['omuz_dengesiz_hafif'];
      },
    },
    {
      ad: 'bas_yan',
      skor: siddetSkor(avgHeadTilt, { hafif: 2,  orta: 3,  yuksek: 5,  kritik: 8  }),
      deger: avgHeadTilt,
      sec: (s) => s >= 60 ? ['bas_yan_kritik'] : ['bas_yan_orta'],
    },
    {
      ad: 'merkez_kayma',
      skor: siddetSkor(avgCenter,   { hafif: 5,  orta: 8,  yuksek: 12, kritik: 18 }),
      deger: avgCenter,
      sec: (s) => s >= 60 ? ['merkez_kayma_kritik'] : ['merkez_kayma_orta'],
    },
  ].filter(s => s.skor >= 10) // sadece gerçek sorunları dahil et
   .sort((a, b) => b.skor - a.skor); // en kötüden en iyiye sırala

  const secilen = [];
  const kullanilan = new Set();

  function egzersizEkle(kategori) {
    const liste = EGZERSIZ_KUTUPHANESI[kategori];
    if (!liste) return;
    for (const egzersiz of liste) {
      if (!kullanilan.has(egzersiz.ad)) {
        secilen.push(egzersiz);
        kullanilan.add(egzersiz.ad);
        return;
      }
    }
  }

  // En kötü sorun için 2 egzersiz, diğerleri için 1'er
  sorunlar.forEach((sorun, i) => {
    const kategoriler = sorun.sec(sorun.skor);
    const adet = i === 0 ? Math.min(2, kategoriler.length) : 1;
    kategoriler.slice(0, adet).forEach(egzersizEkle);
    if (secilen.length >= 5) return;
  });

  // Eğer hiç sorun yoksa genel egzersizler ver
  if (secilen.length === 0) {
    EGZERSIZ_KUTUPHANESI.genel.forEach(e => {
      if (!kullanilan.has(e.ad)) { secilen.push(e); kullanilan.add(e.ad); }
    });
  }

  // 3'ten azsa genel ile tamamla
  if (secilen.length < 3) {
    for (const e of EGZERSIZ_KUTUPHANESI.genel) {
      if (!kullanilan.has(e.ad)) { secilen.push(e); kullanilan.add(e.ad); }
      if (secilen.length >= 3) break;
    }
  }

  return secilen.slice(0, 5);
}

async function generateExerciseProgram(stats, recentRecords) {
  const avgNeck     = average(recentRecords, 'neck_angle');
  const avgTension  = average(recentRecords, 'tension');
  const avgShoulder = average(recentRecords, 'shoulder_tilt');
  const avgHeadTilt = average(recentRecords, 'head_tilt');
  const avgCenter   = average(recentRecords, 'center_offset');
  const avgScore    = parseFloat(stats.avg_score ?? 50);
  const badPct      = parseFloat(stats.bad_pct   ?? 0);

  const egzersizler = egzersizSec({ avgNeck, avgTension, avgShoulder, avgHeadTilt, avgCenter });

  // Tespit edilen sorunları şiddet sırasıyla özetle
  const sorunlar = [];
  if (avgNeck > 12)    sorunlar.push({ ad: 'boyun öne eğimi', deger: `${avgNeck.toFixed(1)}°`, normal: '12°', siddet: avgNeck > 22 ? 'KRİTİK' : avgNeck > 18 ? 'YÜKSEK' : 'ORTA' });
  if (avgTension > 20) sorunlar.push({ ad: 'omuz-trapez gerginliği', deger: `%${avgTension.toFixed(1)}`, normal: '%20', siddet: avgTension > 45 ? 'KRİTİK' : avgTension > 35 ? 'YÜKSEK' : 'ORTA' });
  if (avgShoulder > 4) sorunlar.push({ ad: 'omuz dengesizliği', deger: `${avgShoulder.toFixed(1)}°`, normal: '4°', siddet: avgShoulder > 9 ? 'KRİTİK' : avgShoulder > 7 ? 'YÜKSEK' : 'ORTA' });
  if (avgHeadTilt > 3) sorunlar.push({ ad: 'baş yana eğimi', deger: `${avgHeadTilt.toFixed(1)}°`, normal: '3°', siddet: avgHeadTilt > 6 ? 'YÜKSEK' : 'ORTA' });
  if (avgCenter > 8)   sorunlar.push({ ad: 'baş merkez kayması', deger: `${avgCenter.toFixed(1)}px`, normal: '8px', siddet: avgCenter > 14 ? 'YÜKSEK' : 'ORTA' });

  const sorunOzet = sorunlar.length > 0
    ? `Bu program ${sorunlar.map(s => `${s.ad} (${s.deger}, normal sınır: ${s.normal})`).join('; ')} sorunlarınız için kişisel olarak hazırlandı. Egzersizler en şiddetli sorununuza öncelik verecek şekilde sıralandı.`
    : 'Ölçümleriniz normal sınırlar içinde. Aşağıdaki egzersizler mevcut iyi duruşunuzu korumak için tasarlandı.';

  const siddetSeviye = avgScore >= 80 ? 'hafif' : avgScore >= 60 ? 'orta' : 'yüksek';

  const program = {
    baslik: sorunlar.length > 0
      ? `${sorunlar[0].ad.charAt(0).toUpperCase() + sorunlar[0].ad.slice(1)} odaklı kişisel program`
      : 'Koruyucu Duruş Programı',
    sure_hafta: 4,
    gunluk_dakika: egzersizler.length * 4,
    haftada_kac_gun: 5,
    egzersizler,
    genel_notlar: `${sorunOzet} Duruş bozukluğu ${siddetSeviye} düzeyde (puan: ${avgScore}/100, kötü duruş oranı: %${badPct}). Egzersizleri yavaş ve kontrollü yapın; ağrı hissederseniz durdurun.`,
  };

  return { success: true, data: program, model: 'kural-tabanli-v1' };
}

// JSON Onarıcı — model num_predict limitine çarpınca JSON yarıda kesilebiliyor.
// Bu fonksiyon kesilmiş JSON'ı alıp son tam nesneyi bularak kapatmaya çalışır.
// Örnek: [..., {"ad":"Boyun Germe", "set":3 <-- kesildi]  →  [...]}  şeklinde kapatır.
function jsonOnari(ham) {
  // Önce doğrudan parse dene — zaten geçerliyse hemen dön
  try { return JSON.parse(ham); } catch {}

  // Cevaptan JSON bloğunu çıkar ({ ile başlayan kısım)
  const esles = ham.match(/\{[\s\S]*/);
  if (!esles) return null;
  let s = esles[0];

  // Karakter karakter gez: son tam kapanan iç nesne ( } ) pozisyonunu bul
  let derinlik = 0;
  let sonIcKapan = -1;  // kök { hariç kapanan son } pozisyonu
  let metinde = false;
  let kacis = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (kacis)           { kacis = false; continue; }
    if (c === '\\' && metinde) { kacis = true; continue; }
    if (c === '"')       { metinde = !metinde; continue; }
    if (metinde)         continue;
    if (c === '{')       derinlik++;
    if (c === '}') {
      derinlik--;
      if (derinlik >= 1) sonIcKapan = i; // kök değil, içteki bir nesne kapandı
    }
  }

  if (sonIcKapan < 0) return null;

  // Son tam iç nesne kapandıktan sonraki her şeyi kes
  s = s.substring(0, sonIcKapan + 1).trimEnd().replace(/,\s*$/, '');

  // Geri kalan açık { ve [ karakterlerini say, tersine kapat
  let aciklar = [];
  metinde = false; kacis = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (kacis)           { kacis = false; continue; }
    if (c === '\\' && metinde) { kacis = true; continue; }
    if (c === '"')       { metinde = !metinde; continue; }
    if (metinde)         continue;
    if      (c === '{')  aciklar.push('}');
    else if (c === '[')  aciklar.push(']');
    else if (c === '}' || c === ']') aciklar.pop();
  }
  s += aciklar.reverse().join('');

  try { return JSON.parse(s); } catch { return null; }
}

function average(records, field) {
  if (!records || records.length === 0) return 0;
  const sum = records.reduce((acc, r) => acc + (parseFloat(r[field]) || 0), 0);
  return sum / records.length;
}

module.exports = { generateExerciseProgram, analyzeHealthRisk, isOllamaAvailable };
