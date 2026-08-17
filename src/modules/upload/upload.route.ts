import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import authenticate from '../../middlewares/auth.middleware.ts';
import response from '../../utils/response.ts';
import ApiError from '../../utils/ApiError.ts';
import env from '../../config/env.ts';

/**
 * Unggahan media langsung ke server.
 *
 * Sebelumnya berkas dikirim peserta ke Cloudflare R2 lewat presigned URL, dan
 * ditampilkan kembali dari domain publik R2 — yang ternyata tidak bisa dibuka
 * dari jaringan sebagian peserta, sehingga foto dan video yang berhasil
 * terunggah tetap tidak pernah tampil. Berkas kini singgah di server yang sama
 * dengan API-nya, jadi apa pun yang bisa memanggil API pasti bisa memuat
 * medianya.
 */

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

/** Berkas ditata per bulan supaya satu direktori tidak menampung puluhan ribu entri. */
const monthFolder = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOAD_DIR, monthFolder());
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    // Nama asli dari ponsel bisa mengandung spasi, tanda baca, bahkan '../'.
    // Yang dipertahankan hanya ekstensinya; sisanya diganti id acak.
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '';
    cb(null, `${nanoid(16)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  // Video yel-yel dari ponsel bisa besar; 60 MB memberi ruang tanpa membiarkan
  // satu unggahan memenuhi disk server.
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Hanya foto atau video yang bisa diunggah'));
  },
});

const router = Router();
router.use(authenticate);

router.post(
  '/',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (!err) return next();

      // Pesan bawaan multer berbahasa Inggris dan menyebut istilah teknis;
      // yang membacanya peserta di tengah lapangan.
      const message =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Berkas terlalu besar. Maksimal 60 MB — coba rekam ulang lebih pendek.'
          : (err as Error).message || 'Gagal mengunggah berkas';
      next(ApiError.badRequest(message));
    });
  },
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) return next(ApiError.badRequest('Tidak ada berkas yang dikirim'));

    const relative = path
      .relative(UPLOAD_DIR, req.file.path)
      .split(path.sep)
      .join('/');

    // MEDIA_BASE_URL dipakai bila API berada di balik domain lain; tanpa itu
    // URL disusun dari permintaan yang masuk, sehingga tetap benar di
    // pengembangan lokal maupun di server.
    const base = env.MEDIA_BASE_URL?.replace(/\/$/, '') ?? `${req.protocol}://${req.get('host')}`;

    return response(res, 201, 'Berkas terunggah', {
      url: `${base}/uploads/${relative}`,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  },
);

export default router;
