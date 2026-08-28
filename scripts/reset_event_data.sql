-- =====================================================================
-- RESET DATA ACARA
--
-- Menghapus seluruh data hasil permainan (transaksi) dan seluruh akun,
-- KECUALI dua akun panitia di bawah. Master permainan dipertahankan utuh:
-- missions, mission_options, mission_questions, mission_question_options,
-- sponsors, dan event_settings TIDAK disentuh.
--
-- Jalankan:  psql "$DATABASE_URL" -f scripts/reset_event_data.sql
--
-- Seluruhnya berjalan dalam satu transaksi. Bila ada satu pernyataan yang
-- gagal, tidak ada satu pun yang jadi — jalankan ROLLBACK lalu perbaiki.
-- =====================================================================

BEGIN;

-- Akun yang dipertahankan. Ubah di satu tempat ini saja bila daftarnya berubah.
CREATE TEMP TABLE keep_accounts (email text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO keep_accounts (email) VALUES
  ('admin@rutekebangsaan.com'),
  ('superadmin@rutekebangsaan.com');

-- --- Periksa dulu: siapa yang akan bertahan? ---
-- Harus mengembalikan tepat dua baris. Kalau kurang, hentikan dengan ROLLBACK:
-- emailnya salah ketik, dan menjalankan sisa skrip akan menghapus semua akun.
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
-- =====================================================================

-- Sesi login. Semua dihapus, termasuk milik dua akun panitia: token lama
-- tidak punya gunanya lagi setelah data acara dikosongkan.
DELETE FROM authentications;

DELETE FROM users
WHERE COALESCE(LOWER(email), '') NOT IN (SELECT email FROM keep_accounts);

-- =====================================================================
-- 4. Periksa hasilnya sebelum COMMIT
-- =====================================================================

SELECT 'users'             AS tabel, COUNT(*) AS sisa FROM users
UNION ALL SELECT 'groups',              COUNT(*) FROM groups
UNION ALL SELECT 'submissions',         COUNT(*) FROM submissions
UNION ALL SELECT 'submission_answers',  COUNT(*) FROM submission_answers
UNION ALL SELECT 'assignments',         COUNT(*) FROM assignments
UNION ALL SELECT 'barter_steps',        COUNT(*) FROM barter_steps
UNION ALL SELECT 'mission_checkins',    COUNT(*) FROM mission_checkins
UNION ALL SELECT 'score_entries',       COUNT(*) FROM score_entries
UNION ALL SELECT 'leader_votes',        COUNT(*) FROM leader_votes
UNION ALL SELECT 'member_confirmations', COUNT(*) FROM member_confirmations
UNION ALL SELECT 'missions (master)',   COUNT(*) FROM missions
UNION ALL SELECT 'mission_questions (master)', COUNT(*) FROM mission_questions
UNION ALL SELECT 'sponsors (master)',   COUNT(*) FROM sponsors;

COMMIT;

-- =====================================================================
-- OPSIONAL — jalankan terpisah, hanya bila memang diinginkan
-- =====================================================================

-- (a) Kategori kelompok. Bukan transaksi, tetapi isinya hanya menjelaskan
--     kelompok yang barusan dihapus. Fitur kategori sedang dinonaktifkan
--     di seluruh aplikasi, jadi membiarkannya pun tidak berpengaruh.
-- DELETE FROM group_categories;

-- (b) Kembalikan keadaan acara ke sebelum aba-aba: misi tersembunyi lagi
--     dan pengumuman terakhir dibersihkan. Angka waktu & poin tidak diubah.
-- UPDATE event_settings
-- SET missions_released = FALSE,
--     missions_released_at = NULL,
--     announcement = NULL,
--     announced_at = NULL,
--     updated_at = NOW();
