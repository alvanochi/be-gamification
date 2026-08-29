import type { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import { ensureAdmin } from '../../utils/roles.ts';
import {
  MISSION_WEIGHT,
  ENGAGEMENT_WEIGHT,
  computeFinalScore,
  normaliseHandle,
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
 * Setiap suku dikirim terurai, bukan hanya hasil akhirnya. Panitia yang ditanya
 * "kenapa kelompok kami kalah" harus bisa menunjuk angkanya satu per satu,
 * bukan menyodorkan satu bilangan tanpa asal-usul.
 */
const buildFinalScoreBoard = async () => {
  const rows = (
    await db.execute(sql`
      SELECT
        g.id                                                        AS "groupId",
        g.name                                                      AS "groupName",
        g.external_nett                                             AS "externalNett",
        g.external_nett_at                                          AS "externalNettAt",
        COALESCE((SELECT SUM(s.point) FROM score_entries s
                  WHERE s.group_id = g.id), 0)::int                 AS "systemPoint",
        -- Ketiga platform dijumlahkan di sini. Menyimpan totalnya sebagai
        -- kolom tersendiri hanya akan menciptakan angka turunan yang harus
        -- dijaga tetap sepakat dengan ketiganya.
        COALESCE((SELECT SUM(u.social_post_instagram + u.social_post_tiktok + u.social_post_youtube)
                  FROM users u
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
      SELECT u.group_id AS "groupId", u.fullname,
             u.instagram_account AS "instagram",
             u.tiktok_account    AS "tiktok",
             u.youtube_account   AS "youtube",
             u.social_post_instagram::int AS "postInstagram",
             u.social_post_tiktok::int    AS "postTiktok",
             u.social_post_youtube::int   AS "postYoutube"
      FROM users u
      WHERE u.role = 'PARTICIPANT' AND u.group_id IS NOT NULL
      ORDER BY u.fullname
    `)
  ).rows as Array<{
    groupId: string;
    fullname: string;
    instagram: string | null;
    tiktok: string | null;
    youtube: string | null;
    postInstagram: number;
    postTiktok: number;
    postYoutube: number;
  }>;

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
        // Rinci per platform supaya panitia bisa menunjuk angka mana yang
        // belum masuk, bukan hanya melihat totalnya yang terasa kekecilan.
        accounts: {
          INSTAGRAM: normaliseHandle(m.instagram),
          TIKTOK: normaliseHandle(m.tiktok),
          YOUTUBE: normaliseHandle(m.youtube),
        },
        postCounts: {
          INSTAGRAM: m.postInstagram,
          TIKTOK: m.postTiktok,
          YOUTUBE: m.postYoutube,
        },
        postCount: m.postInstagram + m.postTiktok + m.postYoutube,
      })),
  }));

  // Peringkat dihitung setelah semua nilai akhir ada — bukan dari poin sistem,
  // karena urutannya bisa berbeda jauh setelah engagement ikut dihitung.
  const ranked = [...scored]
    .sort((a, b) => b.finalScore - a.finalScore)
    .map((group, index) => ({ ...group, rank: index + 1 }));

  return {
    // Bobotnya ikut dikirim supaya layar tidak perlu menuliskannya sendiri —
    // satu-satunya sumber kebenaran tetap src/utils/finalScore.ts.
    weights: { mission: MISSION_WEIGHT, engagement: ENGAGEMENT_WEIGHT },
    groups: ranked,
  };
};

export const getFinalScores = catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);
  return response(res, 200, 'Nilai akhir', await buildFinalScoreBoard());
});

/** "24 Agustus 2026 14.05 WIB" — jam acara, bukan jam mesin. */
const stampWib = (value: Date | string | null) =>
  value
    ? new Date(value).toLocaleString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta',
      })
    : '';

