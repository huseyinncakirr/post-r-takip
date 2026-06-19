# PosturTakip - Fine-Tuned Modeli Ollama'ya Yukle
# Kullanim: .\backend\scripts\ollama-load-finetuned.ps1 -GGUFPath 'C:\...\posturtakip-model-unsloth.Q4_K_M.gguf'

param(
    [Parameter(Mandatory=$true)]
    [string]$GGUFPath
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "PosturTakip - Fine-Tuned Model Yukleme"
Write-Host "======================================="
Write-Host ""

# Dosya var mi kontrol et
if (-not (Test-Path $GGUFPath)) {
    Write-Error "GGUF dosyasi bulunamadi: $GGUFPath"
    exit 1
}

$fileSize = [math]::Round((Get-Item $GGUFPath).Length / 1MB, 0)
Write-Host "Dosya: $GGUFPath ($fileSize MB)"
Write-Host ""

# 1) GGUF dosyasini Ollama container'ina kopyala
Write-Host "[1/4] GGUF dosyasi Ollama container'ina kopyalaniyor..."
docker cp $GGUFPath postur_ollama:/root/posturtakip-model.gguf
if ($LASTEXITCODE -ne 0) { Write-Error "Kopyalama basarisiz!"; exit 1 }
Write-Host "      OK"

# 2) Modelfile olustur ve container'a kopyala
Write-Host "[2/4] Modelfile olusturuluyor..."

$modelfileContent = @'
FROM /root/posturtakip-model.gguf

SYSTEM """Sen bir Turk fizyoterapist ve saglik analistisin. Kullanicinin postur verilerini KLiNiK VE DONUST bicimde analiz et.
KURAL: Esigi asan her bolge icin gercekci olasilik ver. Hicbir riski 0.05 ile birakma; veri esigi asiyorsa en az 0.25 olmali.
Yanitini KESINLIKLE JSON formatinda ver, baska hicbir sey yazma:
{"risk_level":"low|medium|high","summary":"Turkce kisa ozet","risks":[{"name":"Risk adi","probability":0.0-1.0,"description":"Aciklama"}],"recommendations":["Oneri"]}
risk_level: kotu durus yuzde 30+ veya herhangi alan esik ustundeyse en az medium olmali."""

PARAMETER temperature 0.3
PARAMETER num_predict 1200
PARAMETER stop "<|eot_id|>"
'@

$tempModelfile = Join-Path $env:TEMP "Modelfile_posturtakip"
$modelfileContent | Out-File -FilePath $tempModelfile -Encoding utf8
docker cp $tempModelfile postur_ollama:/root/Modelfile
Remove-Item $tempModelfile -ErrorAction SilentlyContinue
Write-Host "      OK"

# 3) Ollama modelini olustur
Write-Host "[3/4] Ollama modeli olusturuluyor (birkaç dakika surebilir)..."
docker exec postur_ollama ollama create posturtakip-finetuned -f /root/Modelfile
if ($LASTEXITCODE -ne 0) { Write-Error "Model olusturulamadi!"; exit 1 }
Write-Host "      OK"

# 4) .env guncelle
Write-Host "[4/4] .env guncelleniyor..."
$envPath = Join-Path $PSScriptRoot "../../.env"
$envPath = (Resolve-Path $envPath).Path
$envContent = Get-Content $envPath -Raw
$eskiModel = if ($envContent -match "OLLAMA_MODEL=(.+)") { $matches[1].Trim() } else { "?" }
$envContent = $envContent -replace "OLLAMA_MODEL=.*", "OLLAMA_MODEL=posturtakip-finetuned"
[System.IO.File]::WriteAllText($envPath, $envContent, [System.Text.Encoding]::UTF8)
Write-Host "      Eski: $eskiModel"
Write-Host "      Yeni: posturtakip-finetuned"

Write-Host ""
Write-Host "Tum adimlar tamamlandi!"
Write-Host ""
Write-Host "Backend'i yeniden baslat:"
Write-Host "  docker-compose restart backend"
Write-Host ""
Write-Host "Ardindan dashboard'da AI Asistan > Analizi Baslatla test et."
