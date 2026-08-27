-- 0007 — jenis kelamin peserta.
--
-- Panitia membagi kelompok dan menyiapkan sebagian misi berdasarkan komposisi
-- L/P, dan data itu selama ini hanya hidup di spreadsheet mereka. Disimpan
-- sebagai satu huruf supaya kolom di lembar kerja tetap terbaca apa adanya.
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(1);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_gender_check;
ALTER TABLE users ADD CONSTRAINT users_gender_check
  CHECK (gender IS NULL OR gender IN ('L', 'P'));

-- Jalankan dengan `psql -f`, bukan `drizzle-kit push`.
