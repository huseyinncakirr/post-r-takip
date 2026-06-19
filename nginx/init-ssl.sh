#!/bin/bash
# SSL sertifikası ilk kurulumu — sunucuda BİR KEZ çalıştırın.
# Kullanım: chmod +x nginx/init-ssl.sh && ./nginx/init-ssl.sh

DOMAIN="DOMAIN_ADI"        # ← kendi domain adınızı yazın
EMAIL="EMAIL_ADRESI"       # ← Let's Encrypt bildirimleri için

if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "DOMAIN_ADI" ]; then
  echo "HATA: nginx/init-ssl.sh içindeki DOMAIN ve EMAIL değerlerini doldurun."
  exit 1
fi

echo "→ Domain: $DOMAIN"
echo "→ E-posta: $EMAIL"

# Certbot ile sertifika al
docker run --rm \
  -v "$(pwd)/nginx/certbot/conf:/etc/letsencrypt" \
  -v "$(pwd)/nginx/certbot/www:/var/www/certbot" \
  certbot/certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

echo "✓ Sertifika alındı. Şimdi 'docker compose up -d' çalıştırabilirsiniz."
