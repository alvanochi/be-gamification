import type { Request, Response, NextFunction } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { groups } from '../../db/schema/groups.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import ApiError from '../../utils/ApiError.ts';
import {
  PLATFORM_COLUMNS,
  SOCIAL_PLATFORMS,
  normaliseHandle,
  type SocialPlatform,
} from '../../utils/finalScore.ts';

/**
 * Pintu masuk bagi pihak eksternal yang memantau media sosial.
 *
 * Mereka tidak punya akun di sistem ini dan tidak perlu punya: yang dikirim
 * bukan tindakan atas nama seseorang, melainkan dua angka hasil pemantauan.
 * Karena itu jalurnya dijaga kunci bersama (X-API-Key), bukan sesi login.
 *
 * Semua endpoint di sini bersifat MENIMPA, bukan menambah: mengirim ulang
 * angka yang sama tidak melipatgandakannya. Pemantauan berjalan berkala dan
 * akan dikirim berkali-kali sepanjang acara — kalau tiap kiriman menambah,
 * satu kali kirim ulang saja sudah merusak klasemen akhir.
 */

/** Baris yang ditolak beserta alasannya. Dikembalikan agar bisa diperbaiki. */
interface Rejected {
  input: string;
  reason: string;
}

const asNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const asItems = (body: unknown): unknown[] => {
  const items = (body as { items?: unknown })?.items;
  // Satu objek tunggal ikut diterima: pihak yang baru mencoba biasanya
  // mengirim satu baris dulu untuk memastikan jalurnya benar.
  if (Array.isArray(items)) return items;
  if (items && typeof items === 'object') return [items];
  return [];
};

const asPlatform = (value: unknown): SocialPlatform | null => {
  const key = String(value ?? '').trim().toUpperCase();
  return (SOCIAL_PLATFORMS as readonly string[]).includes(key) ? (key as SocialPlatform) : null;
};

/**
 * Penilaian 1 — jumlah postingan per peserta, per platform.
 *
 * Body: { items: [{ platform: "TIKTOK", username: "@budi", postCount: 4 }, ...] }
 *
 * `platform` boleh dikosongkan. Bila kosong, username-nya dicari di ketiga
 * akun yang didaftarkan peserta; kalau hanya cocok di satu tempat, platformnya
 * disimpulkan dari situ. Kalau username yang sama terdaftar di dua platform
 * berbeda, barisnya ditolak dan pengirim diminta menyebut platformnya —
 * menebaknya berarti menaruh angka di kolom yang salah, lalu kiriman
 * berikutnya untuk platform sebenarnya akan menimpanya.
 */
