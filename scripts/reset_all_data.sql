-- =====================================================================
-- RESET TOTAL — DATA ACARA **DAN** MASTER MISI
--
-- Dipakai sebelum memuat master misi & master akun yang sebenarnya:
-- semua isi tabel dikosongkan, KECUALI dua akun panitia di bawah
-- (tanpa mereka tidak ada yang bisa masuk untuk mengunggah data baru)
-- serta sponsors, event_settings, dan group_categories.
--
-- Bedanya dengan scripts/reset_event_data.sql: berkas itu MEMPERTAHANKAN
-- master misi, yang ini MENGHAPUSNYA. Pilih yang sesuai; jangan jalankan
-- keduanya bergantian tanpa membaca ulang.
--
-- Jalankan:  psql "$DATABASE_URL" -f scripts/reset_all_data.sql
--
-- Seluruhnya satu transaksi. Bila ada satu pernyataan gagal, tidak ada
-- satu pun yang jadi — jalankan ROLLBACK lalu perbaiki.
-- =====================================================================

BEGIN;

-- Akun yang dipertahankan. Ubah di satu tempat ini saja bila daftarnya berubah.
CREATE TEMP TABLE keep_accounts (email text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO keep_accounts (email) VALUES
  ('admin@rutekebangsaan.com'),
  ('superadmin@rutekebangsaan.com');

-- --- Periksa dulu: siapa yang akan bertahan? ---
-- Harus mengembalikan tepat dua baris. Kalau kurang, hentikan dengan ROLLBACK:
-- emailnya salah ketik, dan menjalankan sisa skrip akan menghapus semua akun
-- sehingga tidak ada lagi yang bisa masuk ke panel panitia.
SELECT id, email, role
FROM users
WHERE LOWER(email) IN (SELECT email FROM keep_accounts);

-- =====================================================================
-- 1. Jejak permainan, dihapus dari daun ke akar
-- =====================================================================

-- Jawaban kuis menunjuk ke submissions dan ke mission_questions.
DELETE FROM submission_answers;

-- Bukti misi beserta penilaiannya.
DELETE FROM submissions;

-- Rantai barter: langkahnya lebih dulu, baru penugasannya.
DELETE FROM barter_steps;
DELETE FROM assignments;

-- Catatan datang/pergi di pos.
DELETE FROM mission_checkins;

-- Sumber kebenaran skor. groups.score diturunkan dari tabel ini.
DELETE FROM score_entries;

-- Pemilihan ketua & konfirmasi anggota.
DELETE FROM leader_votes;
DELETE FROM member_confirmations;

-- =====================================================================
-- 2. Kelompok
--
-- users.group_id punya kunci asing ke groups, jadi keanggotaan dilepas
-- lebih dulu — termasuk milik dua akun panitia yang dipertahankan.
-- =====================================================================

UPDATE users SET group_id = NULL, updated_at = NOW();
DELETE FROM groups;

-- =====================================================================
-- 3. Akun
--
-- COALESCE penting: peserta yang didaftarkan lewat lembar kerja sering
-- tidak punya email, dan `email NOT IN (...)` bernilai NULL untuk baris
-- seperti itu — artinya mereka justru TIDAK ikut terhapus.
--
-- Penugasan pos ikut dilepas di sini, bukan nanti: users.assigned_mission_id
-- menunjuk ke missions, dan tabel itu baru bisa dikosongkan setelah tidak
-- ada lagi baris yang menunjuk ke sana.
-- =====================================================================

-- Sesi login. Semua dihapus, termasuk milik dua akun panitia: token lama
-- tidak punya gunanya lagi setelah data acara dikosongkan.
DELETE FROM authentications;

DELETE FROM users
WHERE COALESCE(LOWER(email), '') NOT IN (SELECT email FROM keep_accounts);

-- Dibungkus pemeriksaan kolom supaya skrip ini tetap jalan baik sebelum
-- maupun sesudah migrasi 0010 — migrasi itulah yang melepas kolomnya dan
-- memindahkan penugasan penjaga pos ke missions.guard_user_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'assigned_mission_id'
  ) THEN
    EXECUTE 'UPDATE users SET assigned_mission_id = NULL, updated_at = NOW()
             WHERE assigned_mission_id IS NOT NULL';
  END IF;
END $$;

-- =====================================================================
-- 4. Master misi
--
-- Inilah yang tidak dihapus oleh reset_event_data.sql. Urutannya dari
-- yang menunjuk ke yang ditunjuk: pilihan jawaban → soal → pilihan misi
-- → misi. missions.prerequisite_id menunjuk ke misi lain tetapi tanpa
-- kunci asing, jadi tidak menghalangi penghapusan.
-- =====================================================================

DELETE FROM mission_question_options;
DELETE FROM mission_questions;
DELETE FROM mission_options;
DELETE FROM missions;

-- =====================================================================
-- 5. Periksa hasilnya sebelum COMMIT
--
-- Semua angka harus 0 kecuali users (2) dan tabel master yang memang
-- sengaja tidak disentuh.
-- =====================================================================

SELECT 'users (sisa panitia)'  AS tabel, COUNT(*) AS sisa FROM users
UNION ALL SELECT 'groups',                 COUNT(*) FROM groups
UNION ALL SELECT 'submissions',            COUNT(*) FROM submissions
UNION ALL SELECT 'submission_answers',     COUNT(*) FROM submission_answers
UNION ALL SELECT 'assignments',            COUNT(*) FROM assignments
UNION ALL SELECT 'barter_steps',           COUNT(*) FROM barter_steps
UNION ALL SELECT 'mission_checkins',       COUNT(*) FROM mission_checkins
UNION ALL SELECT 'score_entries',          COUNT(*) FROM score_entries
UNION ALL SELECT 'leader_votes',           COUNT(*) FROM leader_votes
UNION ALL SELECT 'member_confirmations',   COUNT(*) FROM member_confirmations
UNION ALL SELECT 'missions',               COUNT(*) FROM missions
UNION ALL SELECT 'mission_options',        COUNT(*) FROM mission_options
UNION ALL SELECT 'mission_questions',      COUNT(*) FROM mission_questions
UNION ALL SELECT 'mission_question_options', COUNT(*) FROM mission_question_options
UNION ALL SELECT 'sponsors (tidak disentuh)', COUNT(*) FROM sponsors;

COMMIT;

-- =====================================================================
-- SETELAH INI
--
-- 1. Unggah master akun lewat Akun & Kelompok (template-peserta.xlsx).
--    Petugas pos harus sudah ada di sini, karena lembar misi hanya
--    mencocokkan namanya — akun tidak dibuat dari lembar misi.
-- 2. Unggah master misi lewat Kelola Misi (template-misi.xlsx).
--    Kolom Petugas yang terisi menjadikan barisnya misi pos sekaligus
--    mengangkat akun bernama itu menjadi POST_GUARD.
-- =====================================================================

-- =====================================================================
-- OPSIONAL — jalankan terpisah, hanya bila memang diinginkan
-- =====================================================================

-- (a) Kategori kelompok & sponsor. Keduanya master yang jarang berubah.
-- DELETE FROM group_categories;
-- DELETE FROM sponsors;

-- (b) Kembalikan keadaan acara ke sebelum aba-aba: misi tersembunyi lagi
--     dan pengumuman terakhir dibersihkan. Angka waktu & poin tidak diubah.
-- UPDATE event_settings
-- SET missions_released = FALSE,
--     missions_released_at = NULL,
--     announcement = NULL,
--     announced_at = NULL,
--     updated_at = NOW();
