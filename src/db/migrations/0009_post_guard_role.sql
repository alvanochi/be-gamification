-- 0009 — peran penjaga pos, terpisah dari panitia lapangan.
--
-- Panitia yang berdiri seharian di satu pos hanya melakukan tiga hal: memindai
-- kedatangan, memberi nilai, memindai kepergian. Memberi mereka seluruh panel
-- berarti setiap salah ketuk bisa mengubah data acara — dan layar yang penuh
-- menu yang tidak mereka pakai memperlambat antrean di depan meja.
--
-- ALTER TYPE ... ADD VALUE tidak boleh dipakai di transaksi yang sama dengan
-- pernyataan yang memakainya, jadi berkas ini dijalankan apa adanya oleh psql
-- (autocommit per pernyataan) — jangan dibungkus BEGIN/COMMIT.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'POST_GUARD';

-- Pos yang dijaga. Diisi Super Admin dari master akun; penjaga pos tanpa pos
-- tidak punya apa pun untuk dikerjakan, dan layarnya mengatakan itu.
ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_mission_id VARCHAR(50) REFERENCES missions(id);

-- Jalankan dengan `psql -f`, bukan `drizzle-kit push`.
