-- 0008 — checkpoint 0: profil usaha & akun media sosial peserta.
--
-- Kolom datanya sudah ada sejak pendaftaran mandiri, tetapi peserta kini
-- didaftarkan panitia dari lembar kerja yang tidak memuat akun sosialnya.
-- Dua kolom di bawah mencatat apakah peserta sudah melewati checkpoint itu,
-- dan apakah ia memilih melewatinya — yang berarti penilaian media sosialnya
-- tidak bisa dihitung.
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_profile_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_profile_skipped BOOLEAN NOT NULL DEFAULT FALSE;

-- Jalankan dengan `psql -f`, bukan `drizzle-kit push`.
