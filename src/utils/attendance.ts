import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema/users.ts';
import ApiError from './ApiError.ts';

/**
 * Gerbang kehadiran.
 *
 * Peserta baru bisa bergabung ke kelompok dan mengerjakan misi setelah panitia
 * memindai boarding pass-nya di lokasi. Tanpa penjagaan ini, siapa pun yang
 * punya akun bisa ikut bermain dari rumah.
 *
 * Panitia dikecualikan — mereka memang tidak ikut dipindai.
 */
export const assertCheckedIn = async (userId: string) => {
  const [user] = await db
    .select({ role: users.role, checkInAt: users.checkInAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw ApiError.notFound('User not found');
  if (user.role !== 'PARTICIPANT') return;

  if (!user.checkInAt) {
    throw ApiError.forbidden(
      'Kamu belum tercatat hadir. Tunjukkan Boarding Pass kepada panitia di meja registrasi untuk dipindai.',
    );
  }
};
