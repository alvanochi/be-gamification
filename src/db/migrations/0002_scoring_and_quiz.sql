-- Melengkapi kebutuhan MR6 & BRD yang belum tercover:
--   * peralatan pos (kolom PERALATAN)
--   * penilaian terhitung: per satuan & berbasis waktu
--   * misi kuis (jenis tugas "JAWAB PERTANYAAN") berikut pilihan ganda
--
-- Seluruhnya aditif dan idempoten — aman dijalankan ulang.
--
--   psql -U gamification_user -d gamification_db -f src/db/migrations/0002_scoring_and_quiz.sql

BEGIN;

-- 1. Enum baru -------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE scoring_mode AS ENUM ('FLAT', 'RANGE', 'PER_UNIT', 'TIME_BASED', 'AUTO_QUIZ');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE question_type AS ENUM ('PILIHAN_GANDA', 'ISIAN_SINGKAT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- KUIS ditambahkan ke enum tipe misi yang sudah ada.
ALTER TYPE mission_type ADD VALUE IF NOT EXISTS 'KUIS';

-- 2. Kolom baru pada missions ----------------------------------------------

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS equipment           text,
  ADD COLUMN IF NOT EXISTS scoring_mode        scoring_mode NOT NULL DEFAULT 'FLAT',
  ADD COLUMN IF NOT EXISTS point_per_unit      integer,
  ADD COLUMN IF NOT EXISTS max_units           integer,
  ADD COLUMN IF NOT EXISTS time_target_seconds integer;

-- Misi yang sudah punya rentang poin otomatis dianggap berpenilaian rentang,
-- supaya perilakunya tidak berubah setelah migrasi.
UPDATE missions
SET scoring_mode = 'RANGE'
WHERE point_min IS NOT NULL AND point_max IS NOT NULL AND scoring_mode = 'FLAT';

-- 3. Pertanyaan misi -------------------------------------------------------

CREATE TABLE IF NOT EXISTS mission_questions (
  id            varchar(50) PRIMARY KEY,
  mission_id    varchar(50) NOT NULL REFERENCES missions(id),
  order_no      integer NOT NULL DEFAULT 1,
  question_text text NOT NULL,
  image_url     varchar(1024),
  type          question_type NOT NULL DEFAULT 'PILIHAN_GANDA',
  answer_key    varchar(255),
  point         integer NOT NULL DEFAULT 10,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mission_question_options (
  id          varchar(50) PRIMARY KEY,
  question_id varchar(50) NOT NULL REFERENCES mission_questions(id) ON DELETE CASCADE,
  option_text varchar(500) NOT NULL,
  is_correct  boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS submission_answers (
  id                 varchar(50) PRIMARY KEY,
  submission_id      varchar(50) NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_id        varchar(50) NOT NULL REFERENCES mission_questions(id),
  selected_option_id varchar(50),
  answer_text        text,
  is_correct         boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS mission_questions_mission_idx ON mission_questions(mission_id);
CREATE INDEX IF NOT EXISTS submission_answers_submission_idx ON submission_answers(submission_id);

COMMIT;
