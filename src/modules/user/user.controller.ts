import type { Request, Response, NextFunction } from 'express';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import ApiError from '../../utils/ApiError.ts';
import { createUser, getUserById, getProfile, updateProfile, saveSocialProfile, checkEmailExists, checkPhoneExists, checkInByQrToken, searchLoginCandidates } from './user.service.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { eq } from 'drizzle-orm';

export const checkInByQrHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const scannerId = req.user?.id as string;
  const [scanner] = await db.select({ role: users.role }).from(users).where(eq(users.id, scannerId)).limit(1);
  if (!scanner || (scanner.role !== 'ADMIN' && scanner.role !== 'SUPER_ADMIN')) {
    return next(ApiError.forbidden('Hanya panitia yang bisa memindai QR peserta'));
  }

  const { qrToken } = req.body ?? {};
  if (!qrToken) return next(ApiError.badRequest('qrToken wajib diisi'));

  const result = await checkInByQrToken(qrToken);
  if (!result) return next(ApiError.notFound('QR tidak dikenali'));

  return response(
    res,
    200,
    result.alreadyCheckedIn
      ? `${result.fullname} sudah check-in sebelumnya`
      : `${result.fullname} berhasil check-in`,
    result,
  );
});

export const createUserHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { email, phoneNumber, fullname, businessName, youtubeAccount, instagramAccount, tiktokAccount } = req.body;

  const isEmailExist = await checkEmailExists(email);
  if (isEmailExist) {
    return next(ApiError.badRequest('Email sudah terdaftar'));
  }

  const isPhoneExist = await checkPhoneExists(phoneNumber);
  if (isPhoneExist) {
    return next(ApiError.badRequest('Nomor telepon sudah terdaftar'));
  }

  const result = await createUser({ email, phoneNumber, fullname, businessName, youtubeAccount, instagramAccount, tiktokAccount });

  if (!result) {
    return next(ApiError.badRequest('Gagal menambahkan user'));
  }

  return response(res, 201, 'User berhasil ditambahkan', result);
});

export const getUserByIdHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id as string;
  const user = await getUserById(id);

  if (!user) {
    return next(ApiError.notFound('User not found'));
  }

  return response(res, 200, 'User fetched successfully', user);
});

export const getProfileHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id as string;
  const profile = await getProfile(userId);

  if (!profile) {
    return next(ApiError.notFound('Profile not found'));
  }

  return response(res, 200, 'Profile fetched successfully', profile);
});

export const updateProfileHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id as string;
  const result = await updateProfile(userId, req.body);

  if (!result) {
    return next(ApiError.notFound('User not found'));
  }

  if ('error' in result) {
    return next(ApiError.badRequest(result.error));
  }

  return response(res, 200, 'Profile updated successfully', result);
});

/** Checkpoint 0 — simpan profil usaha & akun media sosial, atau lewati. */
export const saveSocialProfileHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id as string;
  const result = await saveSocialProfile(userId, req.body ?? {});

  if (!result) return next(ApiError.notFound('User not found'));

  return response(
    res,
    200,
    result.socialProfileSkipped
      ? 'Dilewati — penilaian media sosial tidak dihitung'
      : 'Profil usaha & media sosial tersimpan',
    result,
  );
});

/**
 * Pencarian nama untuk layar masuk. Terbuka tanpa sesi — yang mencari memang
 * belum punya sesi.
 *
 * `scope=PANITIA` mengembalikan akun panitia, dipakai layar masuk admin;
 * tanpa itu yang dikembalikan peserta, seperti di kaki beranda. Isinya hanya
 * nama dan nama usaha — nomor telepon dan email tidak pernah ikut, jadi
 * daftarnya tidak bisa dipakai untuk apa pun selain memilih diri sendiri.
 */
export const searchLoginCandidatesHandler = catchAsync(async (req: Request, res: Response) => {
  const scope = String(req.query.scope ?? '').toUpperCase() === 'PANITIA' ? 'PANITIA' : 'PARTICIPANT';
  const result = await searchLoginCandidates(String(req.query.q ?? ''), scope);
  response(res, 200, scope === 'PANITIA' ? 'Panitia ditemukan' : 'Peserta ditemukan', result);
});
