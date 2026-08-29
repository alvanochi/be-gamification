import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as externalController from './external.controller.ts';
import ApiError from '../../utils/ApiError.ts';
import env from '../../config/env.ts';

/**
 * Kunci bersama untuk pihak eksternal.
 *
 * Bukan sesi login: yang di seberang adalah sebuah sistem, bukan orang, dan
 * ia tidak bertindak atas nama siapa pun di sini. Kuncinya dikirim di header
 * X-API-Key dan disimpan di variabel lingkungan EXTERNAL_API_KEY.
 *
 * Tanpa kunci terpasang di server, seluruh jalur ini MENOLAK — bukan terbuka.
 * Endpoint yang bisa mengubah angka penentu juara tidak boleh pernah
 * menganggap "belum dikonfigurasi" sama dengan "bebas dipakai siapa saja".
 */
const requireApiKey = (req: Request, _res: Response, next: NextFunction) => {
  const expected = env.EXTERNAL_API_KEY;

  if (!expected) {
    return next(
      ApiError.forbidden('Jalur eksternal belum diaktifkan. Setel EXTERNAL_API_KEY di server.'),
    );
  }

  const sent = req.get('x-api-key') ?? '';
  if (sent !== expected) return next(ApiError.unauthorized('X-API-Key tidak dikenali'));

  return next();
};

const router = Router();
router.use(requireApiKey);

/** Daftar kelompok & username peserta, supaya kirimannya tidak salah sasaran. */
router.get('/reference', externalController.getReference);

/** Penilaian 1 — jumlah postingan per peserta. */
router.post('/social-posts', externalController.setSocialPostCounts);

/** Penilaian 2 — nett likes & share per kelompok. */
router.post('/engagement', externalController.setEngagementScores);

export default router;
