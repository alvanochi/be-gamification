-- =====================================================================
-- 0011 — Bahan nilai akhir dari pihak eksternal
--
-- Nilai akhir acara ini tidak seluruhnya lahir di sistem ini. Dua angka
-- datang dari pihak luar yang memantau media sosial:
--
--   1. Jumlah postingan tiap peserta, dicocokkan lewat username Instagram
--      yang didaftarkan peserta sendiri di Checkpoint 0.
--   2. Nett likes & share per kelompok, sudah dijumlahkan dan dibobot di
--      sisi mereka.
--
-- Keduanya disimpan apa adanya di sini; pembobotan dan penjumlahannya
-- dikerjakan src/utils/finalScore.ts supaya rumusnya hanya ada di satu
-- tempat dan bisa ditelusuri.
--
-- Jalankan:  psql -f src/db/migrations/0011_final_score.sql
-- =====================================================================

BEGIN;

-- --- 1. Jumlah postingan per peserta -------------------------------
--
-- Disimpan per orang, bukan per kelompok: yang dikirim pihak eksternal
-- adalah username Instagram, dan satu kelompok berisi enam orang dengan
-- akun masing-masing. Totalnya dijumlahkan saat dibaca.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS social_post_count INTEGER NOT NULL DEFAULT 0;

-- Kapan angka itu terakhir dikirim. Ditampilkan di layar nilai akhir supaya
-- panitia tahu apakah data sosialnya sudah masuk atau masih menunggu.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS social_post_count_at TIMESTAMPTZ;

-- --- 2. Nett engagement per kelompok -------------------------------
--
-- Pecahan, bukan bilangan bulat: angkanya sudah melewati pembobotan di
-- sisi pengirim, jadi hampir pasti berkoma. Membulatkannya di sini akan
-- menggeser nilai akhir tanpa sebab yang bisa dijelaskan ke peserta.

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS external_nett DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS external_nett_at TIMESTAMPTZ;

COMMIT;