export const setSocialPostCounts = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const items = asItems(req.body);
    if (!items.length) {
      return next(
        ApiError.badRequest('Body harus berisi "items" — daftar { platform, username, postCount }'),
      );
    }

    // Seluruh peserta ditarik sekali lalu dicocokkan di memori. Satu kueri
    // untuk dua ratus akun jauh lebih murah daripada dua ratus kueri, dan
    // pencocokannya perlu bentuk yang sudah diratakan — bukan sesuatu yang
    // bisa dikerjakan indeks basis data apa adanya.
    const peserta = await db
      .select({
        id: users.id,
        fullname: users.fullname,
        instagramAccount: users.instagramAccount,
        tiktokAccount: users.tiktokAccount,
        youtubeAccount: users.youtubeAccount,
      })
      .from(users)
      .where(eq(users.role, 'PARTICIPANT'));

    /** "<platform>:<username>" → pemiliknya. Satu peta untuk ketiga platform. */
    const owners = new Map<string, Array<{ id: string; fullname: string }>>();

    for (const p of peserta) {
      for (const platform of SOCIAL_PLATFORMS) {
        const handle = normaliseHandle(p[PLATFORM_COLUMNS[platform].account]);
        if (!handle) continue;
        const key = `${platform}:${handle}`;
        const bucket = owners.get(key) ?? [];
        bucket.push({ id: p.id, fullname: p.fullname });
        owners.set(key, bucket);
      }
    }

    const matched: Array<{
      platform: SocialPlatform;
      username: string;
      fullname: string;
      postCount: number;
    }> = [];
    const rejected: Rejected[] = [];
    const now = new Date();

    for (const raw of items) {
      const item = raw as {
        platform?: unknown;
        username?: unknown;
        instagramUsername?: unknown;
        postCount?: unknown;
      };

      // instagramUsername tetap diterima: itu bentuk yang dipakai versi
      // pertama endpoint ini, dan pihak eksternal mungkin belum berpindah.
      const inputName = String(item.username ?? item.instagramUsername ?? '').trim();
      const handle = normaliseHandle(inputName);
      const count = asNumber(item.postCount);
      const asked = item.platform === undefined || item.platform === null || item.platform === ''
        ? item.instagramUsername !== undefined
          ? 'INSTAGRAM' as SocialPlatform
          : null
        : asPlatform(item.platform);

      if (item.platform && !asked) {
        rejected.push({
          input: inputName || '(kosong)',
          reason: `platform "${String(item.platform)}" tidak dikenali (${SOCIAL_PLATFORMS.join(', ')})`,
        });
        continue;
      }
      if (!handle) {
        rejected.push({ input: inputName || '(kosong)', reason: 'username kosong' });
        continue;
      }
      if (count === null || count < 0 || !Number.isInteger(count)) {
        rejected.push({ input: inputName, reason: 'postCount harus bilangan bulat >= 0' });
        continue;
      }

      // Platform yang disebut dipakai apa adanya; yang tidak disebut dicari
      // di ketiganya.
      const candidates = (asked ? [asked] : SOCIAL_PLATFORMS)
        .map(platform => ({ platform, found: owners.get(`${platform}:${handle}`) }))
        .filter((c): c is { platform: SocialPlatform; found: Array<{ id: string; fullname: string }> } =>
          !!c.found?.length,
        );

      if (!candidates.length) {
        rejected.push({
          input: inputName,
          reason: asked
            ? `Tidak ada peserta dengan akun ${asked} itu`
            : 'Tidak ada peserta dengan username itu di platform mana pun',
        });
        continue;
      }
      if (candidates.length > 1) {
        rejected.push({
          input: inputName,
          reason: `Username itu terdaftar di ${candidates
            .map(c => c.platform)
            .join(' & ')} — sebutkan "platform" agar tidak salah kolom`,
        });
        continue;
      }

      const { platform, found } = candidates[0];

      if (found.length > 1) {
        // Dua peserta mendaftarkan akun yang sama. Menebak salah satunya
        // berarti memberi poin ke kelompok yang belum tentu benar.
        rejected.push({
          input: inputName,
          reason: `Dipakai ${found.length} peserta (${found
            .map(o => o.fullname)
            .join(', ')}) — perbaiki dulu di Akun & Kelompok`,
        });
        continue;
      }

      await db
        .update(users)
        .set({
          [PLATFORM_COLUMNS[platform].count]: count,
          socialPostCountAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, found[0].id));

      matched.push({ platform, username: inputName, fullname: found[0].fullname, postCount: count });
    }

    return response(res, 200, `${matched.length} akun diperbarui, ${rejected.length} ditolak`, {
      matched,
      rejected,
    });
  },
);

/**
 * Penilaian 2 — nett likes & share per kelompok.
 *
 * Body: { items: [{ groupName: "Kelompok 24", nett: 812.5 }, ...] }
 * `groupId` boleh menggantikan `groupName` bila sudah dipegang.
 */
