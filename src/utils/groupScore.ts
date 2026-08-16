import { eq, sql } from 'drizzle-orm';
import { groups } from '../db/schema/groups.ts';
import { scoreEntries } from '../db/schema/score_entries.ts';
import { broadcast } from '../realtime/hub.ts';

/**
 * Samakan kolom `groups.score` dengan jumlah `score_entries`.
 *
 * Skor punya dua pembaca: leaderboard (menjumlahkan score_entries) dan detail
 * kelompok (membaca groups.score). Dulu keduanya ditulis terpisah — skor manual
 * hanya masuk ke score_entries — sehingga panitia dan peserta bisa melihat
 * angka berbeda untuk tim yang sama. Sekarang score_entries adalah satu-satunya
 * sumber kebenaran dan groups.score selalu diturunkan darinya.
 *
 * Terima `tx` agar bisa dipanggil di dalam transaksi yang sudah berjalan.
 */
export const recalculateGroupScore = async (tx: any, groupId: string) => {
  const [row] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${scoreEntries.point}), 0)::int` })
    .from(scoreEntries)
    .where(eq(scoreEntries.groupId, groupId));

  await tx
    .update(groups)
    .set({ score: row?.total ?? 0, updatedAt: new Date() })
    .where(eq(groups.id, groupId));

  // Klasemen ditonton banyak layar sekaligus (pit stop, HP peserta), jadi
  // setiap perubahan poin disiarkan begitu terjadi.
  broadcast('leaderboard:changed', { groupId, score: row?.total ?? 0 });

  return row?.total ?? 0;
};
