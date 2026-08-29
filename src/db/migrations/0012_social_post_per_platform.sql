-- =====================================================================
-- 0012 — Jumlah postingan dipisah per platform
--
-- Peserta mendaftarkan sampai tiga akun di Checkpoint 0: Instagram,
-- TikTok, dan YouTube. Migrasi 0011 menampung jumlah postingannya di satu
-- kolom, dan itu keliru: pihak eksternal memantau tiap platform sendiri
-- dan mengirimkannya di waktu yang berbeda. Dengan satu kolom, kiriman
-- TikTok hari ini akan menimpa angka Instagram kemarin — bukan
-- menambahnya — dan tidak ada yang bisa tahu itu terjadi.
--
-- Tiga kolom, satu per platform. Totalnya dijumlahkan saat dibaca, jadi
-- tidak ada angka turunan yang perlu dijaga tetap sepakat.
--
-- Jalankan:  psql -f src/db/migrations/0012_social_post_per_platform.sql
--
-- Aman dijalankan baik sesudah maupun tanpa 0011: pemindahan nilainya
-- dijaga pemeriksaan keberadaan kolom.
-- =====================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS social_post_instagram INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS social_post_tiktok    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS social_post_youtube   INTEGER NOT NULL DEFAULT 0;

-- Kapan angka mana pun terakhir dikirim. Dipakai layar nilai akhir untuk
-- membedakan nol yang sah dari nol karena datanya memang belum masuk.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS social_post_count_at TIMESTAMPTZ;

-- Nilai dari 0011 dipindahkan ke Instagram — di sanalah ia berasal, karena
-- endpoint versi pertama hanya menerima username Instagram.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'social_post_count'
  ) THEN
    EXECUTE 'UPDATE users SET social_post_instagram = social_post_count
             WHERE social_post_count > 0 AND social_post_instagram = 0';
    EXECUTE 'ALTER TABLE users DROP COLUMN social_post_count';
  END IF;
END $$;

COMMIT;
