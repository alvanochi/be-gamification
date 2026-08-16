import { Router } from 'express';
import * as settingsService from './settings.service.ts';
import authenticate from '../../middlewares/auth.middleware.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import ApiError from '../../utils/ApiError.ts';
import { ensureAdmin, ensureSuperAdmin } from '../../utils/roles.ts';
import { broadcast } from '../../realtime/hub.ts';

const router = Router();

/** Dibaca peserta untuk mengetahui apakah misi sudah dirilis & pengumuman terbaru. */
router.get(
  '/',
  authenticate,
  catchAsync(async (_req, res) => {
    response(res, 200, 'Settings fetched', await settingsService.getPublicSettings());
  }),
);

router.get(
  '/admin',
  authenticate,
  catchAsync(async (req, res) => {
    await ensureAdmin(req.user?.id as string);
    response(res, 200, 'Settings fetched', await settingsService.getSettings());
  }),
);

router.put(
  '/admin',
  authenticate,
  catchAsync(async (req, res) => {
    await ensureSuperAdmin(req.user?.id as string);
    const updated = await settingsService.updateSettings(req.body ?? {});
    broadcast('settings:updated', await settingsService.getPublicSettings());
    response(res, 200, 'Pengaturan tersimpan', updated);
  }),
);

/** Tombol "Munculkan Misi" — membuka daftar misi untuk seluruh peserta. */
router.post(
  '/admin/release-missions',
  authenticate,
  catchAsync(async (req, res) => {
    await ensureAdmin(req.user?.id as string);
    const released = req.body?.released !== false;
    await settingsService.setMissionsReleased(released);

    const publik = await settingsService.getPublicSettings();
    broadcast('missions:released', publik);

    response(
      res,
      200,
      released ? 'Misi dibuka untuk seluruh peserta' : 'Daftar misi disembunyikan kembali',
      publik,
    );
  }),
);

/** Kirim pengumuman yang muncul sebagai pop-up di aplikasi peserta. */
router.post(
  '/admin/announce',
  authenticate,
  catchAsync(async (req, res) => {
    await ensureAdmin(req.user?.id as string);

    const message = String(req.body?.message ?? '').trim();
    if (!message) throw ApiError.badRequest('Isi pengumuman tidak boleh kosong');

    await settingsService.announce(message);
    const publik = await settingsService.getPublicSettings();
    broadcast('announcement', publik);

    response(res, 200, 'Pengumuman terkirim ke seluruh peserta', publik);
  }),
);

export default router;
