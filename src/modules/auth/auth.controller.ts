import type { NextFunction, Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import { verifyUserCredential, findParticipantByQrToken } from '../user/user.service.ts';
import ApiError from '../../utils/ApiError.ts';
import { generateAccessTokenHelper, generateRefreshTokenHelper, verifyRefreshTokenHelper } from '../../utils/token.ts';
import { addRefreshToken, deleteRefreshToken, verifyAndRefreshToken } from './auth.service.ts';

/**
 * Login peserta lewat QR cetak.
 *
 * Peserta didaftarkan panitia lebih dulu, lalu QR pribadinya dicetak dan
 * dibagikan. Memindai QR itu langsung membuka sesi — tidak perlu mengetik
 * email maupun nomor telepon, yang akan sangat memperlambat antrean.
 */
export const loginByQrHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { qrToken } = req.body ?? {};
  if (!qrToken) return next(ApiError.badRequest('qrToken wajib diisi'));

  const user = await findParticipantByQrToken(qrToken);
  if (!user) return next(ApiError.unauthorized('QR tidak dikenali atau bukan milik peserta'));

  const accessToken = generateAccessTokenHelper({ id: user.id });
  const refreshToken = generateRefreshTokenHelper({ id: user.id });
  await addRefreshToken({ userId: user.id, refreshToken });

  return response(res, 201, `Selamat datang, ${user.fullname}`, { accessToken, refreshToken });
});

export const loginHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { email, phoneNumber } = req.body;

  const userId = await verifyUserCredential({ email, phoneNumber });

  if (!userId) {
    return next(ApiError.unauthorized('Kredensial yang Anda berikan salah'));
  }

  const accessToken = generateAccessTokenHelper({ id: userId });
  const refreshToken = generateRefreshTokenHelper({ id: userId });

  await addRefreshToken({ userId, refreshToken });

  // Kehadiran TIDAK lagi dicatat saat login. Sebelumnya login pertama langsung
  // menandai peserta "hadir", sehingga pemindaian QR oleh panitia jadi tidak
  // ada artinya — peserta bisa berstatus hadir dari rumah. Sekarang check-in
  // hanya tercatat lewat POST /users/check-in/qr saat panitia memindai
  // boarding pass peserta di lokasi.

  return response(res, 201, 'Authentication berhasil ditambahkan', {
    accessToken,
    refreshToken
  });
});

export const refreshTokenHandler = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return next(ApiError.badRequest('Refresh token is required'));
    }

    const storedToken = await verifyAndRefreshToken({ refreshToken });

    if (!storedToken) {
      return next(ApiError.badRequest('Invalid or expired refresh token'));
    }

    const payload = verifyRefreshTokenHelper(refreshToken);

    if (payload.id !== storedToken.userId) {
      return next(ApiError.badRequest('Refresh token tidak valid'));
    }

    const newAccessToken = generateAccessTokenHelper({ id: payload.id });

    return response(res, 200, 'Access Token hasil diperbarui', {
      accessToken: newAccessToken,
    });
  }
);

export const logoutHandler = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return next(ApiError.badRequest('Refresh token is required'));
    }

    const storedToken = await verifyAndRefreshToken({ refreshToken });

    if (!storedToken) {
      return next(ApiError.badRequest('Refresh token tidak valid atau kadaluarsa'));
    }

    await deleteRefreshToken({ refreshToken });

    return response(res, 200, 'Logout berhasil', null);
  }
);
