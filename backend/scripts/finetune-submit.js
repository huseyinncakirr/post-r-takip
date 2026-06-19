// ============================================================
// ADIM 2: Fine-tune işini OpenAI'ye gönder
// Çalıştır: node backend/scripts/finetune-submit.js
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const OpenAI = require('openai');
const fs     = require('fs');
const path   = require('path');

const openai        = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const trainingFile  = path.join(__dirname, 'training_data.jsonl');
const jobIdFile     = path.join(__dirname, 'finetune_job_id.txt');

async function main() {
  console.log('=== PosturTakip Fine-Tune — OpenAI Gönderim ===\n');

  if (!fs.existsSync(trainingFile)) {
    console.error('training_data.jsonl bulunamadı!');
    console.error('Önce çalıştırın: node backend/scripts/export-training-data.js');
    process.exit(1);
  }

  const lines = fs.readFileSync(trainingFile, 'utf8').trim().split('\n').filter(Boolean);
  console.log(`${lines.length} eğitim örneği yüklenecek.`);

  if (lines.length < 10) {
    console.error(`\nFine-tune için minimum 10 örnek gerekiyor (şu an: ${lines.length}).`);
    console.error('Daha fazla postur analizi yapıp export-training-data.js tekrar çalıştırın.');
    process.exit(1);
  }

  // 1) Dosyayı OpenAI'ye yükle
  console.log('\n[1/2] Eğitim dosyası OpenAI\'ye yükleniyor...');
  const upload = await openai.files.create({
    file:    fs.createReadStream(trainingFile),
    purpose: 'fine-tune',
  });
  console.log(`✓ Dosya yüklendi — ID: ${upload.id}`);

  // 2) Fine-tune işini başlat
  console.log('\n[2/2] Fine-tune işi başlatılıyor...');
  const job = await openai.fineTuning.jobs.create({
    training_file:   upload.id,
    model:           'gpt-4o-mini-2024-07-18',
    hyperparameters: { n_epochs: 3 },
    suffix:          'posturtakip',
  });

  fs.writeFileSync(jobIdFile, job.id, 'utf8');

  console.log(`✓ İş başladı!`);
  console.log(`  Job ID  : ${job.id}`);
  console.log(`  Durum   : ${job.status}`);
  console.log(`  Model   : ${job.model}`);

  console.log('\n⏳ Fine-tune 15-60 dakika sürebilir.');
  console.log('\nDurumu kontrol etmek için:');
  console.log(`  node backend/scripts/finetune-status.js`);
}

main().catch(err => {
  console.error('\nOpenAI Hatası:', err.message);
  if (err.status === 401) console.error('API anahtarı geçersiz — .env dosyasını kontrol edin.');
  if (err.status === 400) console.error('Geçersiz istek — eğitim verisi formatını kontrol edin.');
  process.exit(1);
});
