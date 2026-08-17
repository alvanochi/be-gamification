-- 0005 — yel-yel, penjagaan pos, voting putaran kedua, dan kategori kelompok.
--
-- Jalankan dengan `psql -f`, BUKAN `drizzle-kit push`: berkas ini berisi
-- pernyataan UPDATE untuk mengisi data lama, dan push hanya menyamakan kolom.

-- === Yel-yel ===================================================================
-- Yel-yel adalah misi tantangan biasa, tetapi satu-satunya yang muncul di
-- rangkaian checkpoint dan punya tenggat sendiri. Penanda ini yang
-- membedakannya dari misi tantangan lain.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS is_yel_yel BOOLEAN NOT NULL DEFAULT FALSE;

-- Kelompok yang memilih mengerjakan yel-yel belakangan. Dicatat supaya
-- penilaiannya memakai tarif yang berbeda saat bukti akhirnya masuk.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS yel_yel_skipped_at TIMESTAMP;

-- === Voting putaran kedua =====================================================
-- Saat dua calon atau lebih memperoleh suara sama banyak, putaran berikutnya
-- dibatasi pada mereka saja alih-alih mengulang dari nol.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS runoff_candidate_ids JSONB;

-- === Penjagaan pos ============================================================
-- Petugas pos yang memindai, bukan peserta yang melapor sendiri. Kolom
-- checked_in_by sudah ada; yang kurang adalah penanda bahwa pencatatan itu
-- memang berasal dari pemindaian petugas.
ALTER TABLE mission_checkins ADD COLUMN IF NOT EXISTS scanned_participant_id VARCHAR(50) REFERENCES users(id);

-- Misi yang mewajibkan lapor pos tidak boleh di-check-in peserta sendiri.
-- Seluruh misi TERSTRUKTUR di MR6 masuk kategori ini.
UPDATE missions SET requires_check_in = TRUE WHERE category = 'TERSTRUKTUR';

-- === Kategori kelompok ========================================================
-- Urutan tampil, supaya panitia bisa menata sendiri susunannya di panel.
ALTER TABLE group_categories ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