/**
 * Unduh nilai akhir sebagai lembar kerja.
 *
 * Dihitung lewat buildFinalScoreBoard yang sama dengan layarnya, bukan dengan
 * kueri tersendiri: berkas yang diunduh panitia menjelang pengumuman juara
 * tidak boleh punya kemungkinan berbeda seangka pun dari yang mereka lihat di
 * layar. Satu sumber, dua bentuk keluaran.
 *
 * Dua lembar, karena dua pertanyaan yang berbeda. "Siapa juaranya" dijawab
 * lembar pertama; "kenapa angkanya segitu" dijawab lembar kedua, yang
 * merinci postingan tiap peserta per platform.
 */
export const exportFinalScores = catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);

  const board = await buildFinalScoreBoard();
  const bobotMisi = `${Math.round(board.weights.mission * 100)}%`;

  const ringkasan = board.groups.map(g => ({
    Peringkat: g.rank,
    Kelompok: g.groupName,
    'Poin Sistem': g.systemPoint,
    'Jumlah Postingan': g.postCount,
    'Subtotal Kotor': g.grossPoint,
    [`Penilaian 1 (x${bobotMisi})`]: g.missionScore,
    'Nett Likes & Share': g.externalNett,
    'Penilaian 2': g.engagementScore,
    'Nilai Akhir': g.finalScore,
    // Kolom waktu inilah yang membedakan nol yang sah dari nol karena
    // datanya memang belum dikirim pihak eksternal.
    'Postingan Diperbarui': stampWib(g.postCountAt),
    'Nett Diperbarui': stampWib(g.externalNettAt),
  }));

  const perPeserta = board.groups.flatMap(g =>
    g.members.map(m => ({
      Kelompok: g.groupName,
      Nama: m.fullname,
      Instagram: m.accounts.INSTAGRAM,
      'Postingan IG': m.postCounts.INSTAGRAM,
      TikTok: m.accounts.TIKTOK,
      'Postingan TikTok': m.postCounts.TIKTOK,
      YouTube: m.accounts.YOUTUBE,
      'Postingan YouTube': m.postCounts.YOUTUBE,
      'Total Postingan': m.postCount,
    })),
  );

  const wb = XLSX.utils.book_new();

  const wsRingkasan = XLSX.utils.json_to_sheet(ringkasan);
  wsRingkasan['!cols'] = [
    { wch: 10 }, { wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 15 },
    { wch: 20 }, { wch: 20 }, { wch: 13 }, { wch: 13 }, { wch: 24 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, wsRingkasan, 'Nilai Akhir');

  const wsPeserta = XLSX.utils.json_to_sheet(perPeserta);
  wsPeserta['!cols'] = [
    { wch: 28 }, { wch: 28 }, { wch: 22 }, { wch: 14 },
    { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsPeserta, 'Postingan per Peserta');

  // Rumusnya ikut serta. Berkas ini akan berpindah tangan tanpa penjelasan
  // lisan yang menyertainya, dan angka tanpa asal-usul selalu jadi bahan
  // sengketa yang tidak perlu.
  const wsRumus = XLSX.utils.aoa_to_sheet([
    ['Cara nilai akhir dihitung'],
    [],
    ['Penilaian 1', `(Poin Sistem + Jumlah Postingan) x ${bobotMisi}`],
    ['Penilaian 2', 'Nett likes & share dari pihak eksternal, sudah dibobot 30% di sisi mereka'],
    ['Nilai Akhir', 'Penilaian 1 + Penilaian 2'],
    [],
    ['Poin Sistem', 'Seluruh poin yang lahir di aplikasi: misi disetujui, barter, pembentukan kelompok, yel-yel'],
    ['Jumlah Postingan', 'Postingan seluruh anggota di Instagram, TikTok, dan YouTube'],
    [],
    ['Kolom "Diperbarui" kosong', 'Angka itu belum pernah dikirim pihak eksternal — bukan berarti nol'],
  ]);
  wsRumus['!cols'] = [{ wch: 26 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsRumus, 'Cara Menghitung');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="nilai-akhir.xlsx"');
  return res.send(buffer);
});
