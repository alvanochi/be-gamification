-- Kategori kelompok, penanda pengunggah foto, dan penanda mulai untuk timer.
-- Aditif dan idempoten.
--   psql -U gamification_user -d gamification_db -f src/db/migrations/0003_qr_login_and_group_category.sql

BEGIN;

CREATE TABLE IF NOT EXISTS group_categories (
  id         varchar(50) PRIMARY KEY,
  name       varchar(100) NOT NULL UNIQUE,
  color      varchar(9) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS photo_by        varchar(50),
  ADD COLUMN IF NOT EXISTS category_id     varchar(50),
  ADD COLUMN IF NOT EXISTS started_at      timestamp,
  ADD COLUMN IF NOT EXISTS formation_point integer;

-- Kelompok yang sudah ada dianggap mulai sejak dibuat, supaya hitung mundur
-- tidak menampilkan waktu kosong.
UPDATE groups SET started_at = created_at WHERE started_at IS NULL;

COMMIT;
