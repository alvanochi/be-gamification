import type { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import { ensureAdmin } from '../../utils/roles.ts';
import {
  MISSION_WEIGHT,
  ENGAGEMENT_WEIGHT,
  computeFinalScore,
  normaliseInstagram,
} from '../../utils/finalScore.ts';

/**
 * Papan nilai akhir.
 *
 * Bukan klasemen yang sama dengan /leaderboard: yang itu memperlihatkan poin
 * kotor selama acara berjalan, yang ini menggabungkannya dengan dua angka dari
 * pihak eksternal dan membobotnya. Keduanya sengaja terpisah — peserta melihat
 * poin mentahnya sepanjang hari, sedangkan nilai akhir baru utuh setelah data
 * media sosialnya masuk.
 *
 * Setiap suku dikirim terurai, bukan hanya hasil akhirnya. Panitia yang
 * ditanya "kenapa kelompok kami kalah" harus bisa menunjuk angkanya satu per
 * satu, bukan menyodorkan satu bilangan tanpa asal-usul.
 */
export const getFinalScores = catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);

  const rows = (
    await db.execute(sql`
      SELECT
        g.id                                                        AS "groupId",
        g.name                                                      AS "groupName",
        g.external_nett                                             AS "externalNett",
        g.external_nett_at                                          AS "externalNettAt",
        COALESCE((SELECT SUM(s.point) FROM score_entries s
                  WHERE s.group_id = g.id), 0)::int                 AS "systemPoint",
        COALESCE((SELECT SUM(u.social_post_count) FROM users u
                  WHERE u.group_id = g.id AND u.role = 'PARTICIPANT'), 0)::int AS "postCount",
        (SELECT MAX(u.social_post_count_at) FROM users u
         WHERE u.group_id = g.id AND u.role = 'PARTICIPANT')        AS "postCountAt"
      FROM groups g
      ORDER BY g.name
    `)
  ).rows as Array<{
    groupId: string;
    groupName: string;
    externalNett: number;
    externalNettAt: Date | null;
    systemPoint: number;
    postCount: number;
    postCountAt: Date | null;
  }>;

  // Anggota diambil sekali untuk seluruh kelompok, lalu dibagikan di memori.
  // Satu kueri per kelompok akan menjadi tiga puluh perjalanan ke basis data
  // untuk layar yang disegarkan berkali-kali menjelang pengumuman.
  const members = (
    await db.execute(sql`
      SELECT u.group_id AS "groupId", u.fullname, u.instagram_account AS "instagram",
             u.social_post_count::int AS "postCount"
      FROM users u
      WHERE u.role = 'PARTICIPANT' AND u.group_id IS NOT NULL
      ORDER BY u.fullname
    `)
  ).rows as Array<{ groupId: string; fullname: string; instagram: string | null; postCount: number }>;

  const scored = rows.map(row => ({
    groupId: row.groupId,
    groupName: row.groupName,
    ...computeFinalScore({
      systemPoint: row.systemPoint,
      postCount: row.postCount,
      externalNett: Number(row.externalNett) || 0,
    }),
    // Kapan tiap angka luar terakhir masuk. Nilai akhir yang belum lengkap
    // harus terlihat belum lengkap, bukan terbaca sebagai nol yang sah.
    postCountAt: row.postCountAt,
    externalNettAt: row.externalNettAt,
    members: members
      .filter(m => m.groupId === row.groupId)
      .map(m => ({
        fullname: m.fullname,
        instagramUsername: normaliseInstagram(m.instagram),
        postCount: m.postCount,
      })),
  }));

  // Peringkat dihitung setelah semua nilai akhir ada — bukan dari poin sistem,
  // karena urutannya bisa berbeda jauh setelah engagement ikut dihitung.
  const ranked = [...scored]
    .sort((a, b) => b.finalScore - a.finalScore)
    .map((group, index) => ({ ...group, rank: index + 1 }));

  return response(res, 200, 'Nilai akhir', {
    // Bobotnya ikut dikirim supaya layar tidak perlu menuliskannya sendiri —
    // satu-satunya sumber kebenaran tetap src/utils/finalScore.ts.
    weights: { mission: MISSION_WEIGHT, engagement: ENGAGEMENT_WEIGHT },
    groups: ranked,
  });
});
