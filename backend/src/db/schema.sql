-- PosturTakip Veritabani Semasi

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Kullanicilar
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Oturumlar (kullanicinin her acilisi bir oturum)
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  duration_sec INTEGER
);

-- Postur kayitlari (her analiz karesi bir kayit)
CREATE TABLE IF NOT EXISTS posture_records (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    UUID REFERENCES sessions(id) ON DELETE SET NULL,
  recorded_at   TIMESTAMPTZ DEFAULT NOW(),
  score         SMALLINT NOT NULL,           -- 0-100
  neck_angle    NUMERIC(5,2),                -- derece
  head_tilt     NUMERIC(5,2),               -- % (ekran yuzdesine gore)
  shoulder_tilt NUMERIC(5,2),               -- derece
  tension       NUMERIC(5,2),               -- % gerginlik
  center_offset NUMERIC(5,2),               -- % merkez kayma
  status        VARCHAR(10) NOT NULL         -- 'good' | 'warning' | 'bad'
);

-- Ozet istatistikler (gunluk, haftalik hesaplamalar icin)
CREATE TABLE IF NOT EXISTS posture_summaries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  period_type     VARCHAR(10) NOT NULL,       -- 'daily' | 'weekly' | 'monthly'
  avg_score       NUMERIC(5,2),
  good_pct        NUMERIC(5,2),
  warning_pct     NUMERIC(5,2),
  bad_pct         NUMERIC(5,2),
  total_records   INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, period_start, period_type)
);

-- AI saglik tahminleri
CREATE TABLE IF NOT EXISTS health_predictions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  risk_level      VARCHAR(10) NOT NULL,       -- 'low' | 'medium' | 'high'
  prediction_text TEXT NOT NULL,
  risk_factors    JSONB,                      -- { "text_neck": 0.72, "scoliosis": 0.15, ... }
  model_used      VARCHAR(50)
);

-- Kisisel egzersiz programlari
CREATE TABLE IF NOT EXISTS exercise_programs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  title        VARCHAR(200),
  program      JSONB NOT NULL,               -- { exercises: [{name, sets, reps, desc}] }
  based_on_days INTEGER,                     -- kac gunluk veriye dayanarak olusturuldu
  model_used   VARCHAR(50)
);

-- Sifre sifirlama tokenlari
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sistem eşikleri (postur skorlama için kalibrasyon değerleri)
CREATE TABLE IF NOT EXISTS system_thresholds (
  key          VARCHAR(50) PRIMARY KEY,
  iyi_esik     NUMERIC(6,2) NOT NULL,
  kotu_esik    NUMERIC(6,2) NOT NULL,
  sample_count INTEGER DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Varsayılan eşik değerleri
INSERT INTO system_thresholds (key, iyi_esik, kotu_esik) VALUES
  ('boyun',     12.0, 22.0),
  ('gerginlik', 22.0, 45.0),
  ('omuz',       4.0,  9.0),
  ('bas',        3.0,  6.0),
  ('merkez',     8.0, 14.0)
ON CONFLICT (key) DO NOTHING;

-- Indeksler
CREATE INDEX IF NOT EXISTS idx_posture_records_user_time
  ON posture_records(user_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_posture_records_session
  ON posture_records(session_id);

CREATE INDEX IF NOT EXISTS idx_health_predictions_user
  ON health_predictions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exercise_programs_user
  ON exercise_programs(user_id, created_at DESC);
