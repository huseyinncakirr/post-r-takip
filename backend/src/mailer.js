const nodemailer = require('nodemailer');

function createTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendPasswordReset(toEmail, resetUrl) {
  const transporter = createTransport();

  if (!transporter) {
    // SMTP yapılandırılmamış — geliştirme ortamı için konsola yaz
    console.log('\n──────────────────────────────────────');
    console.log('ŞİFRE SIFIRLAMA LINKI (SMTP yapılandırılmamış):');
    console.log(resetUrl);
    console.log('──────────────────────────────────────\n');
    return { success: true, dev: true };
  }

  await transporter.sendMail({
    from:    process.env.SMTP_FROM || `DikDur <noreply@dikdur.com>`,
    to:      toEmail,
    subject: 'DikDur — Şifre Sıfırlama',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0f172a;color:#e2e8f0;border-radius:12px">
        <div style="font-size:22px;font-weight:800;margin-bottom:8px">Dik<span style="color:#22d3ee">Dur</span></div>
        <h2 style="font-size:18px;margin-bottom:16px">Şifre Sıfırlama</h2>
        <p style="color:#94a3b8;line-height:1.6;margin-bottom:24px">
          Bu e-postayı siz talep ettiyseniz aşağıdaki butona tıklayarak şifrenizi sıfırlayabilirsiniz.
          Link <strong>1 saat</strong> geçerlidir.
        </p>
        <a href="${resetUrl}" style="display:inline-block;background:#6366f1;color:white;padding:12px 28px;
          border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
          Şifremi Sıfırla
        </a>
        <p style="margin-top:24px;font-size:12px;color:#475569">
          Bu isteği siz yapmadıysanız bu e-postayı görmezden gelebilirsiniz. Şifreniz değişmeyecektir.
        </p>
      </div>
    `,
  });

  return { success: true };
}

module.exports = { sendPasswordReset };
