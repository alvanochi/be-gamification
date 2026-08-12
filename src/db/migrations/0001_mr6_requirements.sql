-- Migrasi kebutuhan MR6 (MR6_TataCaraSimulasi GAME.xlsx)
--
-- Seluruhnya bersifat aditif — tidak ada kolom atau tabel yang dihapus, dan
-- setiap pernyataan idempoten, sehingga aman dijalankan ulang.
--
-- Cara pakai (pilih salah satu):
--   npm run db:push          -- drizzle menyamakan skema dari kode
--   psql -d gamification_db -f src/db/migrations/0001_mr6_requirements.sql

BEGIN;

-- 1. Enum baru -------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE mission_category AS ENUM ('TERSTRUKTUR', 'MANDIRI');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE clue_type AS ENUM ('NONE', 'TEKS', 'MORSE', 'SANDI_ANGKA', 'GPS', 'FOTO', 'MAP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE proof_type AS ENUM ('FOTO', 'VIDEO', 'FOTO_VIDEO', 'LINK_SOSMED', 'LAPORAN_PETUGAS', 'INPUT_HASIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Kolom baru pada missions ----------------------------------------------

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS category          mission_category NOT NULL DEFAULT 'MANDIRI',
  ADD COLUMN IF NOT EXISTS clue_type         clue_type        NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS clue              text,
  ADD COLUMN IF NOT EXISTS location_name     varchar(255),
  ADD COLUMN IF NOT EXISTS session_start     varchar(5),
  ADD COLUMN IF NOT EXISTS session_end       varchar(5),
  ADD COLUMN IF NOT EXISTS duration_minutes  integer,
  ADD COLUMN IF NOT EXISTS proof_type        proof_type       NOT NULL DEFAULT 'FOTO',
  ADD COLUMN IF NOT EXISTS point_min         integer,
  ADD COLUMN IF NOT EXISTS point_max         integer,
  ADD COLUMN IF NOT EXISTS requires_check_in boolean          NOT NULL DEFAULT false;

-- 3. Kolom baru pada submissions -------------------------------------------

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS awarded_point integer,
  ADD COLUMN IF NOT EXISTS reject_reason text;

-- Isi nilai historis agar laporan lama tetap konsisten: submission yang sudah
-- disetujui sebelum fitur ini dianggap memperoleh pointWeight misinya.
UPDATE submissions s
SET awarded_point = m.point_weight
FROM missions m
WHERE s.mission_id = m.id
  AND s.status = 'APPROVED'
  AND s.awarded_point IS NULL;

-- 4. Tabel check-in / check-out per misi -----------------------------------

CREATE TABLE IF NOT EXISTS mission_checkins (
  id              varchar(50) PRIMARY KEY,
  mission_id      varchar(50) NOT NULL REFERENCES missions(id),
  group_id        varchar(50) NOT NULL REFERENCES groups(id),
  checked_in_by   varchar(50) NOT NULL REFERENCES users(id),
  checked_out_by  varchar(50) REFERENCES users(id),
  queue_number    varchar(20),
  checked_in_at   timestamp NOT NULL DEFAULT now(),
  checked_out_at  timestamp,
  CONSTRAINT mission_checkins_mission_group_unique UNIQUE (mission_id, group_id)
);

COMMIT;
