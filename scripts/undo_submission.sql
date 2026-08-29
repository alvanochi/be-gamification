-- =====================================================================
-- BATALKAN PENGIRIMAN BUKTI SATU MISI
--
-- Mengembalikan sebuah misi ke keadaan "belum dikerjakan" bagi SATU
-- peserta, sehingga ia bisa mengirim buktinya lagi.
--
-- Yang dihapus hanya kiriman atas nama user_id yang diberikan. Rancangan
-- sistem ini sebenarnya satu bukti per kelompok, tetapi di lapangan sebuah
-- misi bisa terlanjur terisi satu baris per orang — dan saat itu terjadi,
-- membatalkan sekelompok sekaligus akan menghapus lima kiriman yang tidak
-- bermasalah. Karena itu cakupannya dipersempit ke pengirimnya.
--
-- Untuk membatalkan sekelompok sekaligus, lihat catatan di kaki berkas.
--
-- Yang menghalangi pengiriman ulang hanya dua keadaan: kiriman berstatus
-- PENDING (menunggu validasi) atau APPROVED (sudah bernilai). Yang REJECTED
-- tidak menghalangi apa pun — peserta memang sudah boleh mengirim ulang.
-- Karena itu yang dibereskan di sini hanya dua yang pertama, berikut jejak
-- yang mereka tinggalkan:
--
--   submission_answers  jawaban kuis yang menggantung pada kiriman itu
--   score_entries       poin yang terlanjur masuk bila sudah disetujui
--   groups.score        dihitung ulang dari score_entries
--
-- Check-in pos SENGAJA tidak dihapus: syaratnya hanya "pernah check-in",
-- bukan "sedang berada di pos", jadi menghapusnya justru akan mengunci
-- kelompok itu dari mengirim ulang.
--
-- Jalankan:
--   psql -v mission_id=NSf9JOmy8-wWBtBD -v user_id=xxxx -f scripts/undo_submission.sql
--
-- Lewat docker:
--   sudo docker exec -i odoo18-db psql -U odoo_palawi -d gamification_prod \
--     -v mission_id=NSf9JOmy8-wWBtBD -v user_id=xxxx \
--     -f - < scripts/undo_submission.sql
-- =====================================================================

\set ON_ERROR_STOP on

-- --- Siapa orangnya, dan kelompok mana? ---------------------------
--
-- Dibaca lebih dulu supaya salah ketik user_id ketahuan sebelum ada yang
-- terhapus. Harus mengembalikan tepat satu baris berisi nama yang Anda
-- maksud.
SELECT u.id AS user_id, u.fullname AS nama, g.id AS group_id, g.name AS kelompok
FROM users u
LEFT JOIN groups g ON g.id = u.group_id
WHERE u.id = :'user_id';

-- Berhenti sebelum transaksinya dibuka bila id-nya keliru. Diperiksa lewat
-- \gset dan \if, bukan blok DO: psql tidak mengganti variabel di dalam
-- teks berkutip dolar, sehingga :'user_id' akan terkirim apa adanya ke
-- dalam plpgsql dan gagal parse.
SELECT
  (SELECT COUNT(*) FROM users WHERE id = :'user_id') = 0 AS akun_tidak_ada,
  COALESCE((SELECT group_id IS NULL FROM users WHERE id = :'user_id'), true) AS tanpa_kelompok
\gset

\if :akun_tidak_ada
\echo '!! Tidak ada akun dengan id itu. Tidak ada yang diubah.'
\quit
\endif

\if :tanpa_kelompok
\echo '!! Akun itu belum tergabung dalam kelompok mana pun. Tidak ada yang diubah.'
\quit
\endif

BEGIN;

-- --- Apa yang akan dibatalkan? ------------------------------------
--
-- Hanya baris milik pengirim ini. Baris anggota lain di misi yang sama
-- tetap utuh.
SELECT
  s.id            AS submission_id,
  g.name          AS kelompok,
  u.fullname      AS pengirim,
  m.title         AS misi,
  m.type          AS tipe_misi,
  s.status,
  s.awarded_point AS poin,
  s.created_at    AS dikirim
FROM submissions s
JOIN missions m ON m.id = s.mission_id
JOIN groups   g ON g.id = s.group_id
JOIN users    u ON u.id = s.submitted_by
WHERE s.mission_id = :'mission_id'
  AND s.submitted_by = :'user_id'
  AND s.status IN ('PENDING', 'APPROVED');

