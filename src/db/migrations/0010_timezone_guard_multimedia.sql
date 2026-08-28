-- =====================================================================
-- 0010 — Zona waktu, penjaga pos jamak, bukti & petunjuk banyak berkas
--
-- Jalankan:  psql "$DATABASE_URL" -f src/db/migrations/0010_timezone_guard_multimedia.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Semua waktu menjadi TIMESTAMPTZ
--
-- Sebelumnya seluruh kolom waktu bertipe "timestamp without time zone".
-- Tipe itu menyimpan angka jam tanpa menyebut jam siapa: Node menuliskannya
-- memakai zona prosesnya, Postgres menuliskan DEFAULT now() memakai zona
-- basis datanya. Selama keduanya sama, tidak ada yang terlihat salah — dan
-- begitu berbeda, jam kehadiran melompat tujuh jam tanpa jejak.
--
-- TIMESTAMPTZ menyimpan titik waktunya, bukan angka jamnya. Zona penampilan
-- lalu ditentukan sekali di layar (Asia/Jakarta), bukan diwariskan diam-diam
-- dari mesin mana pun.
--
-- Nilai lama ditafsirkan sebagai UTC. Bila basis data Anda ternyata menyimpan
-- jam WIB, ganti 'UTC' di bawah menjadi 'Asia/Jakarta' SEBELUM dijalankan —
-- setelah tersimpan, selisihnya tidak bisa dibedakan lagi.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  col RECORD;
BEGIN
  FOR col IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
    ORDER BY table_name, column_name
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE %L',
      col.table_name, col.column_name, col.column_name, 'UTC'
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Penjaga pos pindah ke sisi misi
--
-- Satu petugas bisa memegang beberapa pos sekaligus — di lembar panitia hal
-- itu ditulis dengan me-merge satu sel PETUGAS ke beberapa baris misi.
-- Selama penugasan disimpan di users.assigned_mission_id, satu petugas hanya
-- muat satu pos, jadi penugasan keduanya menimpa yang pertama tanpa suara.
--
-- Arahnya dibalik: misi yang menyebut penjaganya. Satu misi tetap satu
-- penjaga, satu penjaga boleh sebanyak apa pun misinya.
-- ---------------------------------------------------------------------

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS guard_user_id VARCHAR(50) REFERENCES users(id);

CREATE INDEX IF NOT EXISTS missions_guard_user_id_idx ON missions(guard_user_id);

-- Penugasan yang sudah ada dipindahkan sebelum kolom lamanya dilepas.
UPDATE missions m
SET guard_user_id = u.id
FROM users u
WHERE u.assigned_mission_id = m.id
  AND m.guard_user_id IS NULL;

ALTER TABLE users DROP COLUMN IF EXISTS assigned_mission_id;

-- ---------------------------------------------------------------------
-- 3. Bukti boleh lebih dari satu berkas
--
-- Misi seperti "Taman Pintar - JAWAB 5 PERTANYAAN" meminta foto di lima titik
-- berbeda. Satu kolom media_url memaksa peserta memilih satu di antaranya,
-- lalu panitia menilai dari bukti yang tidak lengkap.
-- ---------------------------------------------------------------------

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE submissions
SET media_urls = jsonb_build_array(media_url)
WHERE media_url IS NOT NULL
  AND media_urls = '[]'::jsonb;

ALTER TABLE submissions DROP COLUMN IF EXISTS media_url;

-- ---------------------------------------------------------------------
-- 4. Petunjuk boleh disertai foto
--
-- Kolom `clue` menyimpan teksnya; `clue_images` menyimpan daftar URL foto
-- pendampingnya. Keduanya berdampingan karena sebagian misi memberi petunjuk
-- teks DAN foto titik sekaligus — bukan salah satu.
-- ---------------------------------------------------------------------

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS clue_images JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Petunjuk lama bertipe FOTO/MAP menyimpan URL-nya di kolom teks. Dipindahkan
-- ke daftar foto supaya seluruh aplikasi hanya perlu membaca satu tempat.
UPDATE missions
SET clue_images = jsonb_build_array(clue),
    clue = NULL
WHERE clue_type IN ('FOTO', 'MAP')
  AND clue IS NOT NULL
  AND clue ~ '^https?://'
  AND clue_images = '[]'::jsonb;

COMMIT;

-- =====================================================================
-- Periksa hasilnya
-- =====================================================================
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND data_type LIKE 'timestamp%'
-- ORDER BY 1, 2;
