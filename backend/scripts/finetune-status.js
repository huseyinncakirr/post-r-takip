// ============================================================
// ADIM 3: Fine-tune durumunu kontrol et, tamamlanınca .env güncelle
// Çalıştır: node backend/scripts/finetune-status.js
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const OpenAI = require('openai');
const fs     = require('fs');
const path   = require('path');

const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const jobIdFile = path.join(__dirname, 'finetune_job_id.txt');
const envFile   = path.join(__dirname, '../../.env');

const DURUM_TR = {
  validating_files: 'Dosyalar doğrulanıyor...',
  queued:           'Kuyrukta bekliyor...',
  running:          'Eğitim devam ediyor...',
  succeeded:        '✓ Tamamlandı!',
  failed:           '✗ Başarısız',
  cancelled:        '✗ İptal edildi',
};

async function main() {
  console.log('=== PosturTakip Fine-Tune — Durum Kontrolü ===\n');

  // Job ID: argümandan veya dosyadan al
  const jobId = process.argv[2] || (fs.existsSync(jobIdFile) ? fs.readFileSync(jobIdFile, 'utf8').trim() : null);

  if (!jobId) {
    console.error('Job ID bulunamadı.');
    console.error('Önce çalıştırın: node backend/scripts/finetune-submit.js');
    process.exit(1);
  }

  console.log(`Job ID: ${jobId}`);

  const job = await openai.fineTuning.jobs.retrieve(jobId);

  console.log(`Durum : ${DURUM_TR[job.status] || job.status}`);
  console.log(`Model : ${job.fine_tuned_model || '(henüz hazır değil)'}`);

  if (job.trained_tokens) {
    console.log(`Token : ${job.trained_tokens.toLocaleString()} eğitim tokeni kullanıldı`);
  }

  // Tamamlandıysa .env'i güncelle
  if (job.status === 'succeeded' && job.fine_tuned_model) {
    console.log('\n─────────────────────────────────────────');
    console.log('Fine-tune başarıyla tamamlandı!');
    console.log(`Yeni model: ${job.fine_tuned_model}`);

    let envContent = fs.readFileSync(envFile, 'utf8');
    const eskiModel = envContent.match(/^OPENAI_MODEL=(.+)$/m)?.[1] || '';

    envContent = envContent.replace(/^OPENAI_MODEL=.+$/m, `OPENAI_MODEL=${job.fine_tuned_model}`);
    fs.writeFileSync(envFile, envContent, 'utf8');

    console.log(`\n✓ .env güncellendi:`);
    console.log(`  Eski : ${eskiModel}`);
    console.log(`  Yeni : ${job.fine_tuned_model}`);
    console.log('\nSonraki adım — backend\'i yeniden başlat:');
    console.log('  docker-compose up --build -d backend');

  } else if (job.status === 'failed') {
    console.error('\nHata detayı:', job.error?.message || 'Bilinmiyor');
    console.error('export-training-data.js ile veriyi tekrar dışa aktarın.');

  } else {
    console.log('\nHenüz tamamlanmadı. Birkaç dakika sonra tekrar kontrol edin:');
    console.log('  node backend/scripts/finetune-status.js');
  }
}

main().catch(err => { console.error('Hata:', err.message); process.exit(1); });