-- Disimpan sebelum barisnya hilang — skor kelompoknya perlu dihitung
-- ulang setelah score_entries berkurang.
CREATE TEMP TABLE undo_target ON COMMIT DROP AS
SELECT s.id AS submission_id, s.group_id
FROM submissions s
WHERE s.mission_id = :'mission_id'
  AND s.submitted_by = :'user_id'
  AND s.status IN ('PENDING', 'APPROVED');

-- --- 1. Poin yang terlanjur masuk ---------------------------------
--
-- reference_id sebuah score_entry adalah id kiriman yang melahirkannya,
-- jadi poinnya bisa dicabut tepat sasaran tanpa menyentuh poin lain
-- kelompok itu (barter, pembentukan kelompok, yel-yel).

DELETE FROM score_entries
WHERE reference_id IN (SELECT submission_id FROM undo_target);

-- --- 2. Jawaban kuis ----------------------------------------------

DELETE FROM submission_answers
WHERE submission_id IN (SELECT submission_id FROM undo_target);

-- --- 3. Kiriman buktinya ------------------------------------------

DELETE FROM submissions
WHERE id IN (SELECT submission_id FROM undo_target);

-- --- 4. Samakan groups.score dengan score_entries ------------------
--
-- score_entries adalah sumber kebenaran; groups.score hanya turunannya.
-- Membiarkannya tidak dihitung ulang membuat papan klasemen dan detail
-- kelompok memperlihatkan dua angka berbeda untuk tim yang sama.

UPDATE groups g
SET score = COALESCE((SELECT SUM(se.point) FROM score_entries se WHERE se.group_id = g.id), 0),
    updated_at = NOW()
WHERE g.id IN (SELECT DISTINCT group_id FROM undo_target);

-- --- 5. Periksa hasilnya sebelum COMMIT ----------------------------
--
-- "sisa_kiriman" harus 0. Kalau masih ada, ROLLBACK dan periksa kembali
-- mission_id serta user_id yang diberikan.

SELECT
  g.name  AS kelompok,
  g.score AS skor_setelah_dibatalkan,
  -- Milik orang ini harus 0. Angka "sisa_sekelompok" boleh tetap terisi:
  -- itu kiriman anggota lain yang memang sengaja tidak disentuh.
  (SELECT COUNT(*) FROM submissions s
   WHERE s.mission_id = :'mission_id' AND s.submitted_by = :'user_id'
     AND s.status IN ('PENDING', 'APPROVED')) AS sisa_kiriman_orang_ini,
  (SELECT COUNT(*) FROM submissions s
   WHERE s.group_id = g.id AND s.mission_id = :'mission_id'
     AND s.status IN ('PENDING', 'APPROVED')) AS sisa_sekelompok
FROM groups g
WHERE g.id = (SELECT group_id FROM users WHERE id = :'user_id');

COMMIT;

-- =====================================================================
-- ALTERNATIF — menolak, bukan menghapus
--
-- Bila jejak buktinya ingin disimpan, ubah statusnya menjadi REJECTED
-- alih-alih menghapus barisnya. Peserta tetap bisa mengirim ulang, dan
-- kartunya akan berbunyi "Ditolak — kirim ulang buktimu".
--
-- Poinnya tetap harus dicabut lebih dulu (bagian 1 & 4 di atas), lalu:
--
-- UPDATE submissions
-- SET status = 'REJECTED',
--     reject_reason = 'Dibatalkan panitia — silakan kirim ulang',
--     awarded_point = NULL,
--     updated_at = NOW()
-- WHERE mission_id = :'mission_id'
--   AND submitted_by = :'user_id'
--   AND status IN ('PENDING', 'APPROVED');
-- =====================================================================

-- =====================================================================
-- MEMPERLUAS KE SELURUH KELOMPOK
--
-- Bila yang ingin dibatalkan seluruh kiriman sekelompok di misi ini —
-- bukan milik satu orang — ganti kedua baris
--
--   AND s.submitted_by = :'user_id'
--
-- di atas menjadi
--
--   AND s.group_id = (SELECT group_id FROM users WHERE id = :'user_id')
--
-- Periksa dulu berapa baris yang akan tersapu; di misi yang terlanjur
-- terisi per orang, satu perintah itu menghapus enam kiriman sekaligus.
-- =====================================================================
