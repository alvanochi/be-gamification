-- 0006 — pertanyaan kuis bisa dihapus meski sudah pernah dijawab.
--
-- submission_answers menunjuk mission_questions tanpa ON DELETE, sehingga
-- begitu satu kelompok menjawab, seluruh daftar soal terkunci: menyunting atau
-- menghapus pertanyaan melanggar kunci asing dan gagal. Jawaban lama tetap
-- harus tersimpan sebagai riwayat penilaian, jadi pertanyaannya tidak dibuang
-- melainkan ditandai terhapus.
ALTER TABLE mission_questions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Jalankan dengan `psql -f`, bukan `drizzle-kit push`.
