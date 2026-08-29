-- =====================================================================
-- 0013 — Misi yang boleh dikirim berkali-kali
--
-- Sebagian misi bukan satu tugas melainkan kumpulan: "Agus Hunt" meminta
-- sepuluh orang bernama Agus, dan peserta menemukannya satu per satu
-- sepanjang hari. Dengan aturan satu bukti per misi, mereka harus
-- mengumpulkan kesepuluhnya dulu baru mengirim sekaligus — dan bila yang
-- pertama sudah terlanjur disetujui, sisanya tidak bisa masuk sama sekali.
--
-- Penanda ini melepas larangan itu untuk misi yang memang dirancang
-- berulang. Tiap kiriman tetap divalidasi panitia sendiri-sendiri dan
-- poinnya tetap dijumlahkan lewat score_entries seperti biasa — yang
-- berubah hanya "boleh mengirim lagi", bukan cara menilainya.
--
-- Bawaannya FALSE: perilaku seluruh misi lain tidak berubah.
--
-- Jalankan:  psql -f src/db/migrations/0013_repeatable_mission.sql
-- =====================================================================

BEGIN;

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS allow_multiple_submissions BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;

-- =====================================================================
-- Menyalakannya untuk misi tertentu, mis. Agus Hunt:
--
-- UPDATE missions
-- SET allow_multiple_submissions = TRUE, updated_at = NOW()
-- WHERE id = 'NSf9JOmy8-wWBtBD';
-- =====================================================================