export const setEngagementScores = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const items = asItems(req.body);
    if (!items.length) {
      return next(ApiError.badRequest('Body harus berisi "items" — daftar { groupName, nett }'));
    }

    const kelompok = await db.select({ id: groups.id, name: groups.name }).from(groups);
    const byName = new Map(kelompok.map(g => [g.name.trim().toLowerCase(), g]));
    const byId = new Map(kelompok.map(g => [g.id, g]));

    const matched: Array<{ groupName: string; nett: number }> = [];
    const rejected: Rejected[] = [];
    const now = new Date();

    for (const raw of items) {
      const item = raw as { groupId?: unknown; groupName?: unknown; nett?: unknown; score?: unknown };
      const inputName = String(item.groupName ?? item.groupId ?? '').trim();
      const nett = asNumber(item.nett ?? item.score);

      if (!inputName) {
        rejected.push({ input: '(kosong)', reason: 'groupName atau groupId wajib diisi' });
        continue;
      }
      if (nett === null || nett < 0) {
        rejected.push({ input: inputName, reason: 'nett harus angka >= 0' });
        continue;
      }

      const target = item.groupId
        ? byId.get(String(item.groupId))
        : byName.get(String(item.groupName ?? '').trim().toLowerCase());

      if (!target) {
        rejected.push({ input: inputName, reason: 'Kelompok tidak ditemukan' });
        continue;
      }

      await db
        .update(groups)
        .set({ externalNett: nett, externalNettAt: now, updatedAt: now })
        .where(eq(groups.id, target.id));

      matched.push({ groupName: target.name, nett });
    }

    return response(res, 200, `${matched.length} kelompok diperbarui, ${rejected.length} ditolak`, {
      matched,
      rejected,
    });
  },
);

/**
 * Data rujukan untuk pihak eksternal.
 *
 * Tanpa ini mereka harus menebak ejaan nama kelompok dan username peserta,
 * lalu mengirim kiriman yang setengahnya ditolak. Isinya hanya nama kelompok
 * dan username Instagram yang memang didaftarkan peserta sendiri untuk
 * dipantau — bukan nomor telepon, email, atau apa pun yang lain.
 */
export const getReference = catchAsync(async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      groupId: groups.id,
      groupName: groups.name,
      fullname: users.fullname,
      instagramAccount: users.instagramAccount,
      tiktokAccount: users.tiktokAccount,
      youtubeAccount: users.youtubeAccount,
      socialPostInstagram: users.socialPostInstagram,
      socialPostTiktok: users.socialPostTiktok,
      socialPostYoutube: users.socialPostYoutube,
    })
    .from(groups)
    .leftJoin(users, sql`${users.groupId} = ${groups.id} AND ${users.role} = 'PARTICIPANT'`)
    .orderBy(groups.name, users.fullname);

  interface ReferenceMember {
    fullname: string;
    /** Username per platform, sudah diratakan — kirim balik apa adanya. */
    accounts: Partial<Record<SocialPlatform, string>>;
    /** Angka yang tercatat sekarang, agar pengirim tahu apa yang akan ditimpa. */
    postCounts: Record<SocialPlatform, number>;
  }

  const byGroup = new Map<
    string,
    { groupId: string; groupName: string; members: ReferenceMember[] }
  >();

  for (const row of rows) {
    const entry = byGroup.get(row.groupId) ?? {
      groupId: row.groupId,
      groupName: row.groupName,
      members: [],
    };

    if (row.fullname) {
      const accounts: Partial<Record<SocialPlatform, string>> = {};
      for (const platform of SOCIAL_PLATFORMS) {
        const handle = normaliseHandle(row[PLATFORM_COLUMNS[platform].account]);
        if (handle) accounts[platform] = handle;
      }

      entry.members.push({
        fullname: row.fullname,
        accounts,
        postCounts: {
          INSTAGRAM: row.socialPostInstagram ?? 0,
          TIKTOK: row.socialPostTiktok ?? 0,
          YOUTUBE: row.socialPostYoutube ?? 0,
        },
      });
    }

    byGroup.set(row.groupId, entry);
  }

  return response(res, 200, 'Data rujukan', { groups: [...byGroup.values()] });
});
