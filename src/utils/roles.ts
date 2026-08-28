import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema/users.ts';
import ApiError from './ApiError.ts';

/**
 * Pemisahan hak akses sesuai BRD Bab 4.
 *
 * Admin adalah panitia lapangan — tugasnya meninjau dan menyetujui/menolak
 * unggahan peserta. Super Admin memegang seluruh konten permainan: membuat
 * misi, mengelola sponsor, mengatur bobot poin, dan mengelola akun panitia.
 *
 * Sebelumnya semua pemeriksaan menerima kedua peran, sehingga panitia lapangan
 * pun bisa menghapus misi.
 */
export type UserRole = 'PARTICIPANT' | 'ADMIN' | 'SUPER_ADMIN' | 'POST_GUARD';

export const getRole = async (userId: string) => {
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw ApiError.notFound('User not found');
  return user.role;
};

/**
 * Panitia lapangan atau penanggung jawab teknis.
 *
 * Penjaga pos sengaja tidak termasuk: tugasnya hanya di meja posnya sendiri,
 * sementara jalur-jalur yang memakai penjagaan ini menyentuh data seluruh acara.
 */
export const ensureAdmin = async (userId: string) => {
  const role = await getRole(userId);
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    throw ApiError.forbidden('Halaman ini hanya untuk panitia');
  }
  return role;
};

/**
 * Siapa pun yang bertugas di meja pos: penjaga pos, panitia lapangan, maupun
 * Super Admin. Dipakai jalur pemindaian dan penilaian di pos.
 */
export const ensurePostOfficer = async (userId: string) => {
  const role = await getRole(userId);
  if (role !== 'POST_GUARD' && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    throw ApiError.forbidden('Halaman ini hanya untuk petugas pos');
  }
  return role;
};

/** Khusus penanggung jawab teknis. */
export const ensureSuperAdmin = async (userId: string) => {
  const role = await getRole(userId);
  if (role !== 'SUPER_ADMIN') {
    throw ApiError.forbidden(
      'Hanya Super Admin yang boleh melakukan ini. Hubungi penanggung jawab teknis acara.',
    );
  }
  return role;
};
