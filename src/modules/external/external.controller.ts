import type { Request, Response, NextFunction } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { groups } from '../../db/schema/groups.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import ApiError from '../../utils/ApiError.ts';
import { normaliseInstagram } from '../../utils/finalScore.ts';

/**
 * Pintu masuk bagi pihak eksternal yang memantau media sosial.
 *
 * Mereka tidak punya akun di sistem ini dan tidak perlu punya: yang mereka
 * kirim bukan tindakan atas nama seseorang, melainkan dua angka hasil
 * pemantauan. Karena itu jalurnya dijaga kunci bersama (X-API-Key), bukan
 * sesi login.
 *
 * Semua endpoint di sini bersifat menimpa, bukan menambah: mengirim ulang
 * angka yang sama tidak melipatgandakannya. Pemantauan media sosial berjalan
 * berkala dan akan dikirim berkali-kali sepanjang acara — kalau tiap kiriman
 * menambah, satu kali kirim ulang saja sudah merusak klasemen akhir.
 */

/** Baris yang ditolak, dengan alasannya. Dikembalikan agar bisa diperbaiki. */
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
  // Satu objek tunggal ikut diterima: pihak eksternal yang baru mencoba
  // biasanya mengirim satu baris dulu untuk memastikan jalurnya benar.
  if (Array.isArray(items)) return items;
  if (items && typeof items === 'object') return [items];
  return [];
};

/**
 * Jumlah postingan per peserta, dicocokkan lewat username Instagram.
 *
 * Body: { items: [{ instagramUsername: "namanya", postCount: 4 }, ...] }
 */
export const setSocialPostCounts = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const items = asItems(req.body);
    if (!items.length) {
      return next(ApiError.badRequest('Body harus berisi "items" — daftar { instagramUsername, postCount }'));
    }

    // Seluruh peserta ditarik sekali, lalu dicocokkan di memori. Satu kueri
    // untuk dua ratus akun jauh lebih murah daripada dua ratus kueri, dan
    // pencocokannya perlu bentuk yang sudah diratakan — bukan sesuatu yang
    // bisa dilakukan indeks basis data apa adanya.
    const peserta = await db
      .select({ id: users.id, fullname: users.fullname, instagram: users.instagramAccount })
      .from(users)
      .where(eq(users.role, 'PARTICIPANT'));

    const byUsername = new Map<string, Array<{ id: string; fullname: string }>>();
    for (const p of peserta) {
      const key = normaliseInstagram(p.instagram);
      if (!key) continue;
      const bucket = byUsername.get(key) ?? [];
      bucket.push({ id: p.id, fullname: p.fullname });
      byUsername.set(key, bucket);
    }

    const matched: Array<{ instagramUsername: string; fullname: string; postCount: number }> = [];
    const rejected: Rejected[] = [];
    const now = new Date();

    for (const raw of items) {
      const item = raw as { instagramUsername?: unknown; username?: unknown; postCount?: unknown };
      const inputName = String(item.instagramUsername ?? item.username ?? '').trim();
      const key = normaliseInstagram(inputName);
      const count = asNumber(item.postCount);

      if (!key) {
        rejected.push({ input: inputName || '(kosong)', reason: 'instagramUsername kosong' });
        continue;
      }
      if (count === null || count < 0 || !Number.isInteger(count)) {
        rejected.push({ input: inputName, reason: 'postCount harus bilangan bulat >= 0' });
        continue;
      }

      const owners = byUsername.get(key);
      if (!owners?.length) {
        rejected.push({ input: inputName, reason: 'Tidak ada peserta dengan username Instagram itu' });
        continue;
      }
      if (owners.length > 1) {
        // Dua peserta mendaftarkan akun yang sama. Menebak salah satunya
        // berarti memberi poin ke kelompok yang belum tentu benar.
        rejected.push({
          input: inputName,
          reason: `Dipakai ${owners.length} peserta (${owners.map(o => o.fullname).join(', ')}) — perbaiki dulu di Akun & Kelompok`,
        });
        continue;
      }

      await db
        .update(users)
        .set({ socialPostCount: count, socialPostCountAt: now, updatedAt: now })
        .where(eq(users.id, owners[0].id));

      matched.push({ instagramUsername: inputName, fullname: owners[0].fullname, postCount: count });
    }

    return response(
      res,
      200,
      `${matched.length} peserta diperbarui, ${rejected.length} ditolak`,
      { matched, rejected },
    );
  },
);

/**
 * Nett likes & share per kelompok.
 *
 * Body: { items: [{ groupName: "Kelompok 24", nett: 812.5 }, ...] }
 * `groupId` boleh dipakai menggantikan `groupName` bila sudah dipegang.
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

    return response(
      res,
      200,
      `${matched.length} kelompok diperbarui, ${rejected.length} ditolak`,
      { matched, rejected },
    );
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
      instagramUsername: users.instagramAccount,
      postCount: users.socialPostCount,
    })
    .from(groups)
    .leftJoin(users, sql`${users.groupId} = ${groups.id} AND ${users.role} = 'PARTICIPANT'`)
    .orderBy(groups.name, users.fullname);

  const byGroup = new Map<
    string,
    {
      groupId: string;
      groupName: string;
      members: Array<{ fullname: string; instagramUsername: string; postCount: number }>;
    }
  >();

  for (const row of rows) {
    const entry = byGroup.get(row.groupId) ?? {
      groupId: row.groupId,
      groupName: row.groupName,
      members: [],
    };

    if (row.fullname) {
      entry.members.push({
        fullname: row.fullname,
        instagramUsername: normaliseInstagram(row.instagramUsername),
        postCount: row.postCount ?? 0,
      });
    }

    byGroup.set(row.groupId, entry);
  }

  return response(res, 200, 'Data rujukan', { groups: [...byGroup.values()] });
});
